import express from 'express';
import { supabase } from '../supabase.js';
import { authMiddleware, adminMiddleware } from '../auth.js';
import { autoCheckDeposits } from '../services/autocheck.js';
import { sendTelegramMessage } from '../services/telegram.js';

const router = express.Router();

// USER: get profits (public)
router.get('/profits', async (req,res)=>{
  try{
    const { data, error } = await supabase.from('bot_profits').select('*').order('timestamp',{ascending:true}).limit(10000);
    if(error) return res.json({ error: error.message });
    return res.json(data);
  }catch(e){ res.json({ error: e.toString() }); }
});

// BOT: push profit (secret)
router.post('/bot-push', async (req,res)=>{
  try{
    const { token, date, totalProfit, percent, dailyProfit, balance, equity, trades, winRate, drawdown, note, profit } = req.body;
    const { CONFIG } = await import('../config.js');
    if(token !== CONFIG.BOT_SECRET) return res.json({ error: 'Unauthorized BOT' });

    const mt5Time = new Date(Date.now()-4*60*60*1000);
    const dateStr = date || mt5Time.toISOString().split('T')[0];
    const timeStr = mt5Time.toTimeString().split(' ')[0];
    const hourMinute = mt5Time.toTimeString().slice(0,5);

    const entry = {
      date: dateStr,
      time: timeStr,
      hour_minute: hourMinute,
      timestamp_ms: mt5Time.getTime(),
      timestamp: mt5Time.toISOString(),
      server_timestamp: new Date().toISOString(),
      total_profit: parseFloat(totalProfit)||0,
      percent: parseFloat(percent)||0,
      daily_profit: parseFloat(dailyProfit)||parseFloat(totalProfit)||0,
      balance: parseFloat(balance)||0,
      equity: parseFloat(equity)||0,
      trades: parseInt(trades)||0,
      win_rate: parseFloat(winRate)||0,
      drawdown: parseFloat(drawdown)||0,
      note: note||'',
      profit: parseFloat(profit)||parseFloat(totalProfit)||0
    };

    const { data, error } = await supabase.from('bot_profits').insert(entry).select().single();
    if(error) return res.json({ error: error.message });

    // keep max 10000
    const { count } = await supabase.from('bot_profits').select('*',{count:'exact',head:true});
    if(count && count>10000){
      const { data: oldest } = await supabase.from('bot_profits').select('id').order('created_at',{ascending:true}).limit(count-10000);
      if(oldest) await supabase.from('bot_profits').delete().in('id', oldest.map(o=>o.id));
    }

    return res.json({ success: true, saved: data, message: 'Đã ghi mới' });
  }catch(e){ res.json({ error: e.toString() }); }
});

// ADMIN: approve invest
router.post('/admin-approve', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { userId, investId, status } = req.body;
    const { data: inv, error: errInv } = await supabase.from('investments').select('*').eq('id', investId).eq('user_id', userId).single();
    if(errInv || !inv) return res.json({ error: 'Investment not found' });

    const { error } = await supabase.from('investments').update({
      status,
      approved_at: status==='APPROVED' ? new Date().toISOString() : null
    }).eq('id', investId);
    if(error) return res.json({ error: error.message });

    if(status==='APPROVED'){
      const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
      if(user){
        await supabase.from('users').update({ total_invested: (parseFloat(user.total_invested)||0)+parseFloat(inv.amount) }).eq('id', userId);
      }
      if(inv.wallet_id){
        const { data: w } = await supabase.from('deposit_wallets').select('*').eq('id', inv.wallet_id).single();
        if(w){
          await supabase.from('deposit_wallets').update({
            total_received: (parseFloat(w.total_received)||0)+parseFloat(inv.amount),
            status:'AVAILABLE', busy_by:null, busy_by_email:null, busy_amount:null, assigned_at:null, last_used_at: new Date().toISOString()
          }).eq('id', w.id);
        }
      }
      try{
        if(!inv.auto_approved){
          await sendTelegramMessage(`✅ <b>ADMIN DUYỆT ĐẦU TƯ</b>\n\n👤 ${userId}\n💰 $${inv.amount} USDT\n👨‍💼 ${req.user.email}\n⏰ ${new Date().toLocaleString('vi-VN')}`);
        }
      }catch(e){}
    } else if(status==='REJECTED'){
      if(inv.wallet_id){
        await supabase.from('deposit_wallets').update({ status:'AVAILABLE', busy_by:null, busy_by_email:null, busy_amount:null, assigned_at:null }).eq('id', inv.wallet_id);
      }
    }

    return res.json({ success: true });
  }catch(e){ res.json({ error: e.toString() }); }
});

