-- GOLD MT5 INVESTOR SYSTEM - SUPABASE SCHEMA V1
-- Run this in Supabase SQL Editor

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- USERS TABLE (custom auth to keep compatible with old SHA256 but upgraded to bcrypt)
create table public.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  full_name text not null,
  password_hash text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','BLOCKED')),
  total_invested numeric default 0,
  total_profit_received numeric default 0,
  bank_info jsonb default '{"bankName":"","accountNumber":"","accountHolder":""}'::jsonb,
  usdt_info jsonb default '{"network":"TRC20","address":""}'::jsonb,
  preferred_payout text default 'BANK' check (preferred_payout in ('BANK','USDT')),
  token text,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- INVESTMENTS
create table public.investments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  amount numeric not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  wallet_id uuid,
  wallet_info jsonb,
  tx_hash text,
  tx_from text,
  auto_approved boolean default false,
  created_at timestamptz default now(),
  approved_at timestamptz
);

-- TRANSACTIONS (history)
create table public.transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  type text not null check (type in ('INVEST','PAYOUT','DEPOSIT')),
  amount numeric not null,
  note text,
  created_at timestamptz default now()
);

-- PAYOUTS
create table public.payouts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  amount numeric not null,
  capital numeric,
  share_percent numeric,
  total_pool_profit numeric,
  total_pool_capital numeric,
  note text,
  payout_method text,
  bank_snapshot jsonb,
  usdt_snapshot jsonb,
  admin_email text,
  created_at timestamptz default now()
);

-- USDT DEPOSIT WALLETS (pool)
create table public.deposit_wallets (
  id uuid primary key default uuid_generate_v4(),
  network text not null default 'BEP20',
  address text unique not null,
  label text,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE','BUSY')),
  busy_by uuid references public.users(id),
  busy_by_email text,
  busy_amount numeric,
  assigned_at timestamptz,
  total_received numeric default 0,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

-- BOT PROFITS (MT5 bot pushes every 15m)
create table public.bot_profits (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  time time,
  hour_minute text,
  timestamp_ms bigint,
  timestamp timestamptz,
  server_timestamp timestamptz default now(),
  total_profit numeric,
  daily_profit numeric,
  percent numeric,
  balance numeric,
  equity numeric,
  trades int,
  win_rate numeric,
  drawdown numeric,
  note text,
  created_at timestamptz default now()
);

-- DEPOSIT CHECK LOGS
create table public.deposit_logs (
  id uuid primary key default uuid_generate_v4(),
  wallet_id uuid references public.deposit_wallets(id),
  wallet_label text,
  address text,
  expected_amount numeric,
  busy_by uuid,
  busy_by_email text,
  check_result jsonb,
  auto_approved boolean default false,
  tx_hash text,
  created_at timestamptz default now()
);

-- OTP (forgot password)
create table public.otps (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  otp text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- INDEXES
create index idx_investments_user on public.investments(user_id);
create index idx_investments_status on public.investments(status);
create index idx_transactions_user on public.transactions(user_id);
create index idx_payouts_user on public.payouts(user_id);
create index idx_bot_profits_date on public.bot_profits(date desc);
create index idx_deposit_wallets_status on public.deposit_wallets(status);
create index idx_users_email on public.users(email);
create index idx_users_token on public.users(token);

-- UPDATED_AT trigger
create or replace function update_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated_at before update on public.users for each row execute function update_updated_at();

-- RLS - for now disable RLS for backend service role (backend uses service_role key)
-- Enable but allow all for service_role
alter table public.users enable row level security;
alter table public.investments enable row level security;
alter table public.transactions enable row level security;
alter table public.payouts enable row level security;
alter table public.deposit_wallets enable row level security;
alter table public.bot_profits enable row level security;
alter table public.deposit_logs enable row level security;
alter table public.otps enable row level security;

-- Policies for service_role (bypass) and anon read for profits
create policy "Allow all for service_role" on public.users for all using (true) with check (true);
create policy "Allow all for service_role" on public.investments for all using (true) with check (true);
create policy "Allow all for service_role" on public.transactions for all using (true) with check (true);
create policy "Allow all for service_role" on public.payouts for all using (true) with check (true);
create policy "Allow all for service_role" on public.deposit_wallets for all using (true) with check (true);
create policy "Allow all for service_role" on public.bot_profits for all using (true) with check (true);
create policy "Allow all for service_role" on public.deposit_logs for all using (true) with check (true);
create policy "Allow all for service_role" on public.otps for all using (true) with check (true);

-- Public read for profits (chart)
create policy "Public read profits" on public.bot_profits for select using (true);

-- VIEW for pool stats
create or replace view public.pool_stats as
select
  (select count(*) from public.users where status='ACTIVE') as total_users,
  (select coalesce(sum(amount),0) from public.investments where status='APPROVED') as total_pool,
  (select coalesce(sum(total_profit),0) from public.bot_profits) as total_profit_all,
  (select * from public.bot_profits order by timestamp desc limit 1) as latest_profit;
