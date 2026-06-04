import { db, menuTable } from "@workspace/db";
import { logger } from "./logger";

const SEED_MENU = [
  { name: "Classic Burger", price: "25.00", category: "Burgers", imageUrl: "" },
  { name: "Chicken Burger", price: "28.00", category: "Burgers", imageUrl: "" },
  { name: "Double Beef Burger", price: "35.00", category: "Burgers", imageUrl: "" },
  { name: "Veggie Burger", price: "22.00", category: "Burgers", imageUrl: "" },
  { name: "French Fries", price: "12.00", category: "Sides", imageUrl: "" },
  { name: "Onion Rings", price: "14.00", category: "Sides", imageUrl: "" },
  { name: "Coleslaw", price: "10.00", category: "Sides", imageUrl: "" },
  { name: "Chicken Wings (6pc)", price: "30.00", category: "Sides", imageUrl: "" },
  { name: "Coca-Cola", price: "8.00", category: "Drinks", imageUrl: "" },
  { name: "Sprite", price: "8.00", category: "Drinks", imageUrl: "" },
  { name: "Mango Juice", price: "10.00", category: "Drinks", imageUrl: "" },
  { name: "Water", price: "5.00", category: "Drinks", imageUrl: "" },
];

export async function seedMenu(): Promise<void> {
  const existing = await db.select().from(menuTable);
  if (existing.length > 0) {
    logger.info("Menu already seeded, skipping");
    return;
  }
  await db.insert(menuTable).values(SEED_MENU);
  logger.info({ count: SEED_MENU.length }, "Menu seeded");
}
