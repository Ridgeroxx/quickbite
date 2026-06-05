import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
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

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://hungerbite.netlify.app');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://hungerbite.netlify.app; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://hungerbite.netlify.app https://quickbite-joi1.onrender.com"
  );
  next();
});

// ---------- Telegram bot instance (defined early) ----------
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

// ---------- API Routes ----------
app.get('/api/menu', (req, res) => {
  try {
    res.json(menu);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

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

    // Notify payment admins (super or payment)
    const bot = getBotInstance();
    let itemsText = processedItems.map(i => `${i.name}${i.addons?.length ? ` (${i.addons.map(a => a.name).join(', ')})` : ''}`).join('\n');
    
    for (const [adminId, role] of Object.entries(adminRoles)) {
      if (role === 'payment' || role === 'super') {
        bot.sendMessage(parseInt(adminId), `🆕 *New Order #${orderId}*\nCustomer: ${customerName}\nPhone: ${customerPhone}\nItems:\n${itemsText}\nSubtotal: ${CURRENCY}${subtotal}\nDelivery: ${CURRENCY}${DELIVERY_FEE}\nTotal: ${CURRENCY}${total}\nAddress: ${address}\n\n*Waiting for payment*`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '✅ Confirm Payment', callback_data: `confirm_${orderId}` }]] }
        });
      }
    }

    res.json({ orderId, total, momoNumber: MOMO_NUMBER, riderContact: RIDER_CONTACT });
    
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

