import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config.js';
import ws from 'ws';

// Fix for Node 20 on Render - Supabase Realtime needs WebSocket
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws;
}

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    realtime: { transport: ws }
  }
);

export const supabaseAnon = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    realtime: { transport: ws }
  }
);
