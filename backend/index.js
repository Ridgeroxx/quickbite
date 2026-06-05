import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const RIDERS_FILE = path.join(__dirname, 'riders.json');
const MENU_FILE = path.join(__dirname, 'menu.json');

// ---------- Environment ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
const MOMO_NUMBER = process.env.MOMO_NUMBER || '+233206802552';
const DELIVERY_FEE = parseFloat(process.env.DELIVERY_FEE) || 5.0;
const SERVICE_FEE = parseFloat(process.env.SERVICE_FEE) || 0;
const CURRENCY = process.env.CURRENCY || 'GHS';
const RIDER_CONTACT = process.env.RIDER_CONTACT || '+233 20 000 0000';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');

// ---------- Advanced Menu (Ghanaian Dishes with Add-ons) ----------
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

const pendingAddress = new Map();

// ---------- Express API with CORS and relaxed CSP ----------
const app = express();
app.use(express.json());

// ✅ CORS middleware – allow Netlify frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://hungerbite.netlify.app');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ✅ Override restrictive CSP headers (allow external fonts, scripts for frontend)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://hungerbite.netlify.app; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://hungerbite.netlify.app https://quickbite-joi1.onrender.com"
  );
  next();
});

// ---------- Public API Endpoints ----------
app.get('/api/menu', (req, res) => {
  res.json(menu);
});

app.post('/api/orders', (req, res) => {
  const { userId, items, address } = req.body;
  if (!userId || !items || !address) return res.status(400).json({ error: 'Missing fields' });

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
    id: orderId,
    userId,
    items: processedItems,
    subtotal,
    deliveryFee: DELIVERY_FEE,
    serviceFee: SERVICE_FEE,
    total,
    address,
    status: 'pending_payment',
    createdAt: new Date().toISOString(),
    paymentReference: null,
  };
  orders.push(newOrder);
  saveOrders();

  ADMIN_IDS.forEach(adminId => {
    const bot = getBotInstance();
    let itemsText = processedItems.map(i => `${i.name}${i.addons?.length ? ` (${i.addons.map(a => a.name).join(', ')})` : ''}`).join('\n');
    bot.sendMessage(adminId, `🆕 *New Order #${orderId}*\nUser: ${userId}\nItems:\n${itemsText}\nSubtotal: ${CURRENCY}${subtotal}\nDelivery: ${CURRENCY}${DELIVERY_FEE}\nTotal: ${CURRENCY}${total}\nAddress: ${address}`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '✅ Confirm Payment', callback_data: `confirm_${orderId}` }]] }
    });
  });

  res.json({ orderId, total, momoNumber: MOMO_NUMBER, riderContact: RIDER_CONTACT });
});

app.get('/api/orders/:userId', (req, res) => {
  const userOrders = orders.filter(o => o.userId === req.params.userId).sort((a, b) => b.id - a.id);
  res.json(userOrders);
});

// ---------- Admin API Endpoints ----------
app.get('/api/orders', (req, res) => {
  res.json({ orders });
});

app.get('/api/orders/stats/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600000).toISOString();
  const stats = {
    today: { count: 0, total: 0 },
    week: { count: 0, total: 0 },
    month: { count: 0, total: 0 },
    all: { count: orders.length, total: orders.reduce((s, o) => s + o.total, 0) }
  };
  orders.forEach(o => {
    if (o.createdAt.startsWith(today)) { stats.today.count++; stats.today.total += o.total; }
    if (o.createdAt >= weekAgo) { stats.week.count++; stats.week.total += o.total; }
    if (o.createdAt >= monthAgo) { stats.month.count++; stats.month.total += o.total; }
  });
  res.json(stats);
});