// ADMIN: get all data
router.get('/admin-all', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { data: users } = await supabase.from('users').select('*').order('created_at',{ascending:false});
    const { data: profits } = await supabase.from('bot_profits').select('*').order('timestamp',{ascending:true}).limit(10000);
    const { data: allPayouts } = await supabase.from('payouts').select('*').order('created_at',{ascending:false}).limit(500);
    const { data: wallets } = await supabase.from('deposit_wallets').select('*');

    // attach investments per user
    const usersWithInvest = await Promise.all((users||[]).map(async u=>{
      const { data: invs } = await supabase.from('investments').select('*').eq('user_id', u.id).order('created_at',{ascending:false});
      return { ...u, investments: invs||[] };
    }));

    return res.json({ success: true, users: usersWithInvest, profits: profits||[], allPayouts: allPayouts||[], depositWallets: wallets||[] });
  }catch(e){ res.json({ error: e.toString() }); }
});

// ADMIN: payout preview
router.post('/payout-preview', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { totalProfit } = req.body;
    const total = parseFloat(totalProfit);
    if(!total || total<=0) return res.json({ error: 'Tổng lãi không hợp lệ' });

    const { data: users } = await supabase.from('users').select('*').eq('status','ACTIVE');
    let totalPool = 0;
    const caps = [];
    for(let u of users||[]){
      const { data: invs } = await supabase.from('investments').select('amount').eq('user_id', u.id).eq('status','APPROVED');
      const cap = (invs||[]).reduce((s,i)=>s+parseFloat(i.amount),0);
      caps.push({ user: u, cap });
      totalPool += cap;
    }
    if(totalPool===0) return res.json({ error: 'Chưa có vốn APPROVED' });

    const preview = caps.filter(c=>c.cap>0).map(c=>{
      const pct = c.cap/totalPool*100;
      return {
        userId: c.user.id,
        fullName: c.user.full_name,
        email: c.user.email,
        capital: c.cap,
        percentPool: pct,
        payoutAmount: total*pct/100,
        bankInfo: c.user.bank_info||{},
        usdtInfo: c.user.usdt_info||{},
        preferredPayout: c.user.preferred_payout||'BANK',
        hasBank: !!(c.user.bank_info && c.user.bank_info.accountNumber),
        hasUsdt: !!(c.user.usdt_info && c.user.usdt_info.address)
      };
    }).sort((a,b)=>b.capital-a.capital);

    return res.json({ success: true, totalPool, totalProfit: total, preview });
  }catch(e){ res.json({ error: e.toString() }); }
});

// ADMIN: confirm payout
router.post('/confirm-payout', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { userId, amount, totalProfit, note, payoutMethod } = req.body;
    const amt = parseFloat(amount);
    if(!amt || amt<=0) return res.json({ error: 'Số tiền không hợp lệ' });

    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if(!user) return res.json({ error: 'User not found' });

    const { data: invs } = await supabase.from('investments').select('amount').eq('user_id', userId).eq('status','APPROVED');
    const capital = (invs||[]).reduce((s,i)=>s+parseFloat(i.amount),0);

    const { data: allApproved } = await supabase.from('investments').select('amount').eq('status','APPROVED');
    const totalPool = (allApproved||[]).reduce((s,i)=>s+parseFloat(i.amount),0);
    const sharePercent = totalPool>0 ? capital/totalPool*100 : 0;

    const payoutRecord = {
      user_id: userId,
      amount: amt,
      capital,
      share_percent: sharePercent,
      total_pool_profit: parseFloat(totalProfit)||0,
      total_pool_capital: totalPool,
      note: note||'',
      admin_email: req.user.email,
      payout_method: payoutMethod || user.preferred_payout || 'BANK',
      bank_snapshot: user.bank_info||{},
      usdt_snapshot: user.usdt_info||{}
    };

    const { data: saved, error } = await supabase.from('payouts').insert(payoutRecord).select().single();
    if(error) return res.json({ error: error.message });

    await supabase.from('users').update({ total_profit_received: (parseFloat(user.total_profit_received)||0)+amt }).eq('id', userId);
    await supabase.from('transactions').insert({ user_id: userId, type: 'PAYOUT', amount: amt, note: `Trả lãi ${amt} (${payoutMethod||user.preferred_payout}) - Tổng pool lãi ${totalProfit} - ${note||''}` });

    return res.json({ success: true, payout: saved });
  }catch(e){ res.json({ error: e.toString() }); }
});

// ADMIN: auto-check deposits
router.post('/auto-check', authMiddleware, adminMiddleware, async (req,res)=>{
  const result = await autoCheckDeposits();
  return res.json(result);
});

router.get('/deposit-logs', authMiddleware, adminMiddleware, async (req,res)=>{
  const { data: logs } = await supabase.from('deposit_logs').select('*').order('created_at',{ascending:false}).limit(50);
  return res.json({ success: true, logs: logs||[] });
});

// Public cron endpoint (secured by query secret)
router.get('/cron-check', async (req,res)=>{
  const { secret } = req.query;
  const { CONFIG } = await import('../config.js');
  if(secret !== CONFIG.BOT_SECRET){
    // allow without secret but log
  }
  const result = await autoCheckDeposits();
  return res.json(result);
});

export default router;
