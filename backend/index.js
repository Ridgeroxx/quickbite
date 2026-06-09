import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const RIDERS_FILE = path.join(__dirname, 'riders.json');
const MENU_FILE = path.join(__dirname, 'menu.json');
const ADMIN_ROLES_FILE = path.join(__dirname, 'admin_roles.json');

// ---------- Environment ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const MOMO_NUMBER = process.env.MOMO_NUMBER || '+233206802552';
const DELIVERY_FEE = parseFloat(process.env.DELIVERY_FEE) || 5.0;
const SERVICE_FEE = parseFloat(process.env.SERVICE_FEE) || 0;
const CURRENCY = process.env.CURRENCY || 'GHS';
const RIDER_CONTACT = process.env.RIDER_CONTACT || '+233 20 000 0000';
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) console.warn('⚠️ ADMIN_SECRET not set. Admin login will fail.');

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');

// ---------- Admin Roles ----------
let adminRoles = {};
if (fs.existsSync(ADMIN_ROLES_FILE)) {
  adminRoles = JSON.parse(fs.readFileSync(ADMIN_ROLES_FILE));
} else {
  const envAdminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
  for (const id of envAdminIds) {
    adminRoles[id] = 'super';
  }
  fs.writeFileSync(ADMIN_ROLES_FILE, JSON.stringify(adminRoles, null, 2));
}
function saveAdminRoles() { fs.writeFileSync(ADMIN_ROLES_FILE, JSON.stringify(adminRoles, null, 2)); }

function hasRole(userId, requiredRole) {
  const role = adminRoles[userId];
  if (!role) return false;
  if (role === 'super') return true;
  if (requiredRole === 'payment') return role === 'payment';
  if (requiredRole === 'order') return role === 'order';
  if (requiredRole === 'rider') return role === 'rider';
  return false;
}

// ---------- Admin Token Store ----------
const validTokens = new Map();

function generateToken(userId, role) {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.set(token, { userId, role, expires: Date.now() + 8 * 3600000 });
  return token;
}

function verifyToken(token) {
  const data = validTokens.get(token);
  if (!data || data.expires < Date.now()) {
    if (data) validTokens.delete(token);
    return null;
  }
  return data;
}

// ---------- Advanced Menu (with vendor, hours, imageUrl) ----------
const DEFAULT_MENU = [
  {
    id: 1, name: 'Jollof Rice', category: 'Rice Dishes', basePrice: 25, emoji: '🍚',
    vendor: 'Auntie Ama Kitchen', hours: '8am – 9pm',
    imageUrl: 'https://images.unsplash.com/photo-1587116861219-230ac19df971?w=400&h=300&fit=crop',
    addons: [
      { id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 },
      { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 },
      { id: 'meat', name: 'Meat (beef)', price: 8 }, { id: 'chicken', name: 'Chicken', price: 10 }
    ]
  },
  {
    id: 2, name: 'Plain Rice', category: 'Rice Dishes', basePrice: 15, emoji: '🍚',
    vendor: 'Times Restaurant', hours: '10am – 10pm',
    imageUrl: 'https://images.unsplash.com/photo-1516684732162-798a0062be99?w=400&h=300&fit=crop',
    addons: [
      { id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 },
      { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 },
      { id: 'meat', name: 'Meat (beef)', price: 8 }
    ]
  },
  {
    id: 3, name: 'Beans and Gari', category: 'Local Dishes', basePrice: 20, emoji: '🍛',
    vendor: 'Awudome Gobe', hours: '6am – 3pm',
    imageUrl: 'https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=400&h=300&fit=crop',
    addons: [
      { id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 },
      { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 },
      { id: 'meat', name: 'Meat (beef)', price: 8 }
    ]
  },
  {
    id: 4, name: 'Indomie', category: 'Noodles', basePrice: 12, emoji: '🍜',
    vendor: 'Quick Noodle Bar', hours: '24 Hours',
    imageUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&h=300&fit=crop',
    addons: [
      { id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 },
      { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 }
    ]
  },
  {
    id: 5, name: 'Banku', category: 'Local Dishes', basePrice: 18, emoji: '🍲',
    vendor: 'Chop Bar', hours: '8am – 9pm',
    imageUrl: 'https://images.unsplash.com/photo-1567982047351-76b6f93e38ee?w=400&h=300&fit=crop',
    addons: [
      { id: 'meat', name: 'Meat (beef)', price: 8 }, { id: 'chicken', name: 'Chicken', price: 10 },
      { id: 'fish', name: 'Fried Fish', price: 12 }
    ]
  },
  {
    id: 6, name: 'Kenkey', category: 'Local Dishes', basePrice: 18, emoji: '🌽',
    vendor: 'Ga Kenkey Spot', hours: '7am – 6pm',
    imageUrl: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=300&fit=crop',
    addons: [
      { id: 'meat', name: 'Meat (beef)', price: 8 }, { id: 'chicken', name: 'Chicken', price: 10 },
      { id: 'fish', name: 'Fried Fish', price: 12 }
    ]
  },
  {
    id: 7, name: 'Coca Cola', category: 'Drinks', basePrice: 5, emoji: '🥤',
    vendor: 'Fresh Juice Corner', hours: '8am – 10pm',
    imageUrl: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=400&h=300&fit=crop',
    addons: []
  },
  {
    id: 8, name: 'Sprite', category: 'Drinks', basePrice: 5, emoji: '🥤',
    vendor: 'Fresh Juice Corner', hours: '8am – 10pm',
    imageUrl: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=400&h=300&fit=crop',
    addons: []
  },
  {
    id: 9, name: 'Water (1L)', category: 'Drinks', basePrice: 4, emoji: '💧',
    vendor: 'Fresh Juice Corner', hours: '24 Hours',
    imageUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400&h=300&fit=crop',
    addons: []
  },
  {
    id: 10, name: 'Palm Wine', category: 'Drinks', basePrice: 8, emoji: '🍷',
    vendor: 'Shugallina', hours: '10am – 8pm',
    imageUrl: 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=400&h=300&fit=crop',
    addons: []
  }
];

