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

// ---------- Advanced Menu ----------
const DEFAULT_MENU = [
  { id: 1, name: 'Jollof Rice', category: 'Rice Dishes', basePrice: 25, emoji: '🍚', addons: [{ id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 }, { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 }, { id: 'meat', name: 'Meat (beef)', price: 8 }, { id: 'chicken', name: 'Chicken', price: 10 }] },
  { id: 2, name: 'Plain Rice', category: 'Rice Dishes', basePrice: 15, emoji: '🍚', addons: [{ id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 }, { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 }, { id: 'meat', name: 'Meat (beef)', price: 8 }] },
  { id: 3, name: 'Beans and Gari', category: 'Local Dishes', basePrice: 20, emoji: '🍛', addons: [{ id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 }, { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 }, { id: 'meat', name: 'Meat (beef)', price: 8 }] },
  { id: 4, name: 'Indomie', category: 'Noodles', basePrice: 12, emoji: '🍜', addons: [{ id: 'egg', name: 'Egg', price: 3 }, { id: 'plantain', name: 'Plantain', price: 4 }, { id: 'spaghetti', name: 'Spaghetti', price: 4 }, { id: 'salad', name: 'Salad', price: 3 }] },
  { id: 5, name: 'Banku', category: 'Local Dishes', basePrice: 18, emoji: '🍲', addons: [{ id: 'meat', name: 'Meat (beef)', price: 8 }, { id: 'chicken', name: 'Chicken', price: 10 }, { id: 'fish', name: 'Fried Fish', price: 12 }] },
  { id: 6, name: 'Kenkey', category: 'Local Dishes', basePrice: 18, emoji: '🌽', addons: [{ id: 'meat', name: 'Meat (beef)', price: 8 }, { id: 'chicken', name: 'Chicken', price: 10 }, { id: 'fish', name: 'Fried Fish', price: 12 }] },
  { id: 7, name: 'Coca Cola', category: 'Drinks', basePrice: 5, emoji: '🥤', addons: [] },
  { id: 8, name: 'Sprite', category: 'Drinks', basePrice: 5, emoji: '🥤', addons: [] },
  { id: 9, name: 'Water (1L)', category: 'Drinks', basePrice: 4, emoji: '💧', addons: [] },
  { id: 10, name: 'Palm Wine', category: 'Drinks', basePrice: 8, emoji: '🍷', addons: [] }
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

// CORS – allow all origins (you can restrict later)
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

    // Notify payment admins only
    const bot = getBotInstance();
    const itemsText = processedItems.map(i => `${i.name}${i.addons?.length ? ` (${i.addons.map(a => a.name).join(', ')})` : ''}`).join('\n');
    for (const [adminId, role] of Object.entries(adminRoles)) {
      if (role === 'payment' || role === 'super') {
        bot.sendMessage(parseInt(adminId), `🆕 *New Order #${orderId}*\nCustomer: ${customerName}\nPhone: ${customerPhone}\nItems:\n${itemsText}\nSubtotal: ${CURRENCY}${subtotal}\nDelivery: ${CURRENCY}${DELIVERY_FEE}\nTotal: ${CURRENCY}${total}\nAddress: ${address}`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '✅ Confirm Payment', callback_data: `confirm_${orderId}` }]] }
        }).catch(e => console.error('Failed to send admin notification:', e.message));
      }
    }

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

    // Notify payment admins
    const bot = getBotInstance();
    for (const [adminId, role] of Object.entries(adminRoles)) {
      if (role === 'payment' || role === 'super') {
        bot.sendMessage(parseInt(adminId), `💳 Payment reference received for order #${orderId}\nRef: ${reference}\nCustomer: ${order.customerName}\nAmount: ${CURRENCY}${order.total}`, {
          reply_markup: { inline_keyboard: [[{ text: '✅ Confirm Payment', callback_data: `confirm_${orderId}` }]] }
        });
      }
    }

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
  const { status, riderTelegramId } = req.body;
  if (status) order.status = status;
  if (riderTelegramId) {
    const rider = riders.find(r => r.telegramId == riderTelegramId);
    if (rider) {
      order.riderId = riderTelegramId;
      order.riderName = rider.name;
      order.riderPhone = rider.phone || 'No phone';
    }
  }
  saveOrders();
  const bot = getBotInstance();
  // (no customer notifications)
  res.json({ success: true });
});

