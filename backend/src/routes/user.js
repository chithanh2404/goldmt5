import express from 'express';
import { supabase } from '../supabase.js';
import { authMiddleware } from '../auth.js';
const router = express.Router();

router.use(authMiddleware);

// GET MY DATA (stats + investments + transactions + payouts + profits)
router.get('/my-data', async (req,res)=>{
  try{
    const userId = req.user.id;

    const { data: investments } = await supabase.from('investments').select('*').eq('user_id', userId).order('created_at',{ascending:false});
    const { data: transactions } = await supabase.from('transactions').select('*').eq('user_id', userId).order('created_at',{ascending:false}).limit(100);
    const { data: payouts } = await supabase.from('payouts').select('*').eq('user_id', userId).order('created_at',{ascending:false});
    const { data: profits } = await supabase.from('bot_profits').select('*').order('timestamp',{ascending:true}).limit(5000);

    const approvedCapital = (investments||[]).filter(i=>i.status==='APPROVED').reduce((s,i)=>s+parseFloat(i.amount),0);
    const totalProfitReceived = req.user.total_profit_received || 0;
    const ROI = approvedCapital>0 ? totalProfitReceived/approvedCapital*100 : 0;

    // total pool
    const { data: allApproved } = await supabase.from('investments').select('amount').eq('status','APPROVED');
    const totalPool = (allApproved||[]).reduce((s,i)=>s+parseFloat(i.amount),0);
    const sharePercent = totalPool>0 ? approvedCapital/totalPool*100 : 0;

    // Tổng đã trả toàn hệ thống (để trừ vào Balance Bot)
    const { data: allPayouts } = await supabase.from('payouts').select('amount');
    const allPayoutsTotal = (allPayouts||[]).reduce((s,p)=>s+parseFloat(p.amount),0);

    return res.json({
      success: true,
      stats: { totalInvested: approvedCapital, totalProfitReceived, ROI, sharePercent, totalPool },
      investments: investments||[],
      transactions: transactions||[],
      payouts: payouts||[],
      bankInfo: req.user.bank_info||{},
      usdtInfo: req.user.usdt_info||{},
      preferredPayout: req.user.preferred_payout||'BANK',
      profits: profits||[],
      totalPool,
      allPayoutsTotal,
      realBotBalance: null // sẽ tính ở frontend: latest MT5 balance - allPayoutsTotal
    });
  }catch(e){ res.json({ error: e.toString() }); }
});

// UPDATE BANK / USDT / PAYOUT PREF
router.post('/update-payout-info', async (req,res)=>{
  try{
    const { bankName, accountNumber, accountHolder, usdtNetwork, usdtAddress, preferredPayout } = req.body;
    let bank_info = req.user.bank_info || {};
    let usdt_info = req.user.usdt_info || {};

    if(bankName !== undefined) bank_info.bankName = bankName;
    if(accountNumber !== undefined) bank_info.accountNumber = accountNumber;
    if(accountHolder !== undefined) bank_info.accountHolder = accountHolder;
    bank_info.updatedAt = new Date().toISOString();

    if(usdtNetwork !== undefined) usdt_info.network = usdtNetwork;
    if(usdtAddress !== undefined) usdt_info.address = usdtAddress?.trim();
    usdt_info.updatedAt = new Date().toISOString();

    let update = { bank_info, usdt_info };
    if(preferredPayout && ['BANK','USDT'].includes(preferredPayout)){
      update.preferred_payout = preferredPayout;
    }

    const { error } = await supabase.from('users').update(update).eq('id', req.user.id);
    if(error) return res.json({ error: error.message });

    return res.json({ success: true, bankInfo: bank_info, usdtInfo: usdt_info, preferredPayout: update.preferred_payout || req.user.preferred_payout });
  }catch(e){ res.json({ error: e.toString() }); }
});

// PAYOUT HISTORY (user)
router.get('/payout-history', async (req,res)=>{
  try{
    const { data: payouts } = await supabase.from('payouts').select('*').eq('user_id', req.user.id).order('created_at',{ascending:false});
    return res.json({ success: true, payouts: payouts||[], bankInfo: req.user.bank_info, usdtInfo: req.user.usdt_info, preferredPayout: req.user.preferred_payout });
  }catch(e){ res.json({ error: e.toString() }); }
});

export default router;
