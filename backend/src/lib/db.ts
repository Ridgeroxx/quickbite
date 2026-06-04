import { drizzle } from 'drizzle-orm/sqlite3';
import sqlite3 from 'sqlite3';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ---------- Tables ----------
export const usersTable = sqliteTable('users', {
  telegramId: text('telegram_id').primaryKey(),
  role: text('role').notNull().default('customer'),
  name: text('name'),
  phone: text('phone'),
});

export const menuTable = sqliteTable('menu', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  price: real('price').notNull(),
  category: text('category'),
  imageUrl: text('image_url'),
});

export const ordersTable = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userTelegramId: text('user_telegram_id').notNull(),
  itemsJson: text('items_json').notNull(),
  total: real('total').notNull(),
  address: text('address').notNull(),
  paymentReference: text('payment_reference'),
  status: text('status').notNull().default('pending_payment'),
  assignedRiderId: text('assigned_rider_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const ridersTable = sqliteTable('riders', {
  telegramId: text('telegram_id').primaryKey(),
  name: text('name').notNull(),
  isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
});

// ---------- Database connection ----------
const sqlite = new sqlite3.Database('./database.sqlite');
export const db = drizzle(sqlite);
