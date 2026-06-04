import TelegramBot from "node-telegram-bot-api";
import { db, ordersTable, ridersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const ADMIN_IDS = (process.env.ADMIN_IDS ?? "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));
const MOMO_NUMBER = process.env.MOMO_NUMBER ?? "";
const CURRENCY = process.env.CURRENCY ?? "GHS";
const DELIVERY_FEE = process.env.DELIVERY_FEE ?? "5.00";
const SERVICE_FEE = process.env.SERVICE_FEE ?? "0.00";

let bot: TelegramBot | null = null;

export function getBot(): TelegramBot {
  if (!bot) {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN not set");
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    setupHandlers(bot);
    logger.info("Telegram bot started with polling");
  }
  return bot;
}

export async function sendOrderNotification(order: {
  id: number;
  userTelegramId: number;
  userName: string;
  userUsername: string;
  itemsJson: string;
  total: string;
  address: string;
  paymentReference: string;
}): Promise<void> {
  if (!bot) return;
  const items = JSON.parse(order.itemsJson) as Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  const itemLines = items
    .map((i) => `  • ${i.name} x${i.quantity} — ${CURRENCY} ${(i.price * i.quantity).toFixed(2)}`)
    .join("\n");

  const msg =
    `🆕 *New Order #${order.id}*\n` +
    `👤 Customer: ${order.userName}${order.userUsername ? ` (@${order.userUsername})` : ""}\n` +
    `📍 Address: ${order.address}\n` +
    `🧾 Reference: \`${order.paymentReference}\`\n\n` +
    `*Items:*\n${itemLines}\n\n` +
    `💰 *Total: ${CURRENCY} ${order.total}*`;

  for (const adminId of ADMIN_IDS) {
    await bot.sendMessage(adminId, msg, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm Payment", callback_data: `confirm_${order.id}` },
            { text: "❌ Reject", callback_data: `reject_${order.id}` },
          ],
        ],
      },
    });
  }
}

function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(userId);
}