app.get('/api/menu/all', adminAuth, (req, res) => { res.json({ items: menu }); });
app.post('/api/menu', adminAuth, (req, res) => {
  const { name, price, category } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Missing fields' });
  const newId = Math.max(...menu.map(i => i.id), 0) + 1;
  const newItem = { id: newId, name, category: category || 'Other', basePrice: parseFloat(price), emoji: '🍽️', addons: [] };
  menu.push(newItem);
  saveMenu();
  res.json({ success: true });
});
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

// ---------- Telegram Bot (admin only) ----------
let botInstance = null;

function getBotInstance() {
  if (!botInstance) {
    console.log('Initializing Telegram bot...');
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    setupBotHandlers(bot);
    botInstance = bot;
    console.log('🤖 Telegram bot started (admin only)');
  }
  return botInstance;
}

function setupBotHandlers(bot) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🇬🇭 Welcome to QuickBite!\nOrder authentic Ghanaian dishes from our web app:\nhttps://ridgeroxx.github.io/quickbite/\n\nAdmins: Use the admin panel for order management.`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/order/, (msg) => {
    bot.sendMessage(msg.chat.id, '🍔 Click below to order:', {
      reply_markup: { inline_keyboard: [[{ text: '🛒 Open QuickBite', web_app: { url: 'https://ridgeroxx.github.io/quickbite/' } }]] }
    });
  });

  // Admin commands (unchanged, but they rely on hasRole)
  bot.onText(/\/admin_orders/, (msg) => {
    if (!hasRole(msg.from.id, null)) return;
    if (orders.length === 0) return bot.sendMessage(msg.chat.id, "No orders.");
    let text = "*📋 Orders*\n";
    orders.slice(-10).forEach(o => { text += `#${o.id} – ${o.status} – GHS ${o.total}\nCustomer: ${o.customerName || '?'}\n`; });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/pending/, (msg) => {
    if (!hasRole(msg.from.id, 'payment')) return;
    const pending = orders.filter(o => o.status === 'pending_payment');
    if (!pending.length) return bot.sendMessage(msg.chat.id, "No pending payments.");
    let text = "*⏳ Pending Payments*\n";
    pending.forEach(o => { text += `#${o.id} – ${o.customerName} – GHS ${o.total}\n`; });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/order (\d+)/, (msg, match) => {
    if (!hasRole(msg.from.id, null)) return;
    const order = orders.find(o => o.id == match[1]);
    if (!order) return bot.sendMessage(msg.chat.id, "Not found");
    let items = order.items.map(i => `${i.name} ${i.addons?.map(a=>a.name).join(',')} x${i.qty}`).join('\n');
    bot.sendMessage(msg.chat.id, `*Order #${order.id}*\nCustomer: ${order.customerName}\nPhone: ${order.customerPhone}\nStatus: ${order.status}\nTotal: GHS ${order.total}\nAddress: ${order.address}\nItems:\n${items}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/stats/, (msg) => {
    if (!hasRole(msg.from.id, null)) return;
    const total = orders.reduce((s,o)=> s+o.total, 0);
    bot.sendMessage(msg.chat.id, `📊 *Stats*\nTotal orders: ${orders.length}\nRevenue: GHS ${total}\nPending: ${orders.filter(o=>o.status==='pending_payment').length}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/add_rider (\d+) (.+)/, (msg, match) => {
    if (!hasRole(msg.from.id, 'rider')) return;
    const id = parseInt(match[1]), name = match[2];
    if (!riders.find(r => r.telegramId === id)) {
      riders.push({ telegramId: id, name, phone: '', isAvailable: 'true' });
      saveRiders();
      bot.sendMessage(msg.chat.id, `Rider ${name} added. Use /rider_phone ${id} <number> to add phone.`);
    } else bot.sendMessage(msg.chat.id, 'Rider already exists.');
  });

  bot.onText(/\/rider_phone (\d+) (.+)/, (msg, match) => {
    if (!hasRole(msg.from.id, 'rider')) return;
    const id = parseInt(match[1]), phone = match[2];
    const rider = riders.find(r => r.telegramId === id);
    if (rider) { rider.phone = phone; saveRiders(); bot.sendMessage(msg.chat.id, `Phone for ${rider.name} set to ${phone}`); }
    else bot.sendMessage(msg.chat.id, 'Rider not found.');
  });

  bot.onText(/\/riders/, (msg) => {
    if (!hasRole(msg.from.id, 'rider')) return;
    if (riders.length === 0) return bot.sendMessage(msg.chat.id, "No riders.");
    let text = "*🛵 Riders*\n";
    riders.forEach(r => { text += `${r.name} – ${r.isAvailable === 'true' ? 'Available' : 'Busy'} – ${r.phone || 'No phone'}\n`; });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/set_role (\d+) (\w+)/, (msg, match) => {
    if (!hasRole(msg.from.id, 'super')) return;
    const targetId = parseInt(match[1]), role = match[2];
    if (!['payment', 'order', 'rider', 'super'].includes(role)) return bot.sendMessage(msg.chat.id, 'Invalid role.');
    adminRoles[targetId] = role;
    saveAdminRoles();
    bot.sendMessage(msg.chat.id, `User ${targetId} is now a ${role} admin.`);
  });

  bot.onText(/\/admin_panel/, (msg) => {
    if (!hasRole(msg.from.id, null)) return;
    bot.sendMessage(msg.chat.id, '📊 Admin Dashboard', {
      reply_markup: { inline_keyboard: [[{ text: '📋 Open Admin Panel', web_app: { url: 'https://ridgeroxx.github.io/quickbite/admin.html' } }]] }
    });
  });

  bot.on('callback_query', async (cq) => {
    const chatId = cq.message.chat.id;
    const data = cq.data;
    if (data.startsWith('confirm_')) {
      if (!hasRole(cq.from.id, 'payment')) return bot.answerCallbackQuery(cq.id, { text: '❌ Only payment managers can confirm payments.' });
      const orderId = parseInt(data.split('_')[1]);
      const order = orders.find(o => o.id === orderId);
      if (order && order.status === 'paid') {
        order.status = 'confirmed';
        saveOrders();
        bot.sendMessage(chatId, `✅ Order #${orderId} confirmed.`);
        for (const [adminId, role] of Object.entries(adminRoles)) {
          if (role === 'order' || role === 'super') bot.sendMessage(parseInt(adminId), `🔄 Order #${orderId} is now confirmed.`);
        }
      } else bot.sendMessage(chatId, 'Order not found or not paid.');
    } else if (data.startsWith('assign_')) {
      if (!hasRole(cq.from.id, 'order')) return bot.answerCallbackQuery(cq.id, { text: '❌ Only order managers can assign riders.' });
      const parts = data.split('_');
      const orderId = parseInt(parts[1]), riderId = parseInt(parts[2]);
      const order = orders.find(o => o.id === orderId);
      const rider = riders.find(r => r.telegramId === riderId);
      if (order && rider && order.status === 'completed') {
        order.status = 'assigned_to_rider';
        order.riderId = riderId;
        order.riderName = rider.name;
        order.riderPhone = rider.phone || 'No phone';
        saveOrders();
        bot.sendMessage(riderId, `📦 *New delivery* Order #${orderId}\nCustomer: ${order.customerName}\nPhone: ${order.customerPhone}\nAddress: ${order.address}\nItems: ${order.items.map(i => i.name).join(', ')}\nTotal: ${CURRENCY}${order.total}`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '✅ Mark Delivered', callback_data: `deliver_${orderId}` }]] }
        });
        bot.sendMessage(chatId, `Order #${orderId} assigned to ${rider.name}.`);
      } else bot.sendMessage(chatId, 'Order not ready for rider assignment.');
    } else if (data.startsWith('deliver_')) {
      const orderId = parseInt(data.split('_')[1]);
      const order = orders.find(o => o.id === orderId);
      if (order && order.status === 'assigned_to_rider') {
        order.status = 'delivered';
        saveOrders();
        bot.sendMessage(chatId, `Order #${orderId} delivered.`);
      }
    }
  });

  bot.onText(/\/process (\d+)/, (msg, match) => {
    if (!hasRole(msg.from.id, 'order')) return;
    const orderId = parseInt(match[1]);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'confirmed') {
      order.status = 'processing';
      saveOrders();
      bot.sendMessage(msg.chat.id, `Order #${orderId} is now processing.`);
    } else bot.sendMessage(msg.chat.id, 'Order not found or not confirmed.');
  });

  bot.onText(/\/ready (\d+)/, (msg, match) => {
    if (!hasRole(msg.from.id, 'order')) return;
    const orderId = parseInt(match[1]);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'processing') {
      order.status = 'completed';
      saveOrders();
      bot.sendMessage(msg.chat.id, `Order #${orderId} is ready.`);
      for (const [adminId, role] of Object.entries(adminRoles)) {
        if (role === 'rider' || role === 'super') bot.sendMessage(parseInt(adminId), `🚚 Order #${orderId} is ready for rider assignment.`);
      }
    } else bot.sendMessage(msg.chat.id, 'Order not found or not processing.');
  });
}

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server on port ${port}`));
getBotInstance();
console.log('🤖 Bot running (admin only)');