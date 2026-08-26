import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { CONFIG } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';
import bankRoutes from './routes/bank.js';
import sepayRoutes from './routes/sepay.js';
import { autoCheckDeposits } from './services/autocheck.js';
import { freeStaleBanks } from './routes/bank.js';

dotenv.config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use((req,res,next)=>{
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes
app.get('/', (req,res)=> res.json({ success: true, message: 'GOLD MT5 API - Supabase + OnRender v2 BANK+SEPAY', time: new Date().toISOString() }));
app.get('/api/ping', (req,res)=> res.json({ success: true, time: new Date(), message: 'API OK - BANK SEPAY READY' }));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/sepay-webhook', sepayRoutes);
app.use('/api', adminRoutes); // contains /profits, /bot-push, /admin-*, /cron-check, etc

// Legacy compatibility for old Blogger frontend calling APPSCRIPT_URL with action
app.post('/api/legacy', async (req,res)=>{
  const { action, ...payload } = req.body;
  return res.json({ error: 'Legacy endpoint deprecated, please use new API', action });
});

// Error handler
app.use((err,req,res,next)=>{
  console.error(err);
  res.status(500).json({ error: err.toString() });
});

// Start server
app.listen(CONFIG.PORT, ()=>{
  console.log(`🚀 Backend running on port ${CONFIG.PORT}`);
  console.log(`🔗 Supabase URL: ${CONFIG.SUPABASE_URL}`);

  if(CONFIG.AUTO_CHECK_ENABLED){
    console.log(`⏰ Auto-check cron enabled: ${CONFIG.AUTO_CHECK_CRON}`);
    cron.schedule(CONFIG.AUTO_CHECK_CRON, async ()=>{
      console.log('⏰ Running auto-check deposits (USDT BSCScan)...');
      const result = await autoCheckDeposits();
      console.log('Auto-check result:', result);
    });
    // Thêm cron giải phóng bank BUSY quá 60p mỗi 5 phút
    cron.schedule('*/5 * * * *', async ()=>{
      console.log('⏰ Free stale banks...');
      await freeStaleBanks();
    });
  } else {
    console.log('⏸ Auto-check disabled');
  }
});
