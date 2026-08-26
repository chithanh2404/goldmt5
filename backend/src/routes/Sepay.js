
const express = require('express');
const router = express.Router();
const { supabase } = require('../supabase');

// POST /api/sepay-webhook - Public webhook từ SePay
// Cấu hình trong SePay: https://my.sepay.vn -> Webhook URL = https://gold-mt5-backend.onrender.com/api/sepay-webhook
// SePay sẽ gửi mỗi khi có tiền vào

router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[SePay Webhook] Received:', JSON.stringify(payload).slice(0,1000));

    // SePay payload có thể khác nhau tùy cấu hình, chuẩn:
    // { id, gateway, transactionDate, accountNumber, transferAmount, content, description, referenceCode, ... }
    const amount = parseFloat(payload.transferAmount || payload.amount || payload.transfer_amount || 0);
    const contentRaw = (payload.content || payload.description || payload.transaction_content || '').toString();
    const content = contentRaw.toLowerCase();
    const accountNumber = payload.accountNumber || payload.account_number;

    if (!amount || !content) {
      return res.json({ success: true, message: 'Ignore - missing amount/content' });
    }

    // Tìm pattern [email]_chuyenkhoan
    // Ví dụ content: "NGUYEN VAN A chuyen tien abc@gmail.com_chuyenkhoan"
    // Ta extract email
    // Regex bắt email trước _chuyenkhoan
    const match = content.match(/([a-z0-9._%+\-]+)_chuyenkhoan/);
    if (!match) {
      console.log('[SePay] Content không chứa _chuyenkhoan:', content);
      return res.json({ success: true, message: 'Content không khớp pattern' });
    }

    const emailPart = match[1]; // ví dụ "lamchithanh" hoặc "lamchithanh2404@gmail"
    // Tìm trong bank_deposits PENDING có content chứa emailPart
    const { data: deposits, error } = await supabase.from('bank_deposits')
      .select('*')
      .eq('status','PENDING')
      .ilike('content', `%${emailPart}%`)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    let targetDeposit = null;
    if (deposits && deposits.length > 0) {
      // Ưu tiên deposit có vnd_amount gần khớp với amount (cho phép sai số 1000 VND)
      targetDeposit = deposits.find(d => Math.abs(d.vnd_amount - amount) < 5000) || deposits[0];
    }

    if (!targetDeposit) {
      // Thử tìm user bằng email chứa emailPart
      // Nếu SePay giữ nguyên email có @ và . thì ilike sẽ bắt được
      console.log(`[SePay] Không tìm thấy deposit PENDING cho ${emailPart}, amount ${amount}`);
      // Vẫn trả success để SePay không retry liên tục, nhưng log để admin kiểm tra
      return res.json({ success: true, message: 'Không tìm thấy deposit pending, đã log' });
    }

    // Lấy rate lúc tạo deposit hoặc rate hiện tại
    const rateToUse = targetDeposit.rate || 26500;
    const usdtFinal = amount / rateToUse;

    // 1. Update bank_deposits -> APPROVED
    await supabase.from('bank_deposits').update({
      status: 'APPROVED',
      sepay_transaction_id: payload.id?.toString() || payload.referenceCode,
      sepay_payload: payload,
      approved_at: new Date().toISOString()
    }).eq('id', targetDeposit.id);

    // 2. Update investments tương ứng -> APPROVED
    // Tìm investment PENDING có cùng bank_deposit_id hoặc content
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
      // Nếu không có investment PENDING (trường hợp user chưa tạo), tạo mới APPROVED luôn
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

    // 3. Giải phóng bank về AVAILABLE và cộng total_received
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

    // 4. Telegram notify
    try {
      const { sendTelegram } = require('../services/telegram');
      sendTelegram(`✅ SePay AUTO-APPROVED:\n${targetDeposit.email}\n${amount.toLocaleString('vi-VN')} VND → ${usdtFinal.toFixed(2)} USDT\nRate: ${rateToUse}\nContent: ${contentRaw}\nBank: ${accountNumber}`);
    } catch(e){}

    console.log(`✅ SePay approved ${targetDeposit.email}: ${amount} VND -> ${usdtFinal} USDT`);

    res.json({ success: true, approved: true, email: targetDeposit.email, usdt: usdtFinal });
  } catch (e) {
    console.error('SePay webhook error', e);
    res.status(200).json({ success: false, error: e.message }); // trả 200 để SePay không retry quá nhiều
  }
});

module.exports = router;
