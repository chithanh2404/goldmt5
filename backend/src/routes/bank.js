import express from 'express';
import { supabase } from '../supabase.js';
import { authenticate, requireAdmin } from '../auth.js';

const router = express.Router();

let cachedRate = { rate: 26500, updatedAt: 0, source: 'default' };

async function getRate() {
  try {
    const { data: setting } = await supabase.from('settings').select('value, updated_at').eq('key','usdt_vnd_rate').single();
    if (setting?.value) {
      const dbRate = parseFloat(setting.value);
      const age = Date.now() - new Date(setting.updated_at).getTime();
      if (age < 24*60*60*1000) {
        cachedRate = { rate: dbRate, updatedAt: Date.now(), source: 'admin_db' };
        return cachedRate;
      }
    }
    // Dùng fetch global của Node 20, không cần node-fetch
    const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=vnd');
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

export async function getUsdtVndRate() {
  return await getRate();
}

router.get('/usdt-vnd-rate', async (req, res) => {
  const r = await getRate();
  res.json({ success: true, rate: r.rate, source: r.source, updatedAt: r.updatedAt });
});

router.post('/request-deposit', authenticate, async (req, res) => {
  try {
    const { vndAmount, rate } = req.body;
    const user = req.user;
    const vnd = parseFloat(vndAmount);
    if (!vnd || vnd < 10000) return res.json({ success: false, error: 'Số tiền VND tối thiểu 10,000' });

    const rateInfo = await getRate();
    const useRate = parseFloat(rate) || rateInfo.rate;
    const usdtAmount = vnd / useRate;

    const { data: banks } = await supabase.from('bank_accounts').select('*').eq('status','AVAILABLE').limit(10);
    let selectedBank = null;
    if (banks && banks.length > 0) {
      selectedBank = banks[0];
      await supabase.from('bank_accounts').update({
        status: 'BUSY',
        busy_by_email: user.email,
        busy_amount: vnd,
        assigned_at: new Date().toISOString()
      }).eq('id', selectedBank.id);
    } else {
      const { data: anyBank } = await supabase.from('bank_accounts').select('*').limit(1).maybeSingle();
      selectedBank = anyBank;
      if (!selectedBank) return res.json({ success: false, error: 'Chưa cấu hình tài khoản ngân hàng nhận tiền. Admin thêm trong Quản lý Ngân hàng.' });
    }

    const content = `${user.email}_chuyenkhoan`;

    const { data: deposit, error } = await supabase.from('bank_deposits').insert({
      user_id: user.id,
      email: user.email,
      vnd_amount: vnd,
      usdt_amount: usdtAmount,
      rate: useRate,
      bank_id: selectedBank.id,
      content: content,
      status: 'PENDING'
    }).select().single();

    if (error) throw error;

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

    try {
      const { sendTelegram } = await import('../services/telegram.js');
      if (sendTelegram) sendTelegram(`🏦 Yêu cầu nạp BANK: ${user.email} - ${vnd.toLocaleString('vi-VN')} VND ~ ${usdtAmount.toFixed(2)} USDT\nNội dung: ${content}\nBank: ${selectedBank.bank_name} ${selectedBank.account_number}`);
    } catch(e){}

    res.json({
      success: true,
      depositId: deposit?.id,
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

router.post('/confirm-deposit', authenticate, async (req, res) => {
  res.json({ success: true, message: 'Đã ghi nhận, SePay sẽ tự duyệt khi tiền về' });
});

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
    label: label || `Bank ${Date.now()}`,
    status: 'AVAILABLE'
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

export async function freeStaleBanks() {
  const oneHourAgo = new Date(Date.now() - 60*60*1000).toISOString();
  await supabase.from('bank_accounts').update({ status: 'AVAILABLE', busy_by_email: null, busy_amount: null, assigned_at: null }).eq('status','BUSY').lt('assigned_at', oneHourAgo);
}

export default router;
