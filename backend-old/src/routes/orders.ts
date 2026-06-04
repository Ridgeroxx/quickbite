import { Router, type IRouter } from "express";
import { db, ordersTable, menuTable } from "./lib/index";
import { eq, desc, and } from "drizzle-orm";
import { sendOrderNotification } from "../lib/bot";

const router: IRouter = Router();

router.post("/place-order", async (req, res): Promise<void> => {
  const {
    userTelegramId,
    userName,
    userUsername,
    items,
    address,
    paymentReference,
  } = req.body as {
    userTelegramId?: number;
    userName?: string;
    userUsername?: string;
    items?: Array<{ id: number; name: string; price: number; quantity: number }>;
    address?: string;
    paymentReference?: string;
  };

  if (!userTelegramId || !items?.length || !address || !paymentReference) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2);
  const itemsJson = JSON.stringify(items);

  const [order] = await db
    .insert(ordersTable)
    .values({
      userTelegramId,
      userName: userName ?? "",
      userUsername: userUsername ?? "",
      itemsJson,
      total,
      address,
      paymentReference,
      status: "pending_payment",
    })
    .returning();

  req.log.info({ orderId: order?.id }, "Order placed");

  if (order) {
    await sendOrderNotification(order).catch((err) => {
      req.log.error({ err }, "Failed to send order notification");
    });
  }

  res.status(201).json({ orderId: order?.id, status: "pending_payment" });
});

router.get("/orders", async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };
  const conditions = status ? [eq(ordersTable.status, status)] : [];
  const orders = await db
    .select()
    .from(ordersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt));
  res.json({ orders });
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json({ order });
});

router.patch("/orders/:id/status", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { status, riderTelegramId } = req.body as { status?: string; riderTelegramId?: number };
  if (!status) {
    res.status(400).json({ error: "status required" });
    return;
  }
  const updates: Partial<typeof ordersTable.$inferInsert> = { status };
  if (riderTelegramId !== undefined) updates.riderTelegramId = riderTelegramId;

  const [order] = await db
    .update(ordersTable)
    .set(updates)
    .where(eq(ordersTable.id, id))
    .returning();
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json({ order });
});

router.get("/orders/stats/summary", async (req, res): Promise<void> => {
  const allOrders = await db.select().from(ordersTable);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const todayOrders = allOrders.filter((o) => new Date(o.createdAt) >= todayStart);
  const weekOrders = allOrders.filter((o) => new Date(o.createdAt) >= weekStart);
  const monthOrders = allOrders.filter((o) => new Date(o.createdAt) >= monthStart);

  const sum = (arr: typeof allOrders) =>
    arr.reduce((s, o) => s + parseFloat(o.total), 0).toFixed(2);

  res.json({
    today: { count: todayOrders.length, total: sum(todayOrders) },
    week: { count: weekOrders.length, total: sum(weekOrders) },
    month: { count: monthOrders.length, total: sum(monthOrders) },
    all: { count: allOrders.length, total: sum(allOrders) },
  });
});

export default router;
