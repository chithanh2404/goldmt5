import express from 'express';
import { supabase } from '../supabase.js';

const router = express.Router();

// POST /api/sepay-webhook - webhook public từ SePay
router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[SePay Webhook] Received:', JSON.stringify(payload).slice(0,1500));

    const amount = parseFloat(payload.transferAmount || payload.amount || payload.transfer_amount || 0);
    const contentRaw = (payload.content || payload.description || payload.transaction_content || '').toString();
    const content = contentRaw.toLowerCase();
    const accountNumber = payload.accountNumber || payload.account_number;

    if (!amount || !content) {
      return res.json({ success: true, message: 'Ignore - missing amount/content' });
    }

    // Bắt pattern [email]_chuyenkhoan -> ví dụ "lamchithanh@gmail.com_chuyenkhoan" hoặc "lamchithanh2404_chuyenkhoan"
    const match = content.match(/([a-z0-9._%+\-]+)_chuyenkhoan/);
    if (!match) {
      console.log('[SePay] Content không chứa _chuyenkhoan:', content);
      return res.json({ success: true, message: 'Content không khớp pattern _chuyenkhoan' });
    }

    const emailPart = match[1];

    const { data: deposits, error } = await supabase.from('bank_deposits')
      .select('*')
      .eq('status','PENDING')
      .ilike('content', `%${emailPart}%`)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    let targetDeposit = null;
    if (deposits && deposits.length > 0) {
      targetDeposit = deposits.find(d => Math.abs(d.vnd_amount - amount) < 5000) || deposits[0];
    }

    if (!targetDeposit) {
      console.log(`[SePay] Không tìm thấy deposit PENDING cho ${emailPart}, amount ${amount}. Đã log để admin kiểm tra.`);
      return res.json({ success: true, message: 'Không tìm thấy deposit pending' });
    }

    const rateToUse = targetDeposit.rate || 26500;
    const usdtFinal = amount / rateToUse;

    await supabase.from('bank_deposits').update({
      status: 'APPROVED',
      sepay_transaction_id: payload.id?.toString() || payload.referenceCode || payload.reference_code,
      sepay_payload: payload,
      approved_at: new Date().toISOString()
    }).eq('id', targetDeposit.id);

    const { data: invs } = await supabase.from('investments').select('*').eq('bank_deposit_id', targetDeposit.id).eq('status','PENDING');
    if (invs && invs.length > 0) {
      for (const inv of invs) {
        await supabase.from('investments').update({
          amount: usdtFinal,
          vnd_amount: amount,
          status: 'APPROVED',
          approved_at: new Date().toISOString(),
          sepay_id: payload.id?.toString()
        }).eq('id', inv.id);
      }
    } else {
      await supabase.from('investments').insert({
        user_id: targetDeposit.user_id,
        amount: usdtFinal,
        vnd_amount: amount,
        method: 'BANK',
        bank_id: targetDeposit.bank_id,
        bank_deposit_id: targetDeposit.id,
        content: contentRaw,
        status: 'APPROVED',
        sepay_id: payload.id?.toString(),
        approved_at: new Date().toISOString()
      });
    }

    if (targetDeposit.bank_id) {
      const { data: bank } = await supabase.from('bank_accounts').select('total_received').eq('id', targetDeposit.bank_id).single();
      await supabase.from('bank_accounts').update({
        status: 'AVAILABLE',
        busy_by_email: null,
        busy_amount: null,
        assigned_at: null,
        total_received: (bank?.total_received || 0) + amount
      }).eq('id', targetDeposit.bank_id);
    }

    try {
      const { sendTelegram } = await import('../services/telegram.js');
      if (sendTelegram) sendTelegram(`✅ SePay AUTO-APPROVED:\n${targetDeposit.email}\n${amount.toLocaleString('vi-VN')} VND → ${usdtFinal.toFixed(2)} USDT\nRate: ${rateToUse}\nContent: ${contentRaw}\nBank: ${accountNumber}`);
    } catch(e){}

    console.log(`✅ SePay approved ${targetDeposit.email}: ${amount} VND -> ${usdtFinal} USDT`);

    res.json({ success: true, approved: true, email: targetDeposit.email, usdt: usdtFinal });
  } catch (e) {
    console.error('SePay webhook error', e);
    res.status(200).json({ success: false, error: e.message });
  }
});

export default router;
