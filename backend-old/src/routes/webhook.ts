import { Router, type IRouter } from "express";
import { db, ridersTable } from "./lib/index";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.post("/riders", async (req, res): Promise<void> => {
  const { telegramId, name } = req.body as { telegramId?: number; name?: string };
  if (!telegramId || !name) {
    res.status(400).json({ error: "telegramId and name required" });
    return;
  }
  const [rider] = await db
    .insert(ridersTable)
    .values({ telegramId, name })
    .onConflictDoNothing()
    .returning();
  res.status(201).json({ rider });
});

router.get("/riders", async (_req, res): Promise<void> => {
  const riders = await db.select().from(ridersTable);
  res.json({ riders });
});

router.patch("/riders/:id/availability", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { isAvailable } = req.body as { isAvailable?: string };
  if (isAvailable === undefined) {
    res.status(400).json({ error: "isAvailable required" });
    return;
  }
  const [rider] = await db
    .update(ridersTable)
    .set({ isAvailable })
    .where(eq(ridersTable.telegramId, id))
    .returning();
  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }
  res.json({ rider });
});

router.delete("/riders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(ridersTable).where(eq(ridersTable.telegramId, id));
  res.sendStatus(204);
});

export default router;
