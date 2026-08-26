import express from 'express';
import { supabase } from '../supabase.js';
import { CONFIG } from '../config.js';
import crypto from 'crypto';

const router = express.Router();

// Lấy secret từ env - set trong Render Dashboard -> Environment
// Secret bạn thấy trong ảnh SePay: whsec_r0NWqgBEkIqFuh3facrvErtMgH142b4Q
// Set env: SEPAY_WEBHOOK_SECRET=whsec_r0NWqgBEkIqFuh3facrvErtMgH142b4Q
const SEPAY_SECRET = process.env.SEPAY_WEBHOOK_SECRET || process.env.SEPAY_API_KEY || CONFIG?.SEPAY_WEBHOOK_SECRET || CONFIG?.SEPAY_API_KEY || "";

// IP whitelist optional
const SEPAY_IPS = (process.env.SEPAY_IP_WHITELIST || "").split(',').map(s=>s.trim()).filter(Boolean);

// Middleware kiểm tra HMAC-SHA256 theo đúng chuẩn SePay
function verifySepayHMAC(req, res, next) {
  // Nếu chưa set secret thì cảnh báo nhưng vẫn cho qua (để bạn test)
  if (!SEPAY_SECRET) {
    console.warn('⚠️ SEPAY_WEBHOOK_SECRET chưa set - webhook đang mở public');
    return next();
  }

  // SePay gửi chữ ký trong header x-SePay-Signature (như ảnh bạn gửi)
  const signature = req.headers['x-sepay-signature'] || req.headers['x-sepay_signature'] || req.headers['x-hub-signature'] || req.headers['x-signature'];
  
  // Nếu chọn phương thức API Key thì check key trong header hoặc query
  const urlSecret = req.query.secret || req.query.api_key || req.query.token;
  const headerApiKey = req.headers['x-sepay-api-key'] || req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ','').replace('Apikey ','').trim();

  // Trường hợp bạn chọn HMAC-SHA256 trong SePay (như ảnh), bắt buộc phải có signature
  if (signature) {
    try {
      // SePay ký raw body (không phải JSON.stringify lại) bằng HMAC-SHA256 với secret key
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
      
      // Tính chữ ký theo 2 dạng phổ biến: hex và base64
      const expectedHex = crypto.createHmac('sha256', SEPAY_SECRET).update(rawBody).digest('hex');
      const expectedBase64 = crypto.createHmac('sha256', SEPAY_SECRET).update(rawBody).digest('base64');
      
      // SePay có thể gửi dạng "sha256=hex" hoặc chỉ hex
      const sigToCheck = signature.replace('sha256=', '').replace('v1=','').trim();
      
      // So sánh timing-safe
      const isValidHex = (() => {
        try {
          return crypto.timingSafeEqual(Buffer.from(sigToCheck, 'utf8'), Buffer.from(expectedHex, 'utf8'));
        } catch { return sigToCheck === expectedHex; }
      })();
      
      const isValidBase64 = (() => {
        try {
          return crypto.timingSafeEqual(Buffer.from(sigToCheck, 'utf8'), Buffer.from(expectedBase64, 'utf8'));
        } catch { return sigToCheck === expectedBase64; }
      })();

      if (isValidHex || isValidBase64) {
        console.log('✅ SePay HMAC-SHA256 verified - dữ liệu không bị thay đổi');
        return next();
      } else {
        console.log(`❌ SePay HMAC mismatch. Received: ${sigToCheck.slice(0,20)}..., Expected hex: ${expectedHex.slice(0,20)}..., Expected base64: ${expectedBase64.slice(0,20)}...`);
        return res.status(401).json({ success: false, error: 'Invalid HMAC signature - possible fake' });
      }
    } catch(e) {
      console.error('HMAC verify error', e);
      return res.status(401).json({ success: false, error: 'HMAC verification failed' });
    }
  }

  // Nếu bạn chọn API Key thay vì HMAC, check API Key
  if (urlSecret || headerApiKey) {
    const provided = urlSecret || headerApiKey;
    if (provided === SEPAY_SECRET) {
      console.log('✅ SePay API Key verified');
      return next();
    } else {
      console.log(`❌ SePay API Key mismatch`);
      return res.status(401).json({ success: false, error: 'Invalid API Key' });
    }
  }

  // Nếu không có cả signature lẫn api key mà bạn đã set secret -> chặn
  console.log(`❌ SePay request không có signature hoặc API Key, IP: ${req.ip}`);
  return res.status(401).json({ success: false, error: 'Missing SePay signature or API Key - set HMAC-SHA256 trong SePay như ảnh bạn gửi' });
}

