import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: process.env.PORT || 10000,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  JWT_SECRET: process.env.JWT_SECRET || 'gold-mt5-secret-2024',
  BOT_SECRET: process.env.BOT_SECRET || 'qmMf9ST5JEBcqVsOfhLaYnjl2KJA2lva',
  BSCSCAN_API_KEY: process.env.BSCSCAN_API_KEY,
  BSC_USDT_CONTRACT: process.env.BSC_USDT_CONTRACT || '0x55d398326f99059ff775485246999027b3197955',
  AUTO_CHECK_ENABLED: process.env.AUTO_CHECK_ENABLED === 'true',
  AUTO_CHECK_TOLERANCE: parseFloat(process.env.AUTO_CHECK_TOLERANCE || '0.5'),
  AUTO_CHECK_CRON: process.env.AUTO_CHECK_CRON || '*/1 * * * *',
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || 'admin@gmail.com').split(',').map(s=>s.trim().toLowerCase()),
  FRONTEND_URL: process.env.FRONTEND_URL || '*',
};
