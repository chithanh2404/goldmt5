import express from 'express';
import { supabase } from '../supabase.js';
import { authMiddleware, adminMiddleware } from '../auth.js';

const router = express.Router();
router.use(authMiddleware);

// USER: request wallet for invest (round-robin)
router.post('/request-wallet', async (req,res)=>{
  try{
    const { amount } = req.body;
    const amt = parseFloat(amount);
    if(!amt || amt <=0) return res.json({ error: 'Số tiền không hợp lệ' });

    // cleanup expired BUSY >1h
    const oneHourAgo = new Date(Date.now()-60*60*1000).toISOString();
    const { data: expired } = await supabase.from('deposit_wallets').select('*').eq('status','BUSY').lt('assigned_at', oneHourAgo);
    if(expired && expired.length>0){
      for(let w of expired){
        await supabase.from('deposit_wallets').update({
          status:'AVAILABLE', busy_by:null, busy_by_email:null, busy_amount:null, assigned_at:null
        }).eq('id', w.id);
      }
    }

    // find available BEP20 wallet
    const { data: wallets } = await supabase.from('deposit_wallets').select('*').eq('status','AVAILABLE').order('created_at',{ascending:true}).limit(10);
    if(!wallets || wallets.length===0){
      return res.json({ error: 'Hệ thống đang bận, tất cả ví đang được sử dụng. Vui lòng thử lại sau 5 phút.' });
    }
    const wallet = wallets[0];

    const { error } = await supabase.from('deposit_wallets').update({
      status:'BUSY',
      busy_by: req.user.id,
      busy_by_email: req.user.email,
      busy_amount: amt,
      assigned_at: new Date().toISOString()
    }).eq('id', wallet.id);

    if(error) return res.json({ error: error.message });

    return res.json({
      success: true,
      wallet: { id: wallet.id, network: wallet.network, address: wallet.address, label: wallet.label, amount: amt, qrData: wallet.address }
    });
  }catch(e){ res.json({ error: e.toString() }); }
});

// USER: create investment (after getting wallet)
router.post('/add-investment', async (req,res)=>{
  try{
    const { amount, walletId } = req.body;
    const amt = parseFloat(amount);
    if(!amt || amt<=0) return res.json({ error: 'Số tiền không hợp lệ' });

    let walletInfo = null;
    if(walletId){
      const { data: w } = await supabase.from('deposit_wallets').select('*').eq('id', walletId).single();
      if(w) walletInfo = { id: w.id, network: w.network, address: w.address, label: w.label };
    }

    const { data: inv, error } = await supabase.from('investments').insert({
      user_id: req.user.id,
      amount: amt,
      status: 'PENDING',
      wallet_id: walletId||null,
      wallet_info: walletInfo
    }).select().single();

    if(error) return res.json({ error: error.message });

    await supabase.from('transactions').insert({
      user_id: req.user.id,
      type: 'INVEST',
      amount: amt,
      note: `Yêu cầu đầu tư $${amt} qua ${walletInfo ? walletInfo.label+' '+walletInfo.network : 'USDT'}`
    });

    // Telegram
    try{
      const { sendTelegramMessage } = await import('../services/telegram.js');
      const walletText = walletInfo ? `${walletInfo.label} (${walletInfo.network})\n${walletInfo.address}` : 'Chưa chọn ví';
      await sendTelegramMessage(`💸 <b>YÊU CẦU NẠP TIỀN MỚI</b>\n\n👤 ${req.user.full_name}\n📧 ${req.user.email}\n💰 $${amt} USDT\n🏦 ${walletText}\n🆔 ${inv.id}\n⏰ ${new Date().toLocaleString('vi-VN')}\n\n⚠️ PENDING`);
    }catch(e){}

    return res.json({ success: true, investment: inv });
  }catch(e){ res.json({ error: e.toString() }); }
});

// ADMIN wallet management
router.get('/admin/list', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { data: wallets } = await supabase.from('deposit_wallets').select('*').order('created_at',{ascending:true});
    // auto free >1h
    const now = Date.now();
    for(let w of wallets||[]){
      if(w.status==='BUSY' && w.assigned_at && (now - new Date(w.assigned_at).getTime() > 60*60*1000)){
        await supabase.from('deposit_wallets').update({ status:'AVAILABLE', busy_by:null, busy_by_email:null, busy_amount:null, assigned_at:null }).eq('id', w.id);
      }
    }
    const { data: refreshed } = await supabase.from('deposit_wallets').select('*').order('created_at',{ascending:true});
    return res.json({ success: true, wallets: refreshed });
  }catch(e){ res.json({ error: e.toString() }); }
});

router.post('/admin/add', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { network, address, label } = req.body;
    if(!address) return res.json({ error: 'Thiếu địa chỉ ví' });
    const { data: wallet, error } = await supabase.from('deposit_wallets').insert({
      network: network||'BEP20',
      address: address.trim(),
      label: label||`Ví ${Date.now()}`,
      status: 'AVAILABLE'
    }).select().single();
    if(error) return res.json({ error: error.message });
    const { data: wallets } = await supabase.from('deposit_wallets').select('*').order('created_at',{ascending:true});
    return res.json({ success: true, wallet, wallets });
  }catch(e){ res.json({ error: e.toString() }); }
});

router.post('/admin/delete', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { walletId } = req.body;
    const { data: w } = await supabase.from('deposit_wallets').select('*').eq('id', walletId).single();
    if(!w) return res.json({ error: 'Ví không tồn tại' });
    if(w.status==='BUSY') return res.json({ error: 'Không thể xóa ví đang bận' });
    await supabase.from('deposit_wallets').delete().eq('id', walletId);
    const { data: wallets } = await supabase.from('deposit_wallets').select('*').order('created_at',{ascending:true});
    return res.json({ success: true, wallets });
  }catch(e){ res.json({ error: e.toString() }); }
});

router.post('/admin/free', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const { walletId } = req.body;
    await supabase.from('deposit_wallets').update({ status:'AVAILABLE', busy_by:null, busy_by_email:null, busy_amount:null, assigned_at:null }).eq('id', walletId);
    const { data: wallets } = await supabase.from('deposit_wallets').select('*').order('created_at',{ascending:true});
    return res.json({ success: true, wallets });
  }catch(e){ res.json({ error: e.toString() }); }
});

export default router;
