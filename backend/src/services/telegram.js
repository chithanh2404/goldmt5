import axios from 'axios';
import { CONFIG } from '../config.js';

export async function sendTelegramMessage(text){
  if(!CONFIG.TELEGRAM_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
  try{
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN.trim()}/sendMessage`;
    await axios.post(url, {
      chat_id: CONFIG.TELEGRAM_CHAT_ID.toString().trim(),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, { timeout: 10000 });
  }catch(e){
    console.log('Telegram error:', e.message);
  }
}