function setupHandlers(bot: TelegramBot): void {
  const MINI_APP_URL = `https://${process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost"}/app`;

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from?.first_name ?? "there";

    await db
      .insert(usersTable)
      .values({
        telegramId: chatId,
        name: `${msg.from?.first_name ?? ""} ${msg.from?.last_name ?? ""}`.trim(),
        role: isAdmin(chatId) ? "admin" : "customer",
      })
      .onConflictDoNothing();

    await bot.sendMessage(
      chatId,
      `👋 Welcome, *${name}*!\n\nOrder delicious food directly from Telegram.\n\nTap the button below to open the menu and place your order! 🍔🍟🥤`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🛒 Open Food App", web_app: { url: MINI_APP_URL } }],
          ],
        },
      },
    );
  });

  bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, "❌ You are not authorized.");
      return;
    }
    const orders = await db
      .select()
      .from(ordersTable)
      .orderBy(ordersTable.createdAt);

    const grouped: Record<string, typeof orders> = {};
    for (const o of orders) {
      if (!grouped[o.status]) grouped[o.status] = [];
      grouped[o.status]!.push(o);
    }

    const statusEmoji: Record<string, string> = {
      pending_payment: "⏳",
      paid: "💳",
      confirmed: "✅",
      assigned: "🛵",
      delivered: "📦",
      completed: "✔️",
    };

    let text = "*📊 Admin Dashboard*\n\n";
    for (const [status, statusOrders] of Object.entries(grouped)) {
      text += `${statusEmoji[status] ?? "•"} *${status.replace("_", " ").toUpperCase()}* (${statusOrders.length})\n`;
      for (const o of statusOrders.slice(0, 5)) {
        text += `  Order #${o.id} — ${CURRENCY} ${o.total} — ${o.address.slice(0, 30)}\n`;
      }
      text += "\n";
    }

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📈 Sales Summary", callback_data: "sales_summary" }],
          [{ text: "📋 Pending Orders", callback_data: "list_pending" }],
        ],
      },
    });
  });

  bot.onText(/\/rider/, async (msg) => {
    const chatId = msg.chat.id;
    const rider = await db
      .select()
      .from(ridersTable)
      .where(eq(ridersTable.telegramId, chatId));

    if (!rider.length) {
      await bot.sendMessage(chatId, "❌ You are not registered as a rider.");
      return;
    }

    const assignedOrders = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.riderTelegramId, chatId),
          eq(ordersTable.status, "assigned"),
        ),
      );

    if (!assignedOrders.length) {
      await bot.sendMessage(chatId, "✅ No active deliveries right now.");
      return;
    }

    for (const order of assignedOrders) {
      const items = JSON.parse(order.itemsJson) as Array<{
        name: string;
        quantity: number;
      }>;
      const itemList = items.map((i) => `• ${i.name} x${i.quantity}`).join("\n");
      await bot.sendMessage(
        chatId,
        `🛵 *Delivery #${order.id}*\n📍 ${order.address}\n\n${itemList}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Mark as Delivered", callback_data: `delivered_${order.id}` }],
            ],
          },
        },
      );
    }
  });

  bot.onText(/\/paid (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const reference = match?.[1]?.trim() ?? "";
    if (!reference) {
      await bot.sendMessage(chatId, "Usage: /paid YOUR_REFERENCE");
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.userTelegramId, chatId));

    if (!order) {
      await bot.sendMessage(chatId, "❌ No order found for your account.");
      return;
    }

    await bot.sendMessage(chatId, `📨 Your payment reference *${reference}* has been forwarded to admin for confirmation.`, {
      parse_mode: "Markdown",
    });

    for (const adminId of ADMIN_IDS) {
      await bot.sendMessage(
        adminId,
        `💳 Payment Reference Received\nOrder #${order.id} — Customer: ${order.userName}\nReference: \`${reference}\``,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Confirm Payment", callback_data: `confirm_${order.id}` },
                { text: "❌ Reject", callback_data: `reject_${order.id}` },
              ],
            ],
          },
        },
      );
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    const data = query.data ?? "";
    const msgId = query.message?.message_id;

    if (!chatId) return;

    if (data.startsWith("confirm_")) {
      if (!isAdmin(chatId)) {
        await bot.answerCallbackQuery(query.id, { text: "Not authorized" });
        return;
      }
      const orderId = parseInt(data.replace("confirm_", ""), 10);
      const [order] = await db
        .update(ordersTable)
        .set({ status: "confirmed" })
        .where(eq(ordersTable.id, orderId))
        .returning();

      await bot.answerCallbackQuery(query.id, { text: "✅ Payment confirmed!" });
      if (msgId) {
        await bot.editMessageText(`✅ Order #${orderId} payment CONFIRMED`, {
          chat_id: chatId,
          message_id: msgId,
        });
      }

      if (order) {
        await bot.sendMessage(order.userTelegramId, `✅ Your payment for Order #${orderId} has been confirmed! We're preparing your order. 🍔`);
      }

      const riders = await db.select().from(ridersTable).where(eq(ridersTable.isAvailable, "true"));
      if (riders.length && order) {
        const keyboard = riders.map((r) => [
          { text: `🛵 ${r.name}`, callback_data: `assign_${orderId}_${r.telegramId}` },
        ]);
        await bot.sendMessage(chatId, `Choose a rider for Order #${orderId}:`, {
          reply_markup: { inline_keyboard: keyboard },
        });
      } else {
        await bot.sendMessage(chatId, "⚠️ No available riders. Add riders with /addrider command.");
      }
    }

    if (data.startsWith("reject_")) {
      if (!isAdmin(chatId)) {
        await bot.answerCallbackQuery(query.id, { text: "Not authorized" });
        return;
      }
      const orderId = parseInt(data.replace("reject_", ""), 10);
      const [order] = await db
        .update(ordersTable)
        .set({ status: "pending_payment" })
        .where(eq(ordersTable.id, orderId))
        .returning();

      await bot.answerCallbackQuery(query.id, { text: "❌ Order rejected" });
      if (msgId) {
        await bot.editMessageText(`❌ Order #${orderId} REJECTED`, {
          chat_id: chatId,
          message_id: msgId,
        });
      }
      if (order) {
        await bot.sendMessage(
          order.userTelegramId,
          `❌ Your payment reference for Order #${orderId} was not verified. Please check and try again with /paid YOUR_REFERENCE`,
        );
      }
    }

    if (data.startsWith("assign_")) {
      if (!isAdmin(chatId)) {
        await bot.answerCallbackQuery(query.id, { text: "Not authorized" });
        return;
      }
      const parts = data.split("_");
      const orderId = parseInt(parts[1] ?? "", 10);
      const riderTelegramId = parseInt(parts[2] ?? "", 10);

      const [rider] = await db.select().from(ridersTable).where(eq(ridersTable.telegramId, riderTelegramId));
      const [order] = await db
        .update(ordersTable)
        .set({ status: "assigned", riderTelegramId })
        .where(eq(ordersTable.id, orderId))
        .returning();

      await db.update(ridersTable).set({ isAvailable: "false" }).where(eq(ridersTable.telegramId, riderTelegramId));

      await bot.answerCallbackQuery(query.id, { text: `Assigned to ${rider?.name}` });
      if (msgId) {
        await bot.editMessageText(`✅ Order #${orderId} assigned to ${rider?.name}`, {
          chat_id: chatId,
          message_id: msgId,
        });
      }

      if (order && rider) {
        const items = JSON.parse(order.itemsJson) as Array<{ name: string; quantity: number }>;
        const itemList = items.map((i) => `• ${i.name} x${i.quantity}`).join("\n");
        await bot.sendMessage(
          riderTelegramId,
          `🛵 *New Delivery #${orderId}*\n📍 Address: ${order.address}\n\n*Items:*\n${itemList}\n\n💰 Total: ${CURRENCY} ${order.total}`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Accept", callback_data: `accept_${orderId}` },
                  { text: "❌ Reject", callback_data: `riderreject_${orderId}` },
                ],
              ],
            },
          },
        );
        await bot.sendMessage(order.userTelegramId, `🛵 Your order is on its way! Rider: *${rider.name}*`, {
          parse_mode: "Markdown",
        });
      }
    }

    if (data.startsWith("accept_")) {
      const orderId = parseInt(data.replace("accept_", ""), 10);
      await bot.answerCallbackQuery(query.id, { text: "Delivery accepted!" });
      if (msgId) {
        await bot.editMessageText(`✅ You accepted delivery #${orderId}. Good luck! 🛵`, {
          chat_id: chatId,
          message_id: msgId,
        });
      }
      await bot.sendMessage(chatId, `Mark order #${orderId} as delivered when done:`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📦 Mark as Delivered", callback_data: `delivered_${orderId}` }],
          ],
        },
      });
    }

    if (data.startsWith("riderreject_")) {
      const orderId = parseInt(data.replace("riderreject_", ""), 10);
      await db.update(ordersTable).set({ status: "confirmed", riderTelegramId: undefined }).where(eq(ordersTable.id, orderId));
      await db.update(ridersTable).set({ isAvailable: "true" }).where(eq(ridersTable.telegramId, chatId));
      await bot.answerCallbackQuery(query.id, { text: "Delivery rejected" });
      for (const adminId of ADMIN_IDS) {
        await bot.sendMessage(adminId, `⚠️ Rider rejected Order #${orderId}. Please assign another rider.`);
      }
    }

    if (data.startsWith("delivered_")) {
      const orderId = parseInt(data.replace("delivered_", ""), 10);
      const [order] = await db
        .update(ordersTable)
        .set({ status: "completed" })
        .where(eq(ordersTable.id, orderId))
        .returning();

      await db.update(ridersTable).set({ isAvailable: "true" }).where(eq(ridersTable.telegramId, chatId));

      await bot.answerCallbackQuery(query.id, { text: "✅ Delivery completed!" });
      if (msgId) {
        await bot.editMessageText(`✅ Order #${orderId} marked as DELIVERED`, {
          chat_id: chatId,
          message_id: msgId,
        });
      }
      if (order) {
        await bot.sendMessage(
          order.userTelegramId,
          `🎉 Your food has been delivered! Enjoy your meal! 😋\n\nThank you for ordering with us!`,
        );
      }
    }

    if (data === "sales_summary") {
      if (!isAdmin(chatId)) return;
      const allOrders = await db.select().from(ordersTable);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const todayOrders = allOrders.filter((o) => new Date(o.createdAt) >= todayStart);
      const weekOrders = allOrders.filter((o) => new Date(o.createdAt) >= weekStart);
      const monthOrders = allOrders.filter((o) => new Date(o.createdAt) >= monthStart);
      const sum = (arr: typeof allOrders) => arr.reduce((s, o) => s + parseFloat(o.total), 0).toFixed(2);

      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(
        chatId,
        `📈 *Sales Summary*\n\n` +
          `📅 Today: ${todayOrders.length} orders — ${CURRENCY} ${sum(todayOrders)}\n` +
          `📅 This Week: ${weekOrders.length} orders — ${CURRENCY} ${sum(weekOrders)}\n` +
          `📅 This Month: ${monthOrders.length} orders — ${CURRENCY} ${sum(monthOrders)}\n` +
          `📦 All Time: ${allOrders.length} orders — ${CURRENCY} ${sum(allOrders)}`,
        { parse_mode: "Markdown" },
      );
    }

    if (data === "list_pending") {
      if (!isAdmin(chatId)) return;
      const pending = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.status, "pending_payment"));

      await bot.answerCallbackQuery(query.id);
      if (!pending.length) {
        await bot.sendMessage(chatId, "✅ No pending orders.");
        return;
      }
      for (const order of pending.slice(0, 10)) {
        const items = JSON.parse(order.itemsJson) as Array<{ name: string; quantity: number }>;
        const itemList = items.map((i) => `• ${i.name} x${i.quantity}`).join("\n");
        await bot.sendMessage(
          chatId,
          `⏳ *Order #${order.id}*\n👤 ${order.userName}\n📍 ${order.address}\n🧾 Ref: \`${order.paymentReference}\`\n\n${itemList}\n\n💰 ${CURRENCY} ${order.total}`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Confirm", callback_data: `confirm_${order.id}` },
                  { text: "❌ Reject", callback_data: `reject_${order.id}` },
                ],
              ],
            },
          },
        );
      }
    }
  });

  logger.info("Bot handlers registered");
}
