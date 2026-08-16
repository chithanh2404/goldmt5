import express from 'express';
import { supabase } from '../supabase.js';
import { hashPassword, comparePassword, generateToken, isAdminEmail, generateOTP, hashSHA256 } from '../utils/hash.js';
import { sendTelegramMessage } from '../services/telegram.js';
const router = express.Router();

// REGISTER
router.post('/register', async (req,res)=>{
  try{
    const { email, fullName, password, confirmPassword } = req.body;
    if(!email || !password || !fullName) return res.json({ error: 'Thiếu thông tin' });
    if(password !== confirmPassword) return res.json({ error: 'Mật khẩu nhập lại không khớp' });

    const { data: existing } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if(existing) return res.json({ error: 'Email đã tồn tại' });

    const pwHash = await hashPassword(password);
    const { data: user, error } = await supabase.from('users').insert({
      email: email.toLowerCase(),
      full_name: fullName,
      password_hash: pwHash,
      status: 'ACTIVE',
      is_admin: isAdminEmail(email)
    }).select().single();

    if(error) return res.json({ error: error.message });

    try{
      await sendTelegramMessage(`🆕 <b>USER MỚI ĐĂNG KÝ</b>\n\n👤 ${fullName}\n📧 ${email}\n⏰ ${new Date().toLocaleString('vi-VN')}`);
    }catch(e){}

    return res.json({ success: true, user: { id: user.id, email: user.email, fullName: user.full_name } });
  }catch(e){ res.json({ error: e.toString() }); }
});

// LOGIN
router.post('/login', async (req,res)=>{
  try{
    const { email, password } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('email', email.toLowerCase()).single();
    if(error || !user) return res.json({ error: 'Email không tồn tại' });
    if(user.status === 'BLOCKED') return res.json({ error: 'Tài khoản đã bị chặn' });

    const ok = await comparePassword(password, user.password_hash);
    if(!ok) return res.json({ error: 'Sai mật khẩu' });

    // If old SHA256, upgrade to bcrypt
    if(!user.password_hash.startsWith('$2')){
      const newHash = await hashPassword(password);
      await supabase.from('users').update({ password_hash: newHash }).eq('id', user.id);
    }

    const token = generateToken({ id: user.id, email: user.email });
    await supabase.from('users').update({ token }).eq('id', user.id);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        isAdmin: isAdminEmail(user.email) || user.is_admin,
        bankInfo: user.bank_info || {},
        usdtInfo: user.usdt_info || {},
        preferredPayout: user.preferred_payout || 'BANK'
      }
    });
  }catch(e){ res.json({ error: e.toString() }); }
});

// FORGOT - request OTP
router.post('/forgot-request', async (req,res)=>{
  try{
    const { email } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('email', email.toLowerCase()).single();
    if(!user) return res.json({ error: 'Email không tồn tại' });

    const otp = generateOTP();
    await supabase.from('otps').delete().eq('email', email.toLowerCase());
    await supabase.from('otps').insert({
      email: email.toLowerCase(),
      otp,
      expires_at: new Date(Date.now()+5*60*1000).toISOString()
    });

    // TODO: integrate email service - for now return debug
    console.log(`OTP for ${email}: ${otp}`);
    // If you have SMTP, send here

    return res.json({ success: true, otp_debug: otp, message: 'OTP đã tạo (check log email)' });
  }catch(e){ res.json({ error: e.toString() }); }
});

// FORGOT - verify
router.post('/forgot-verify', async (req,res)=>{
  try{
    const { email, otp, newPassword, confirmPassword } = req.body;
    if(newPassword !== confirmPassword) return res.json({ error: 'Mật khẩu nhập lại không khớp' });

    const { data: record } = await supabase.from('otps').select('*').eq('email', email.toLowerCase()).eq('otp', otp).single();
    if(!record) return res.json({ error: 'OTP không đúng' });
    if(new Date() > new Date(record.expires_at)) return res.json({ error: 'OTP hết hạn' });

    const newHash = await hashPassword(newPassword);
    await supabase.from('users').update({ password_hash: newHash }).eq('email', email.toLowerCase());
    await supabase.from('otps').delete().eq('email', email.toLowerCase());

    return res.json({ success: true });
  }catch(e){ res.json({ error: e.toString() }); }
});

export default router;
