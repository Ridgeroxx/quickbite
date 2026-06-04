import { Router, type IRouter } from "express";
import { db, menuTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/menu", async (req, res): Promise<void> => {
  const items = await db
    .select()
    .from(menuTable)
    .where(eq(menuTable.available, "true"))
    .orderBy(menuTable.category, menuTable.name);
  res.json({ items });
});

router.get("/menu/all", async (req, res): Promise<void> => {
  const items = await db.select().from(menuTable).orderBy(menuTable.category, menuTable.name);
  res.json({ items });
});

router.post("/menu", async (req, res): Promise<void> => {
  const { name, price, category, imageUrl } = req.body as {
    name?: string;
    price?: string;
    category?: string;
    imageUrl?: string;
  };
  if (!name || !price || !category) {
    res.status(400).json({ error: "name, price, category required" });
    return;
  }
  const [item] = await db
    .insert(menuTable)
    .values({ name, price, category, imageUrl: imageUrl ?? "" })
    .returning();
  req.log.info({ id: item?.id }, "Menu item created");
  res.status(201).json({ item });
});

router.patch("/menu/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { name, price, category, imageUrl, available } = req.body as {
    name?: string;
    price?: string;
    category?: string;
    imageUrl?: string;
    available?: string;
  };
  const updates: Partial<typeof menuTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (price !== undefined) updates.price = price;
  if (category !== undefined) updates.category = category;
  if (imageUrl !== undefined) updates.imageUrl = imageUrl;
  if (available !== undefined) updates.available = available;

  const [item] = await db.update(menuTable).set(updates).where(eq(menuTable.id, id)).returning();
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json({ item });
});

router.delete("/menu/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(menuTable).where(eq(menuTable.id, id));
  res.sendStatus(204);
});

export default router;