let menu = [];
if (fs.existsSync(MENU_FILE)) {
  menu = JSON.parse(fs.readFileSync(MENU_FILE));
} else {
  menu = DEFAULT_MENU;
  fs.writeFileSync(MENU_FILE, JSON.stringify(menu, null, 2));
}
function saveMenu() { fs.writeFileSync(MENU_FILE, JSON.stringify(menu, null, 2)); }

// ---------- Data persistence ----------
let orders = [];
if (fs.existsSync(ORDERS_FILE)) orders = JSON.parse(fs.readFileSync(ORDERS_FILE));
function saveOrders() { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2)); }

let riders = [];
if (fs.existsSync(RIDERS_FILE)) riders = JSON.parse(fs.readFileSync(RIDERS_FILE));
function saveRiders() { fs.writeFileSync(RIDERS_FILE, JSON.stringify(riders, null, 2)); }

// ---------- Express API ----------
const app = express();
app.use(express.json());

// CORS – allow all origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' blob: https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data: https:; connect-src 'self' https:;"
  );
  next();
});

// ---------- Admin Authentication ----------
app.post('/admin/login', (req, res) => {
  const { telegramId } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'Telegram ID required' });
  const userId = parseInt(telegramId);
  const role = adminRoles[userId];
  if (!role) {
    return res.status(403).json({ error: 'You are not authorized as admin.' });
  }
  const token = generateToken(userId, role);
  res.json({ token, role, userName: `Admin (${userId})` });
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const session = verifyToken(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired token' });
  req.admin = session;
  next();
}

// ---------- Public API Routes ----------
app.get('/api/menu', (req, res) => { res.json(menu); });

