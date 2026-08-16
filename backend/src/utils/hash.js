import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { CONFIG } from './config.js';

// Old SHA256 for migration compatibility
export function hashSHA256(p){
  return crypto.createHash('sha256').update(p).digest('hex');
}

// New bcrypt
export async function hashPassword(p){
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(p, salt);
}

export async function comparePassword(p, hash){
  // try bcrypt first, fallback to SHA256 for old users
  if(hash.startsWith('$2')){
    return await bcrypt.compare(p, hash);
  } else {
    // old SHA256
    return hashSHA256(p) === hash;
  }
}

export function generateToken(payload){
  return jwt.sign(payload, CONFIG.JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token){
  try{
    return jwt.verify(token, CONFIG.JWT_SECRET);
  }catch(e){ return null; }
}

export function generateOTP(){
  return Math.floor(100000 + Math.random()*900000).toString();
}

export function isAdminEmail(email){
  return CONFIG.ADMIN_EMAILS.includes(email.toLowerCase());
}

export function formatVN(){
  return new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
}

export function getMT5Time(){
  // MT5 slow 4h vs VN
  const now = new Date();
  return new Date(now.getTime() - 4*60*60*1000);
}