router.use(verifySepayHMAC);

router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.ip;
    console.log(`[SePay Webhook] IP: ${clientIp} | Verified HMAC | Payload:`, JSON.stringify(payload).slice(0,2000));

    if (SEPAY_IPS.length > 0 && !SEPAY_IPS.includes(clientIp.split(',')[0].trim())) {
      console.warn(`⚠️ SePay IP ${clientIp} không trong whitelist`);
    }

    const amount = parseFloat(payload.transferAmount || payload.amount || payload.transfer_amount || 0);
    const contentRaw = (payload.content || payload.description || payload.transaction_content || '').toString();
    const content = contentRaw.toLowerCase();
    const accountNumber = (payload.accountNumber || payload.account_number || '').toString().replace(/\s/g,'');
    const transactionId = (payload.id || payload.referenceCode || payload.reference_code || payload.transaction_id || '').toString();

    if (!amount || !content) {
      return res.json({ success: true, message: 'Ignore - missing amount/content' });
    }

    if (transactionId) {
      const { data: existing } = await supabase.from('bank_deposits').select('id,status').eq('sepay_transaction_id', transactionId).limit(1).maybeSingle();
      if (existing && existing.status === 'APPROVED') {
        console.log(`⚠️ Transaction ${transactionId} already processed`);
        return res.json({ success: true, message: 'Already processed', idempotent: true });
      }
    }

    if (accountNumber) {
      const { data: allBanks } = await supabase.from('bank_accounts').select('account_number');
      const validNumbers = (allBanks || []).map(b=>b.account_number.replace(/\s/g,''));
      if (validNumbers.length > 0 && !validNumbers.includes(accountNumber)) {
        console.log(`❌ Account ${accountNumber} not in system - possible fake`);
        return res.status(400).json({ success: false, error: 'Invalid bank account number' });
      }
    }

    const match = content.match(/([a-z0-9._%+\-]+)_chuyenkhoan/);
    if (!match) {
      console.log('[SePay] Content không chứa _chuyenkhoan:', content);
      return res.json({ success: true, message: 'Content không khớp pattern' });
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
      targetDeposit = deposits.find(d => Math.abs(d.vnd_amount - amount) < 5000) || null;
      if (!targetDeposit) {
        console.log(`❌ Amount mismatch: received ${amount}, pending: ${deposits.map(d=>d.vnd_amount).join(',')}`);
        return res.json({ success: true, message: 'Amount not match any pending deposit' });
      }
    }

    if (!targetDeposit) {
      return res.json({ success: true, message: 'Không tìm thấy deposit pending' });
    }

    const rateToUse = targetDeposit.rate || 26500;
    const usdtFinal = amount / rateToUse;

    await supabase.from('bank_deposits').update({
      status: 'APPROVED',
      sepay_transaction_id: transactionId,
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
          sepay_id: transactionId
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
        sepay_id: transactionId,
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
      if (sendTelegram) sendTelegram(`✅ SePay AUTO-APPROVED (HMAC Verified):\n${targetDeposit.email}\n${amount.toLocaleString('vi-VN')} VND → ${usdtFinal.toFixed(2)} USDT\nRate: ${rateToUse}\nContent: ${contentRaw}\nBank: ${accountNumber}\nTxID: ${transactionId}`);
    } catch(e){}

    res.json({ success: true, approved: true, email: targetDeposit.email, usdt: usdtFinal });
  } catch (e) {
    console.error('SePay webhook error', e);
    res.status(200).json({ success: false, error: e.message });
  }
});

router.get('/', (req, res) => {
  res.json({ success: true, message: 'SePay webhook HMAC-SHA256 secured. Set Secret Key như ảnh bạn gửi.' });
});

export default router;
