import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const RIDERS_FILE = path.join(__dirname, 'riders.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
const MOMO_NUMBER = process.env.MOMO_NUMBER || '+233 50 123 4567';
const DELIVERY_FEE = parseFloat(process.env.DELIVERY_FEE) || 5.0;
const SERVICE_FEE = parseFloat(process.env.SERVICE_FEE) || 0;
const CURRENCY = process.env.CURRENCY || 'GHS';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');

const menuItems = [
  { id: 1, name: 'Cheeseburger', price: 25, category: 'Burgers' },
  { id: 2, name: 'French Fries', price: 10, category: 'Sides' },
  { id: 3, name: 'Coca Cola', price: 5, category: 'Drinks' },
];

const carts = new Map();
let orders = [];
if (fs.existsSync(ORDERS_FILE)) orders = JSON.parse(fs.readFileSync(ORDERS_FILE));
function saveOrders() { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2)); }

let riders = [];
if (fs.existsSync(RIDERS_FILE)) riders = JSON.parse(fs.readFileSync(RIDERS_FILE));
function saveRiders() { fs.writeFileSync(RIDERS_FILE, JSON.stringify(riders, null, 2)); }

const pendingAddress = new Map();

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `Hello! Use /menu to order.`);
});

bot.onText(/\/menu/, (msg) => {
  const keyboard = menuItems.map(item => ([{ text: `${item.name} - ${CURRENCY}${item.price}`, callback_data: `add_${item.id}` }]));
  keyboard.push([{ text: '🛒 Cart', callback_data: 'view_cart' }]);
  bot.sendMessage(msg.chat.id, 'Menu:', { reply_markup: { inline_keyboard: keyboard } });
});

bot.on('callback_query', async (cq) => {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;
  const data = cq.data;

  if (data.startsWith('add_')) {
    const item = menuItems.find(i => i.id === parseInt(data.split('_')[1]));
    if (item) {
      if (!carts.has(userId)) carts.set(userId, { items: [], total: 0 });
      const cart = carts.get(userId);
      const existing = cart.items.find(i => i.id === item.id);
      if (existing) existing.qty++;
      else cart.items.push({ ...item, qty: 1 });
      cart.total = cart.items.reduce((s,i) => s + i.price * i.qty, 0);
      await bot.answerCallbackQuery(cq.id, { text: `Added ${item.name}` });
    }
  } else if (data === 'view_cart') {
    const cart = carts.get(userId);
    if (!cart || cart.items.length === 0) bot.sendMessage(chatId, 'Cart empty');
    else {
      let text = 'Cart:\n';
      cart.items.forEach(i => text += `${i.name} x${i.qty} = ${CURRENCY}${i.price*i.qty}\n`);
      text += `\nTotal: ${CURRENCY}${cart.total}`;
      bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: [[{ text: 'Checkout', callback_data: 'checkout' }], [{ text: 'Clear', callback_data: 'clear_cart' }]] } });
    }
  } else if (data === 'clear_cart') {
    carts.delete(userId);
    bot.sendMessage(chatId, 'Cart cleared.');
  } else if (data === 'checkout') {
    const cart = carts.get(userId);
    if (!cart || cart.items.length === 0) bot.sendMessage(chatId, 'Cart empty');
    else {
      bot.sendMessage(chatId, 'Enter delivery address:');
      pendingAddress.set(userId, cart);
    }
  } else if (data.startsWith('confirm_')) {
    const orderId = parseInt(data.split('_')[1]);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'pending_payment') {
      order.status = 'paid';
      saveOrders();
      bot.sendMessage(order.userId, `Order #${orderId} paid. Rider assigned soon.`);
      const available = riders.filter(r => r.available);
      if (available.length) {
        const buttons = available.map(r => ([{ text: r.name, callback_data: `assign_${orderId}_${r.id}` }]));
        bot.sendMessage(chatId, 'Select rider:', { reply_markup: { inline_keyboard: buttons } });
      } else bot.sendMessage(chatId, 'No riders available. Add with /add_rider');
    }
  } else if (data.startsWith('assign_')) {
    const orderId = parseInt(data.split('_')[1]);
    const riderId = parseInt(data.split('_')[2]);
    const order = orders.find(o => o.id === orderId);
    const rider = riders.find(r => r.id === riderId);
    if (order && rider) {
      order.status = 'assigned';
      order.riderId = riderId;
      saveOrders();
      bot.sendMessage(order.userId, `Order #${orderId} assigned to ${rider.name}.`);
      bot.sendMessage(riderId, `Deliver order #${orderId} to ${order.address}`, { reply_markup: { inline_keyboard: [[{ text: 'Delivered', callback_data: `deliver_${orderId}` }]] } });
    }
  } else if (data.startsWith('deliver_')) {
    const orderId = parseInt(data.split('_')[1]);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'assigned') {
      order.status = 'delivered';
      saveOrders();
      bot.sendMessage(order.userId, `Order #${orderId} delivered! Enjoy.`);
      bot.sendMessage(chatId, `Order #${orderId} delivered.`);
    }
  }
});

