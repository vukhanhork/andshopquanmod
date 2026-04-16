LAM NHANH 3 BUOC

1) Copy file .env.example thanh .env
2) Mo .env, dan 3 key payOS vao
3) Trong terminal, chay:
   npm install
   npm start

NEU CHAY OK:
- Mo file HTML
- Sua PAYOS_BACKEND_BASE_URL thanh http://localhost:3000

KHONG CAN FIREBASE.
Du lieu don nap + so du + lich su giao dich duoc luu tam trong file data/db.json.

WEBHOOK payOS:
- Localhost thuong khong nhan webhook tu internet.
- Muon tu dong that su, deploy backend len Render/Railway/VPS roi dat webhook:
  https://domain-cua-ban/api/payos/webhook

API co san:
- POST /api/topup/create
- GET /api/topup/status/:orderCode
- POST /api/payos/webhook
- GET /api/wallet/:userId
- GET /api/transactions/:userId