app.post('/api/orders', async (req, res) => {
  try {
    const { userId, items, address, customerName, customerPhone } = req.body;
    if (!userId || !items || !address || !customerName || !customerPhone) {
      return res.status(400).json({ error: 'Missing customer name, phone, or address' });
    }

    let subtotal = 0;
    const processedItems = items.map(item => {
      let itemTotal = item.basePrice;
      if (item.addons) itemTotal += item.addons.reduce((sum, a) => sum + a.price, 0);
      subtotal += itemTotal * (item.qty || 1);
      return { ...item, totalPrice: itemTotal };
    });

    const total = subtotal + DELIVERY_FEE + SERVICE_FEE;
    const orderId = orders.length + 1;

    const newOrder = {
      id: orderId, userId, customerName, customerPhone, items: processedItems,
      subtotal, deliveryFee: DELIVERY_FEE, serviceFee: SERVICE_FEE, total, address,
      status: 'pending_payment', createdAt: new Date().toISOString(), paymentReference: null,
      riderId: null, riderName: null, riderPhone: null
    };

    orders.push(newOrder);
    saveOrders();

    res.json({ orderId, total, momoNumber: MOMO_NUMBER, riderContact: RIDER_CONTACT });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

app.post('/api/orders/:orderId/payment-reference', (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending_payment') {
      return res.status(400).json({ error: 'Order already paid or not in pending state' });
    }

    order.paymentReference = reference;
    order.status = 'paid';
    saveOrders();

    res.json({ success: true, message: 'Payment reference submitted. Awaiting admin confirmation.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:userId', (req, res) => {
  const userOrders = orders.filter(o => o.userId === req.params.userId).sort((a, b) => b.id - a.id);
  res.json(userOrders);
});

// ---------- Admin API Routes (protected) ----------
app.get('/api/orders', adminAuth, (req, res) => { res.json({ orders }); });
app.get('/api/orders/stats/summary', adminAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600000).toISOString();
  const stats = {
    today: { count: 0, total: 0 }, week: { count: 0, total: 0 },
    month: { count: 0, total: 0 }, all: { count: orders.length, total: orders.reduce((s, o) => s + o.total, 0) }
  };
  orders.forEach(o => {
    if (o.createdAt.startsWith(today)) { stats.today.count++; stats.today.total += o.total; }
    if (o.createdAt >= weekAgo) { stats.week.count++; stats.week.total += o.total; }
    if (o.createdAt >= monthAgo) { stats.month.count++; stats.month.total += o.total; }
  });
  res.json(stats);
});

app.patch('/api/orders/:id/status', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const order = orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { status, riderTelegramId, riderName, riderPhone } = req.body;

  if (status) order.status = status;

  if (riderTelegramId) {
    const rider = riders.find(r => r.telegramId == riderTelegramId);
    if (rider) {
      order.riderId = riderTelegramId;
      order.riderName = rider.name;
      order.riderPhone = rider.phone || 'No phone';
    }
  } else if (riderName && riderPhone) {
    order.riderName = riderName;
    order.riderPhone = riderPhone;
    order.riderId = null;
  }

  saveOrders();
  res.json({ success: true });
});

app.get('/api/menu/all', adminAuth, (req, res) => { res.json({ items: menu }); });

// POST /api/menu — now accepts vendor, hours, imageUrl
app.post('/api/menu', adminAuth, (req, res) => {
  const { name, price, basePrice, category, emoji, vendor, hours, imageUrl } = req.body;
  if (!name || (!price && !basePrice)) return res.status(400).json({ error: 'Missing fields' });
  const newId = Math.max(...menu.map(i => i.id), 0) + 1;
  const newItem = {
    id: newId,
    name,
    category: category || 'Other',
    basePrice: parseFloat(price || basePrice),
    emoji: emoji || '🍽️',
    vendor: vendor || '',
    hours: hours || '',
    imageUrl: imageUrl || '',
    addons: []
  };
  menu.push(newItem);
  saveMenu();
  res.json({ success: true, item: newItem });
});

// PATCH /api/menu/:id — Object.assign handles vendor, hours, imageUrl automatically
app.patch('/api/menu/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const idx = menu.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  Object.assign(menu[idx], req.body);
  saveMenu();
  res.json({ success: true });
});

app.delete('/api/menu/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  menu = menu.filter(i => i.id !== id);
  saveMenu();
  res.json({ success: true });
});

app.get('/api/riders', adminAuth, (req, res) => { res.json({ riders }); });
app.post('/api/riders', adminAuth, (req, res) => {
  const { telegramId, name, phone } = req.body;
  if (!telegramId || !name) return res.status(400).json({ error: 'Missing fields' });
  if (riders.find(r => r.telegramId == telegramId)) return res.status(400).json({ error: 'Rider already exists' });
  riders.push({ telegramId: parseInt(telegramId), name, phone: phone || '', isAvailable: 'true' });
  saveRiders();
  res.json({ success: true });
});
app.patch('/api/riders/:id/availability', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const rider = riders.find(r => r.telegramId === id);
  if (!rider) return res.status(404).json({ error: 'Not found' });
  rider.isAvailable = req.body.isAvailable ? 'true' : 'false';
  saveRiders();
  res.json({ success: true });
});
app.delete('/api/riders/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  riders = riders.filter(r => r.telegramId !== id);
  saveRiders();
  res.json({ success: true });
});

app.get('/health', (req, res) => res.send('OK'));

// ---------- Telegram Bot (user only: start, order, admin_panel) ----------
let botInstance = null;

function getBotInstance() {
  if (!botInstance) {
    console.log('Initializing Telegram bot (user only)...');
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    setupBotHandlers(bot);
    botInstance = bot;
    console.log('🤖 Telegram bot started (user only)');
  }
  return botInstance;
}

function setupBotHandlers(bot) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🇬🇭 Welcome to QuickBite!\nAuthentic Ghanaian dishes delivered to your door.\n\n👉 Tap the blue **Open** button below to start ordering!`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/order/, (msg) => {
    bot.sendMessage(msg.chat.id, '🍔 Tap the button below to open our ordering app:', {
      reply_markup: {
        inline_keyboard: [[{ text: '🛒 Open QuickBite', web_app: { url: 'https://ridgeroxx.github.io/quickbite/' } }]]
      }
    });
  });

  bot.onText(/\/admin_panel/, (msg) => {
    bot.sendMessage(msg.chat.id, '📊 Admin Dashboard', {
      reply_markup: {
        inline_keyboard: [[{ text: '📋 Open Admin Panel', web_app: { url: 'https://ridgeroxx.github.io/quickbite/admin.html' } }]]
      }
    });
  });
}

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server on port ${port}`));
getBotInstance();
console.log('🤖 Bot running (user only, no admin messages)');