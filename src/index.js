const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const PayOS = require('@payos/node');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const FRONTEND_SUCCESS_URL = process.env.FRONTEND_SUCCESS_URL || 'http://127.0.0.1:5500';
const FRONTEND_CANCEL_URL = process.env.FRONTEND_CANCEL_URL || 'http://127.0.0.1:5500';

const dbFile = path.join(__dirname, '..', 'data', 'db.json');

function readDb() {
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}
function writeDb(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}
function nowIso() {
  return new Date().toISOString();
}
function getPayOS() {
  const { PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY } = process.env;
  if (!PAYOS_CLIENT_ID || !PAYOS_API_KEY || !PAYOS_CHECKSUM_KEY) {
    throw new Error('Thiếu PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY trong file .env');
  }
  return new PayOS(PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY);
}
function makeOrderCode() {
  const t = Date.now().toString();
  return Number(t.slice(-12));
}
function normalizePayOSStatus(status) {
  if (!status) return 'PENDING';
  const s = String(status).toUpperCase();
  if (s.includes('PAID')) return 'PAID';
  if (s.includes('CANCEL')) return 'CANCELLED';
  return 'PENDING';
}
function applyPaid(db, order, paidAmount) {
  if (order.paidApplied) return order;
  const userId = order.userId || 'guest';
  db.wallets[userId] = Number(db.wallets[userId] || 0) + Number(paidAmount || order.amount || 0);
  order.status = 'PAID';
  order.paidApplied = true;
  order.paidAt = nowIso();
  db.transactions.push({
    id: `tx_${Date.now()}`,
    type: 'topup',
    userId,
    orderCode: String(order.orderCode),
    amount: Number(paidAmount || order.amount || 0),
    createdAt: nowIso()
  });
  return order;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: nowIso() });
});

app.post('/api/topup/create', async (req, res) => {
  try {
    const payos = getPayOS();
    const amount = Number(req.body.amount || 0);
    const userId = String(req.body.userId || 'guest');
    const description = String(req.body.description || 'Nap tien shop').slice(0, 25);

    if (!Number.isFinite(amount) || amount < 1000) {
      return res.status(400).json({ error: 'Số tiền nạp tối thiểu là 1000' });
    }

    const orderCode = makeOrderCode();
    const body = {
      orderCode,
      amount,
      description,
      returnUrl: `${FRONTEND_SUCCESS_URL}?orderCode=${orderCode}&status=PAID`,
      cancelUrl: `${FRONTEND_CANCEL_URL}?orderCode=${orderCode}&status=CANCELLED`
    };

    const created = await payos.createPaymentLink(body);
    const db = readDb();
    db.orders.push({
      orderCode: String(orderCode),
      amount,
      userId,
      status: 'PENDING',
      paidApplied: false,
      checkoutUrl: created.checkoutUrl || '',
      qrCode: created.qrCode || created.qr_code || '',
      paymentLinkId: created.paymentLinkId || '',
      createdAt: nowIso()
    });
    writeDb(db);

    res.json({
      success: true,
      orderCode: String(orderCode),
      amount,
      status: 'PENDING',
      checkoutUrl: created.checkoutUrl || '',
      qrCode: created.qrCode || created.qr_code || '',
      paymentLinkId: created.paymentLinkId || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Không tạo được link thanh toán' });
  }
});

app.get('/api/topup/status/:orderCode', async (req, res) => {
  try {
    const payos = getPayOS();
    const orderCode = String(req.params.orderCode || '');
    const db = readDb();
    const order = db.orders.find(o => String(o.orderCode) === orderCode);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy orderCode' });

    let status = order.status || 'PENDING';
    try {
      const remote = await payos.getPaymentLinkInformation(Number(orderCode));
      status = normalizePayOSStatus(remote.status);
      order.checkoutUrl = remote.checkoutUrl || order.checkoutUrl || '';
      order.paymentLinkId = remote.paymentLinkId || order.paymentLinkId || '';
      order.qrCode = remote.qrCode || remote.qr_code || order.qrCode || '';
      if (status === 'PAID') applyPaid(db, order, remote.amount || order.amount);
      else order.status = status;
      writeDb(db);
    } catch (_) {
      // keep local status
    }

    res.json({
      orderCode,
      amount: Number(order.amount || 0),
      status: order.status || status,
      checkoutUrl: order.checkoutUrl || '',
      paymentLinkId: order.paymentLinkId || '',
      qrCode: order.qrCode || '',
      paidAt: order.paidAt || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Không kiểm tra được trạng thái' });
  }
});

app.post('/api/payos/webhook', async (req, res) => {
  try {
    const payos = getPayOS();
    const verified = await payos.verifyPaymentWebhookData(req.body);
    const orderCode = String(verified.orderCode || '');
    const db = readDb();
    const order = db.orders.find(o => String(o.orderCode) === orderCode);
    if (order) {
      order.status = 'PAID';
      applyPaid(db, order, verified.amount || order.amount);
      writeDb(db);
    }
    return res.json({ error: 0, message: 'ok' });
  } catch (err) {
    return res.status(400).json({ error: -1, message: err.message || 'Webhook không hợp lệ' });
  }
});

app.get('/api/wallet/:userId', (req, res) => {
  const db = readDb();
  const userId = String(req.params.userId || 'guest');
  res.json({ userId, balance: Number(db.wallets[userId] || 0) });
});

app.get('/api/transactions/:userId', (req, res) => {
  const db = readDb();
  const userId = String(req.params.userId || 'guest');
  res.json(db.transactions.filter(t => t.userId === userId));
});

app.listen(PORT, () => {
  console.log(`payOS backend chạy tại ${BASE_URL}`);
  console.log(`Webhook URL: ${BASE_URL}/api/payos/webhook`);
});