app.get('/api/orders/:userId', (req, res) => {
  try {
    const userOrders = orders.filter(o => o.userId === req.params.userId).sort((a, b) => b.id - a.id);
    res.json(userOrders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/orders', (req, res) => {
  try {
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/orders/stats/summary', (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.patch('/api/orders/:id/status', (req, res) => {
  try {
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
    if (status === 'confirmed') {
      bot.sendMessage(order.userId, `✅ Your order #${id} payment has been confirmed. We are preparing your meal.`);
    }
    if (status === 'processing') {
      bot.sendMessage(order.userId, `⚙️ Your order #${id} is being prepared.`);
    }
    if (status === 'completed') {
      bot.sendMessage(order.userId, `✅ Your order #${id} is ready for pickup/delivery. We will assign a rider soon.`);
    }
    if (status === 'assigned_to_rider' && order.riderName) {
      bot.sendMessage(order.userId, `🚴 Your order #${id} has been assigned to ${order.riderName}. Contact: ${order.riderPhone || 'N/A'}. They will deliver soon.`);
    }
    if (status === 'delivered') {
      bot.sendMessage(order.userId, `🎉 Order #${id} delivered! Enjoy your meal.`);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

app.get('/api/menu/all', (req, res) => { res.json({ items: menu }); });
app.post('/api/menu', (req, res) => {
  try {
    const { name, price, category } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Missing fields' });
    const newId = Math.max(...menu.map(i => i.id), 0) + 1;
    const newItem = { id: newId, name, category: category || 'Other', basePrice: parseFloat(price), emoji: '🍽️', addons: [] };
    menu.push(newItem);
    saveMenu();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add menu item' });
  }
});
app.patch('/api/menu/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const idx = menu.findIndex(i => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    Object.assign(menu[idx], req.body);
    saveMenu();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});
app.delete('/api/menu/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    menu = menu.filter(i => i.id !== id);
    saveMenu();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

app.get('/api/riders', (req, res) => { res.json({ riders }); });
app.post('/api/riders', (req, res) => {
  try {
    const { telegramId, name, phone } = req.body;
    if (!telegramId || !name) return res.status(400).json({ error: 'Missing fields' });
    if (riders.find(r => r.telegramId == telegramId)) return res.status(400).json({ error: 'Rider already exists' });
    riders.push({ telegramId: parseInt(telegramId), name, phone: phone || '', isAvailable: 'true' });
    saveRiders();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add rider' });
  }
});
app.patch('/api/riders/:id/availability', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const rider = riders.find(r => r.telegramId === id);
    if (!rider) return res.status(404).json({ error: 'Not found' });
    rider.isAvailable = req.body.isAvailable ? 'true' : 'false';
    saveRiders();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update rider availability' });
  }
});
app.delete('/api/riders/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    riders = riders.filter(r => r.telegramId !== id);
    saveRiders();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete rider' });
  }
});

app.get('/health', (req, res) => res.send('OK'));

// ---------- Global error handler ----------
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------- Telegram Bot Handlers ----------
function setupBotHandlers(bot) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🇬🇭 Welcome to QuickBite!\nOrder authentic Ghanaian dishes.\nUse our web app: https://hungerbite.netlify.app\n\n*To get your Telegram ID (for admin roles), send a message to @userinfobot.`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/order/, (msg) => {
    bot.sendMessage(msg.chat.id, '🍔 Click below to order:', {
      reply_markup: { inline_keyboard: [[{ text: '🛒 Open QuickBite', web_app: { url: 'https://hungerbite.netlify.app' } }]] }
    });
  });

  bot.onText(/\/admin_orders/, (msg) => {
    if (!hasRole(msg.from.id, null)) return;
    if (orders.length === 0) return bot.sendMessage(msg.chat.id, "No orders.");
    let text = "*📋 Orders*\n";
    orders.slice(-10).forEach(o => {
      text += `#${o.id} – ${o.status} – GHS ${o.total}\nCustomer: ${o.customerName || '?'}\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/pending/, (msg) => {
    if (!hasRole(msg.from.id, 'payment')) return;
    const pending = orders.filter(o => o.status === 'pending_payment');
    if (!pending.length) return bot.sendMessage(msg.chat.id, "No pending payments.");
    let text = "*⏳ Pending Payments*\n";
    pending.forEach(o => {
      text += `#${o.id} – ${o.customerName} – GHS ${o.total}\n`;
    });
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
    if (rider) {
      rider.phone = phone;
      saveRiders();
      bot.sendMessage(msg.chat.id, `Phone for ${rider.name} set to ${phone}`);
    } else bot.sendMessage(msg.chat.id, 'Rider not found.');
  });

  bot.onText(/\/riders/, (msg) => {
    if (!hasRole(msg.from.id, 'rider')) return;
    if (riders.length === 0) return bot.sendMessage(msg.chat.id, "No riders.");
    let text = "*🛵 Riders*\n";
    riders.forEach(r => {
      text += `${r.name} – ${r.isAvailable === 'true' ? 'Available' : 'Busy'} – ${r.phone || 'No phone'}\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/set_role (\d+) (\w+)/, (msg, match) => {
    if (!hasRole(msg.from.id, 'super')) return;
    const targetId = parseInt(match[1]);
    const role = match[2];
    if (!['payment', 'order', 'rider', 'super'].includes(role)) {
      bot.sendMessage(msg.chat.id, 'Invalid role. Use: payment, order, rider, super');
      return;
    }
    adminRoles[targetId] = role;
    saveAdminRoles();
    bot.sendMessage(msg.chat.id, `User ${targetId} is now a ${role} admin.`);
  });

  bot.onText(/\/admin_panel/, (msg) => {
    if (!hasRole(msg.from.id, null)) return;
    bot.sendMessage(msg.chat.id, '📊 Admin Dashboard', {
      reply_markup: { inline_keyboard: [[{ text: '📋 Open Admin Panel', web_app: { url: 'https://hungerbite.netlify.app/admin.html' } }]] }
    });
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
      bot.sendMessage(userId, '✅ Payment recorded. Your order will be confirmed soon.');
      for (const [adminId, role] of Object.entries(adminRoles)) {
        if (role === 'payment' || role === 'super') {
          bot.sendMessage(parseInt(adminId), `💳 Payment reference received for order #${orderId}\nRef: ${ref}\nCustomer: ${order.customerName}\nAmount: GHS ${order.total}`, {
            reply_markup: { inline_keyboard: [[{ text: '✅ Confirm Payment', callback_data: `confirm_${orderId}` }]] }
          });
        }
      }
    } else {
      bot.sendMessage(userId, 'Order not found, already paid, or you are not the customer.');
    }
  });

  bot.on('callback_query', async (cq) => {
    const chatId = cq.message.chat.id;
    const data = cq.data;
    if (data.startsWith('confirm_')) {
      if (!hasRole(cq.from.id, 'payment')) {
        await bot.answerCallbackQuery(cq.id, { text: '❌ Only payment managers can confirm payments.' });
        return;
      }
      const orderId = parseInt(data.split('_')[1]);
      const order = orders.find(o => o.id === orderId);
      if (order && order.status === 'paid') {
        order.status = 'confirmed';
        saveOrders();
        bot.sendMessage(order.userId, `✅ Payment confirmed for order #${orderId}. We'll prepare your meal.`);
        bot.sendMessage(chatId, `✅ Order #${orderId} payment confirmed. Now you can move it to 'processing'.`);
        for (const [adminId, role] of Object.entries(adminRoles)) {
          if (role === 'order' || role === 'super') {
            bot.sendMessage(parseInt(adminId), `🔄 Order #${orderId} is now confirmed and ready for processing.`);
          }
        }
      } else {
        bot.sendMessage(chatId, `Order #${orderId} not in 'paid' status or not found.`);
      }
    } else if (data.startsWith('assign_')) {
      if (!hasRole(cq.from.id, 'order')) {
        await bot.answerCallbackQuery(cq.id, { text: '❌ Only order managers can assign riders.' });
        return;
      }
      const parts = data.split('_');
      const orderId = parseInt(parts[1]);
      const riderId = parseInt(parts[2]);
      const order = orders.find(o => o.id === orderId);
      const rider = riders.find(r => r.telegramId === riderId);
      if (order && rider && (order.status === 'completed' || order.status === 'ready')) {
        order.status = 'assigned_to_rider';
        order.riderId = riderId;
        order.riderName = rider.name;
        order.riderPhone = rider.phone || 'No phone';
        saveOrders();
        bot.sendMessage(order.userId, `🚴 Your order #${orderId} has been assigned to ${rider.name}. Contact: ${rider.phone || 'N/A'}. They will deliver soon.`);
        let itemsText = order.items.map(i => `${i.name} ${i.addons?.length ? `(+${i.addons.map(a=>a.name).join(',')})` : ''}`).join('\n');
        bot.sendMessage(riderId, `📦 *New delivery* Order #${orderId}\nCustomer: ${order.customerName}\nPhone: ${order.customerPhone}\nAddress: ${order.address}\nItems:\n${itemsText}\nTotal: ${CURRENCY}${order.total}\n\nClick 'Mark Delivered' when done.`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '✅ Mark Delivered', callback_data: `deliver_${orderId}` }]] }
        });
        bot.sendMessage(chatId, `Order #${orderId} assigned to ${rider.name}.`);
      } else {
        bot.sendMessage(chatId, `Order #${orderId} not ready for rider assignment.`);
      }
    } else if (data.startsWith('deliver_')) {
      const orderId = parseInt(data.split('_')[1]);
      const order = orders.find(o => o.id === orderId);
      if (order && order.status === 'assigned_to_rider') {
        order.status = 'delivered';
        saveOrders();
        bot.sendMessage(order.userId, `🎉 Order #${orderId} delivered! Enjoy your meal.`);
        bot.sendMessage(chatId, `Order #${orderId} marked as delivered.`);
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
      bot.sendMessage(order.userId, `⚙️ Your order #${orderId} is now being prepared.`);
      bot.sendMessage(msg.chat.id, `Order #${orderId} is now processing.`);
    } else {
      bot.sendMessage(msg.chat.id, 'Order not found or not confirmed.');
    }
  });

  bot.onText(/\/ready (\d+)/, (msg, match) => {
    if (!hasRole(msg.from.id, 'order')) return;
    const orderId = parseInt(match[1]);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'processing') {
      order.status = 'completed';
      saveOrders();
      bot.sendMessage(order.userId, `✅ Your order #${orderId} is ready. We will assign a rider soon.`);
      bot.sendMessage(msg.chat.id, `Order #${orderId} is ready. Now you can assign a rider using the callback button from the admin panel or via /assign.`);
      for (const [adminId, role] of Object.entries(adminRoles)) {
        if (role === 'rider' || role === 'super') {
          bot.sendMessage(parseInt(adminId), `🚚 Order #${orderId} is ready for rider assignment.`);
        }
      }
    } else {
      bot.sendMessage(msg.chat.id, 'Order not found or not processing.');
    }
  });
}

// ---------- Start server ----------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server on port ${port}`));
getBotInstance();
console.log('🤖 Bot running with full API on Render');