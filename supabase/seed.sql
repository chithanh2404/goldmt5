-- SEED ADMIN + WALLETS (run after schema)
-- Update emails here

insert into public.users (email, full_name, password_hash, is_admin, status)
values
('admin@gmail.com','Admin Gold','{{BCRYPT_HASH_FOR_Admin123}}', true, 'ACTIVE'),
('chithanh2404@gmail.com','Lâm Chí Thành','{{BCRYPT_HASH}}', true, 'ACTIVE')
on conflict (email) do nothing;

-- Example deposit wallets (BEP20)
insert into public.deposit_wallets (network, address, label, status)
values
('BEP20','0x1111111111111111111111111111111111111111','Ví BEP20 #1','AVAILABLE'),
('BEP20','0x2222222222222222222222222222222222222222','Ví BEP20 #2','AVAILABLE'),
('BEP20','0x3333333333333333333333333333333333333333','Ví BEP20 #3','AVAILABLE')
on conflict (address) do nothing;