bot.on('message', (msg) => {
  const userId = msg.from.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  if (pendingAddress.has(userId)) {
    const cart = pendingAddress.get(userId);
    pendingAddress.delete(userId);
    const total = cart.total + DELIVERY_FEE + SERVICE_FEE;
    const orderId = orders.length + 1;
    orders.push({
      id: orderId, userId, items: cart.items, subtotal: cart.total, deliveryFee: DELIVERY_FEE,
      serviceFee: SERVICE_FEE, total, address: text, status: 'pending_payment', createdAt: new Date().toISOString()
    });
    saveOrders();
    carts.delete(userId);
    bot.sendMessage(userId, `Order #${orderId} placed. Total: ${CURRENCY}${total}. Send payment to ${MOMO_NUMBER} then /paid ${orderId} REFERENCE`);
    ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, `New order #${orderId}. Confirm payment?`, { reply_markup: { inline_keyboard: [[{ text: 'Confirm', callback_data: `confirm_${orderId}` }]] } });
    });
  }
});

bot.onText(/\/paid (\d+) (.+)/, (msg, match) => {
  const orderId = parseInt(match[1]);
  const ref = match[2];
  const userId = msg.from.id;
  const order = orders.find(o => o.id === orderId);
  if (order && order.userId === userId && order.status === 'pending_payment') {
    order.paymentReference = ref;
    order.status = 'waiting_confirm';
    saveOrders();
    bot.sendMessage(userId, 'Payment reference recorded. Waiting for admin confirmation.');
    ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, `Payment ref ${ref} for order #${orderId}`, { reply_markup: { inline_keyboard: [[{ text: 'Confirm', callback_data: `confirm_${orderId}` }]] } });
    });
  } else bot.sendMessage(userId, 'Order not found or already paid.');
});

bot.onText(/\/admin/, (msg) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  const pending = orders.filter(o => o.status === 'waiting_confirm');
  pending.forEach(o => {
    bot.sendMessage(msg.chat.id, `Order #${o.id} - ${CURRENCY}${o.total} - Ref: ${o.paymentReference}`, { reply_markup: { inline_keyboard: [[{ text: 'Confirm', callback_data: `confirm_${o.id}` }]] } });
  });
});

bot.onText(/\/add_rider (\d+) (.+)/, (msg, match) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  const id = parseInt(match[1]), name = match[2];
  if (!riders.find(r => r.id === id)) {
    riders.push({ id, name, available: true });
    saveRiders();
    bot.sendMessage(msg.chat.id, `Rider ${name} added.`);
  }
});

const app = express();
const port = process.env.PORT || 3000;
app.get('/health', (req, res) => res.send('OK'));
app.listen(port, () => console.log(`Server on port ${port}`));
console.log('Bot started with polling');