app.patch('/api/orders/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const order = orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { status, riderTelegramId } = req.body;
  if (status) order.status = status;
  if (riderTelegramId) order.riderId = riderTelegramId;
  saveOrders();
  const bot = getBotInstance();
  if (status === 'confirmed') {
    bot.sendMessage(order.userId, `✅ Your order #${id} has been confirmed and is being prepared.`);
  }
  if (status === 'assigned' && riderTelegramId) {
    const rider = riders.find(r => r.telegramId == riderTelegramId);
    if (rider) {
      bot.sendMessage(order.userId, `🚴 Your order #${id} is out for delivery with ${rider.name}.`);
      bot.sendMessage(riderTelegramId, `📦 New delivery: Order #${id}\nItems: ${order.items.map(i => i.name).join(', ')}\nAddress: ${order.address}\nTotal: ${CURRENCY}${order.total}\nMark delivered when done.`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Mark Delivered', callback_data: `deliver_${id}` }]] }
      });
    }
  }
  res.json({ success: true });
});

// Menu management endpoints
app.get('/api/menu/all', (req, res) => { res.json({ items: menu }); });
app.post('/api/menu', (req, res) => {
  const { name, price, category } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Missing fields' });
  const newId = Math.max(...menu.map(i => i.id), 0) + 1;
  const newItem = { id: newId, name, category: category || 'Other', basePrice: parseFloat(price), emoji: '🍽️', addons: [] };
  menu.push(newItem);
  saveMenu();
  res.json({ success: true });
});
app.patch('/api/menu/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = menu.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  Object.assign(menu[idx], req.body);
  saveMenu();
  res.json({ success: true });
});
app.delete('/api/menu/:id', (req, res) => {
  const id = parseInt(req.params.id);
  menu = menu.filter(i => i.id !== id);
  saveMenu();
  res.json({ success: true });
});

// Riders management
app.get('/api/riders', (req, res) => { res.json({ riders }); });
app.post('/api/riders', (req, res) => {
  const { telegramId, name } = req.body;
  if (!telegramId || !name) return res.status(400).json({ error: 'Missing fields' });
  if (riders.find(r => r.telegramId == telegramId)) return res.status(400).json({ error: 'Rider already exists' });
  riders.push({ telegramId: parseInt(telegramId), name, isAvailable: 'true' });
  saveRiders();
  res.json({ success: true });
});
app.patch('/api/riders/:id/availability', (req, res) => {
  const id = parseInt(req.params.id);
  const rider = riders.find(r => r.telegramId === id);
  if (!rider) return res.status(404).json({ error: 'Not found' });
  rider.isAvailable = req.body.isAvailable ? 'true' : 'false';
  saveRiders();
  res.json({ success: true });
});
app.delete('/api/riders/:id', (req, res) => {
  const id = parseInt(req.params.id);
  riders = riders.filter(r => r.telegramId !== id);
  saveRiders();
  res.json({ success: true });
});

app.get('/health', (req, res) => res.send('OK'));

// ---------- Telegram Bot with retry ----------
let botInstance = null;
let retryCount = 0;

function getBotInstance() {
  if (!botInstance) {
    try {
      const bot = new TelegramBot(BOT_TOKEN, { polling: true });
      bot.deleteWebhook().catch(e => console.log('Webhook delete:', e.message));
      setupBotHandlers(bot);
      botInstance = bot;
      console.log('🤖 Telegram bot started with polling');
      retryCount = 0;
    } catch (err) {
      console.error('Failed to start bot:', err.message);
      if (retryCount < 5) {
        retryCount++;
        setTimeout(() => { botInstance = null; getBotInstance(); }, 5000);
      }
    }
  }
  return botInstance;
}

