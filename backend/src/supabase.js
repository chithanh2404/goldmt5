import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config.js';

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export const supabaseAnon = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);
