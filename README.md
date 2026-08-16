# GOLD MT5 ULTIMATE - Investor Management System
## Migrated to GitHub + Supabase + OnRender (v14)

Hệ thống quản lý vốn đầu tư Gold Bot MT5, đã chuyển từ Google Apps Script + Google Drive JSON + Blogger sang stack hiện đại:

- **Database:** Supabase (PostgreSQL) - thay thế Drive JSON files
- **Backend:** Node.js Express + Supabase JS + BSCScan auto-check + Telegram
- **Frontend:** React Vite + Tailwind (Gold theme) - thay thế Blogger XML
- **Deploy:** OnRender (2 services: backend + frontend static)
- **Cron:** node-cron trong backend (check deposit mỗi phút)

### Cấu trúc dự án

```
gold-mt5-platform/
├── supabase/
│   ├── schema.sql  # Chạy trong Supabase SQL Editor
│   └── seed.sql    # Seed admin + ví mẫu
├── backend/        # Node Express API
│   ├── src/
│   │   ├── index.js
│   │   ├── config.js
│   │   ├── supabase.js
│   │   ├── auth.js
│   │   ├── routes/ (auth, user, wallet, admin)
│   │   └── services/ (bscscan, telegram, autocheck)
│   └── Dockerfile
├── frontend/       # React Vite
│   ├── src/App.jsx # Full UI (dashboard, admin, chart)
│   └── Dockerfile
├── render.yaml     # Blueprint cho OnRender
└── .env.example
```

### Bước 1: Tạo Supabase project

1. Vào https://supabase.com tạo project
2. Vào SQL Editor → chạy `supabase/schema.sql`
3. (Tùy chọn) chạy `supabase/seed.sql` - sửa email admin
4. Lấy `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `ANON_KEY` trong Project Settings → API

### Bước 2: Cấu hình .env

Copy `.env.example` → `.env` và điền:

- Supabase keys
- `BSCSCAN_API_KEY` (key cũ: 7CIT8VTPA3VFB1KYEPK3FQDTA8NBK71YGT - nên tạo key mới)
- `TELEGRAM_TOKEN` + `TELEGRAM_CHAT_ID` (bot cũ đang dùng 8205697874:AAH... - nên tạo bot mới)
- `JWT_SECRET` tự tạo random 32 ký tự

### Bước 3: Đẩy lên GitHub

```bash
git init
git add .
git commit -m "Migrate Gold MT5 to Supabase+OnRender"
git branch -M main
git remote add origin https://github.com/<username>/gold-mt5-platform.git
git push -u origin main
```

### Bước 4: Deploy trên OnRender

#### Option A: Dùng render.yaml (Blueprint)

1. Trên OnRender Dashboard → New → Blueprint → chọn repo GitHub
2. Nó sẽ tự tạo 2 services từ `render.yaml`
3. Điền env vars thiếu (Supabase keys, BSCScan, Telegram)
4. Deploy

#### Option B: Tạo thủ công

**Backend Service:**
- Type: Web Service, Root: `backend`, Build: `npm install`, Start: `npm start`
- Env: Node 20, Singapore
- Env vars: như trong `.env.example`

**Frontend Static:**
- Type: Static Site, Root: `frontend`, Build: `npm install && npm run build`, Publish: `dist`
- Env var: `VITE_API_URL=https://your-backend.onrender.com`

### Bước 5: Kết nối MT5 Bot

Bot cũ đang POST đến Apps Script URL với `token=BOT_SECRET`. Đổi URL sang:

```
https://your-backend.onrender.com/api/bot-push
```

Body JSON giữ nguyên:
```json
{
  "token": "qmMf9ST5JEBcqVsOfhLaYnjl2KJA2lva",
  "totalProfit": 123.45,
  "percent": 2.5,
  "balance": 10000,
  ...
}
```

### API Endpoints chính

- `POST /api/auth/register`, `/login`, `/forgot-request`, `/forgot-verify`
- `GET /api/user/my-data` (auth)
- `POST /api/user/update-payout-info`
- `POST /api/wallet/request-wallet` - cấp ví trống
- `POST /api/wallet/add-investment` - tạo yêu cầu đầu tư
- `GET /api/profits` - public, cho chart
- `GET /api/admin-all` - admin
- `POST /api/admin-approve`
- `POST /api/payout-preview`, `/confirm-payout`
- `POST /api/auto-check`, `GET /api/deposit-logs`
- `GET /api/cron-check?secret=...` - cron external nếu cần

### Tính năng giữ nguyên + cải tiến

- ✅ USDT BEP20 wallet pool round-robin + auto-free sau 1h
- ✅ Auto-check BSCScan mỗi phút (5 ví/lần) + auto-approve
- ✅ Telegram thông báo đăng ký, nạp tiền, auto-duyệt
- ✅ Chart profit theo khung 15 phút, lọc 1d/7d/30d/all
- ✅ % pool payout preview
- ✅ Nâng cấp bảo mật: bcrypt thay SHA256, JWT thay custom token, Supabase RLS
- ✅ Không còn giới hạn quota Apps Script

### Lưu ý bảo mật

- API keys cũ trong file `GS_Gold_MT5.txt` đã lộ: BSCScan key, Telegram token, Bot secret. Đã chuyển vào env vars nhưng **bạn nên tạo mới ngay**.
- Đổi `BOT_SECRET` trong MT5 EA và backend env.
- Tạo Telegram bot mới để tránh spam.
- Thêm RLS policies chi tiết hơn nếu cần multi-tenant.

### License

Private - Investor System Gold MT5
