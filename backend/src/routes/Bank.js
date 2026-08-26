
const express = require('express');
const router = express.Router();
const { supabase } = require('../supabase');
const { authenticate, requireAdmin } = require('../auth');
const fetch = require('node-fetch');

// Cache rate trong memory + DB
let cachedRate = { rate: 26500, updatedAt: 0, source: 'default' };

async function getRate() {
  try {
    // 1. Ưu tiên DB settings
    const { data: setting } = await supabase.from('settings').select('value, updated_at').eq('key','usdt_vnd_rate').single();
    if (setting && setting.value) {
      const dbRate = parseFloat(setting.value);
      const age = Date.now() - new Date(setting.updated_at).getTime();
      // Nếu admin set trong 24h thì dùng luôn
      if (age < 24*60*60*1000) {
        cachedRate = { rate: dbRate, updatedAt: Date.now(), source: 'admin_db' };
        return cachedRate;
      }
    }
    // 2. CoinGecko
    const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=vnd', { timeout: 5000 });
    const cgJson = await cgRes.json();
    if (cgJson?.tether?.vnd) {
      cachedRate = { rate: parseFloat(cgJson.tether.vnd), updatedAt: Date.now(), source: 'coingecko' };
      return cachedRate;
    }
  } catch (e) {
    console.log('getRate error', e.message);
  }
  return cachedRate;
}

// GET /api/bank/usdt-vnd-rate - public, user thấy khi nạp VND
router.get('/usdt-vnd-rate', async (req, res) => {
  const r = await getRate();
  res.json({ success: true, rate: r.rate, source: r.source, updatedAt: r.updatedAt });
});

// POST /api/bank/request-deposit - user tạo lệnh nạp VND
router.post('/request-deposit', authenticate, async (req, res) => {
  try {
    const { vndAmount, rate } = req.body;
    const user = req.user;
    const vnd = parseFloat(vndAmount);
    if (!vnd || vnd < 10000) return res.json({ success: false, error: 'Số tiền VND tối thiểu 10,000' });

    const rateInfo = await getRate();
    const useRate = parseFloat(rate) || rateInfo.rate;
    const usdtAmount = vnd / useRate;

    // Xoay vòng bank giống ví USDT: lấy bank AVAILABLE đầu tiên, khóa BUSY
    const { data: banks } = await supabase.from('bank_accounts').select('*').eq('status','AVAILABLE').limit(10);
    let selectedBank = null;
    if (banks && banks.length > 0) {
      selectedBank = banks[0];
      // Khóa bank này BUSY 60p
      await supabase.from('bank_accounts').update({
        status: 'BUSY',
        busy_by_email: user.email,
        busy_amount: vnd,
        assigned_at: new Date().toISOString()
      }).eq('id', selectedBank.id);
    } else {
      // fallback lấy bank đầu tiên
      const { data: anyBank } = await supabase.from('bank_accounts').select('*').limit(1).single();
      selectedBank = anyBank;
      if (!selectedBank) return res.json({ success: false, error: 'Chưa cấu hình tài khoản ngân hàng nhận tiền' });
    }

    const content = `${user.email}_chuyenkhoan`;
    const depositId = `BANK_${Date.now()}_${user.id.slice(0,6)}`;

    // Lưu bank_deposits
    const { data: deposit, error } = await supabase.from('bank_deposits').insert({
      id: undefined, // auto uuid, nhưng mình lưu deposit code vào content? dùng id riêng
      user_id: user.id,
      email: user.email,
      vnd_amount: vnd,
      usdt_amount: usdtAmount,
      rate: useRate,
      bank_id: selectedBank.id,
      content: content,
      status: 'PENDING'
    }).select().single();

    // Tạo investments PENDING luôn (để admin thấy)
    await supabase.from('investments').insert({
      user_id: user.id,
      amount: usdtAmount,
      vnd_amount: vnd,
      method: 'BANK',
      bank_id: selectedBank.id,
      bank_deposit_id: deposit?.id,
      content: content,
      status: 'PENDING'
    });

    // Telegram notify
    try {
      const { sendTelegram } = require('../services/telegram');
      sendTelegram(`🏦 Yêu cầu nạp BANK: ${user.email} - ${vnd.toLocaleString('vi-VN')} VND ~ ${usdtAmount.toFixed(2)} USDT\nNội dung: ${content}\nBank: ${selectedBank.bank_name} ${selectedBank.account_number}`);
    } catch(e){}

    res.json({
      success: true,
      depositId: deposit?.id || depositId,
      bank: selectedBank,
      usdtAmount,
      rate: useRate,
      content
    });
  } catch (e) {
    console.error('request-deposit error', e);
    res.json({ success: false, error: e.message });
  }
});

// POST /api/bank/confirm-deposit - user bấm đã chuyển khoản
router.post('/confirm-deposit', authenticate, async (req, res) => {
  // Chỉ ghi nhận, chờ SePay webhook tự duyệt
  res.json({ success: true, message: 'Đã ghi nhận, SePay sẽ tự duyệt khi tiền về' });
});

// ========== ADMIN ==========
router.get('/admin/list', authenticate, requireAdmin, async (req, res) => {
  const { data: banks } = await supabase.from('bank_accounts').select('*').order('created_at', { ascending: true });
  const rateInfo = await getRate();
  res.json({ success: true, banks: banks || [], rate: rateInfo.rate, source: rateInfo.source });
});

router.post('/admin/add', authenticate, requireAdmin, async (req, res) => {
  const { bankCode, bankName, accountNumber, accountName, label } = req.body;
  if (!accountNumber) return res.json({ success: false, error: 'Missing accountNumber' });
  const { data, error } = await supabase.from('bank_accounts').insert({
    bank_code: bankCode?.toUpperCase() || 'MB',
    bank_name: bankName || bankCode,
    account_number: accountNumber,
    account_name: accountName,
    label: label || `Bank ${Date.now()}`
  }).select();
  if (error) return res.json({ success: false, error: error.message });
  const { data: banks } = await supabase.from('bank_accounts').select('*');
  res.json({ success: true, banks, bank: data[0] });
});

router.post('/admin/delete', authenticate, requireAdmin, async (req, res) => {
  const { bankId, id } = req.body;
  const delId = bankId || id;
  const { error } = await supabase.from('bank_accounts').delete().eq('id', delId);
  if (error) return res.json({ success: false, error: error.message });
  const { data: banks } = await supabase.from('bank_accounts').select('*');
  res.json({ success: true, banks });
});

router.post('/admin/update-rate', authenticate, requireAdmin, async (req, res) => {
  const { rate } = req.body;
  if (!rate) return res.json({ success: false, error: 'Missing rate' });
  const { error } = await supabase.from('settings').upsert({ key: 'usdt_vnd_rate', value: String(rate), updated_at: new Date().toISOString() });
  if (error) return res.json({ success: false, error: error.message });
  cachedRate = { rate: parseFloat(rate), updatedAt: Date.now(), source: 'admin_manual' };
  res.json({ success: true, rate: parseFloat(rate) });
});

// Cron: tự động giải phóng bank BUSY quá 60 phút (giống ví USDT)
async function freeStaleBanks() {
  const oneHourAgo = new Date(Date.now() - 60*60*1000).toISOString();
  await supabase.from('bank_accounts').update({ status: 'AVAILABLE', busy_by_email: null, busy_amount: null, assigned_at: null }).eq('status','BUSY').lt('assigned_at', oneHourAgo);
}

setInterval(freeStaleBanks, 5*60*1000);

module.exports = router;