function setupBotHandlers(bot) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🇬🇭 Welcome to QuickBite Ghana!\nOrder authentic dishes with any add-ons you like.\nUse our web app: https://hungerbite.netlify.app`);
  });
  bot.on('callback_query', async (cq) => {
    const chatId = cq.message.chat.id;
    const data = cq.data;
    if (data.startsWith('confirm_')) {
      const orderId = parseInt(data.split('_')[1]);
      const order = orders.find(o => o.id === orderId);
      if (order && order.status === 'pending_payment') {
        order.status = 'paid';
        saveOrders();
        bot.sendMessage(order.userId, `✅ Payment confirmed for order #${orderId}. We'll prepare your meal.`);
        bot.sendMessage(chatId, `Order #${orderId} marked paid. Now assign a rider.`);
        const availableRiders = riders.filter(r => r.isAvailable === 'true');
        if (availableRiders.length) {
          const buttons = availableRiders.map(r => ([{ text: r.name, callback_data: `assign_${orderId}_${r.telegramId}` }]));
          bot.sendMessage(chatId, 'Select a rider:', { reply_markup: { inline_keyboard: buttons } });
        } else bot.sendMessage(chatId, 'No riders available. Use /add_rider');
      }
    } else if (data.startsWith('assign_')) {
      const parts = data.split('_');
      const orderId = parseInt(parts[1]);
      const riderId = parseInt(parts[2]);
      const order = orders.find(o => o.id === orderId);
      const rider = riders.find(r => r.telegramId === riderId);
      if (order && rider && order.status === 'paid') {
        order.status = 'assigned';
        order.riderId = riderId;
        saveOrders();
        bot.sendMessage(order.userId, `🚴 Order #${orderId} assigned to ${rider.name}. They will deliver soon.`);
        let itemsText = order.items.map(i => `${i.name} ${i.addons?.length ? `(+${i.addons.map(a=>a.name).join(',')})` : ''}`).join('\n');
        bot.sendMessage(riderId, `📦 New delivery: Order #${orderId}\nItems:\n${itemsText}\nAddress: ${order.address}\nTotal: ${CURRENCY}${order.total}`, {
          reply_markup: { inline_keyboard: [[{ text: '✅ Mark Delivered', callback_data: `deliver_${orderId}` }]] }
        });
      }
    } else if (data.startsWith('deliver_')) {
      const orderId = parseInt(data.split('_')[1]);
      const order = orders.find(o => o.id === orderId);
      if (order && order.status === 'assigned') {
        order.status = 'completed';
        saveOrders();
        bot.sendMessage(order.userId, `🎉 Order #${orderId} delivered! Enjoy your meal.`);
        bot.sendMessage(chatId, `Order #${orderId} delivered.`);
      }
    }
  });
  bot.onText(/\/paid (\d+) (.+)/, (msg, match) => {
    const orderId = parseInt(match[1]);
    const ref = match[2];
    const userId = msg.from.id;
    const order = orders.find(o => o.id === orderId);
    if (order && order.userId === userId && order.status === 'pending_payment') {
      order.paymentReference = ref;
      order.status = 'paid';
      saveOrders();
      bot.sendMessage(userId, 'Payment recorded. Your order will be confirmed soon.');
      ADMIN_IDS.forEach(adminId => {
        bot.sendMessage(adminId, `💳 Payment ref ${ref} for order #${orderId}`, {
          reply_markup: { inline_keyboard: [[{ text: '✅ Confirm', callback_data: `confirm_${orderId}` }]] }
        });
      });
    } else bot.sendMessage(userId, 'Order not found or already paid.');
  });
  bot.onText(/\/admin/, (msg) => {
    if (!ADMIN_IDS.includes(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, 'Admin panel is at your web app URL. Use the HTML dashboard.');
  });
  bot.onText(/\/add_rider (\d+) (.+)/, (msg, match) => {
    if (!ADMIN_IDS.includes(msg.from.id)) return;
    const id = parseInt(match[1]), name = match[2];
    if (!riders.find(r => r.telegramId === id)) {
      riders.push({ telegramId: id, name, isAvailable: 'true' });
      saveRiders();
      bot.sendMessage(msg.chat.id, `Rider ${name} added.`);
    } else bot.sendMessage(msg.chat.id, 'Rider already exists.');
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server on port ${port}`));
getBotInstance();
console.log('🤖 Bot running with full API on Render');