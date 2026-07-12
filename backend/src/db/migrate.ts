import { db, Database } from "./client.js";
import { sql, Kysely } from "kysely";

async function migrate() {
  console.log("🚀 开始数据库迁移 (v1.2 安全加固)...");

  // ---- 演出信息表 ----
  await db.schema.createTable("shows").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("title", "varchar(256)", (c) => c.notNull())
    .addColumn("category", "varchar(32)", (c) => c.notNull())
    .addColumn("city", "varchar(64)", (c) => c.notNull())
    .addColumn("venue", "varchar(256)", (c) => c.notNull())
    .addColumn("poster_url", "text")
    .addColumn("description", "text")
    .addColumn("status", "varchar(16)", (c) => c.notNull().defaultTo("pending"))
    .addColumn("source", "varchar(16)", (c) => c.notNull().defaultTo("manual"))
    .addColumn("source_id", "varchar(64)")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`CREATE INDEX IF NOT EXISTS idx_shows_category ON shows(category); CREATE INDEX IF NOT EXISTS idx_shows_city ON shows(city); CREATE INDEX IF NOT EXISTS idx_shows_status ON shows(status); CREATE INDEX IF NOT EXISTS idx_shows_source ON shows(source);`.execute(db);

  // ---- 场次表 ----
  await db.schema.createTable("sessions").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("show_id", "varchar(24)", (c) => c.notNull().references("shows.id").onDelete("cascade"))
    .addColumn("start_time", "timestamptz", (c) => c.notNull())
    .addColumn("sale_start_time", "timestamptz", (c) => c.notNull())
    .addColumn("sale_end_time", "timestamptz", (c) => c.notNull())
    .addColumn("status", "varchar(16)", (c) => c.notNull().defaultTo("upcoming"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_show ON sessions(show_id); CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(start_time); CREATE INDEX IF NOT EXISTS idx_sessions_sale ON sessions(sale_start_time, sale_end_time);`.execute(db);

  // ---- 票种表 ----
  await db.schema.createTable("ticket_types").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("session_id", "varchar(24)", (c) => c.notNull().references("sessions.id").onDelete("cascade"))
    .addColumn("name", "varchar(128)", (c) => c.notNull())
    .addColumn("original_price", "integer", (c) => c.notNull())
    .addColumn("total_stock", "integer", (c) => c.notNull())
    .addColumn("sold_count", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  try { await sql`ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS eligibility JSONB DEFAULT '{}';`.execute(db); } catch {}
  await sql`CREATE INDEX IF NOT EXISTS idx_ticket_types_session ON ticket_types(session_id);`.execute(db);

  // ---- 用户表 ----
  await db.schema.createTable("users").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("openid", "varchar(64)", (c) => c.notNull().unique())
    .addColumn("unionid", "varchar(64)")
    .addColumn("nickname", "varchar(64)")
    .addColumn("avatar_url", "text")
    .addColumn("phone", "varchar(16)")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  // v1.2: 安全字段
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_encrypted TEXT;`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_hash VARCHAR(128);`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verified BOOLEAN DEFAULT false;`.execute(db);
  } catch {}
  await sql`CREATE INDEX IF NOT EXISTS idx_users_openid ON users(openid); CREATE INDEX IF NOT EXISTS idx_users_id_hash ON users(id_card_hash);`.execute(db);

  // ---- 订单表 ----
  await db.schema.createTable("orders").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("user_id", "varchar(24)", (c) => c.notNull().references("users.id"))
    .addColumn("session_id", "varchar(24)", (c) => c.notNull().references("sessions.id"))
    .addColumn("total_amount", "integer", (c) => c.notNull())
    .addColumn("status", "varchar(16)", (c) => c.notNull().defaultTo("pending"))
    .addColumn("paid_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id); CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id); CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`.execute(db);

  // ---- 订单明细表 ----
  await db.schema.createTable("order_items").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("order_id", "varchar(24)", (c) => c.notNull().references("orders.id").onDelete("cascade"))
    .addColumn("ticket_type_id", "varchar(24)", (c) => c.notNull().references("ticket_types.id"))
    .addColumn("quantity", "integer", (c) => c.notNull())
    .addColumn("unit_price", "integer", (c) => c.notNull())
    .execute();

  // ---- 数据源表 ----
  await db.schema.createTable("data_sources").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("name", "varchar(64)", (c) => c.notNull().unique())
    .addColumn("last_scraped_at", "timestamptz")
    .addColumn("item_count", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("status", "varchar(16)", (c) => c.notNull().defaultTo("active"))
    .addColumn("error_msg", "text")
    .execute();

  // ---- 通票捆绑表 ----
  await db.schema.createTable("pass_bundles").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("ticket_type_id", "varchar(24)", (c) => c.notNull().references("ticket_types.id").onDelete("cascade"))
    .addColumn("show_id", "varchar(24)", (c) => c.notNull().references("shows.id").onDelete("cascade"))
    .addColumn("max_visits", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`CREATE INDEX IF NOT EXISTS idx_pass_bundles_tt ON pass_bundles(ticket_type_id); CREATE INDEX IF NOT EXISTS idx_pass_bundles_show ON pass_bundles(show_id);`.execute(db);

  // ============================================
  // v1.2: 安全审计表
  // ============================================

  await db.schema.createTable("audit_logs").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("user_id", "varchar(24)")
    .addColumn("action", "varchar(64)", (c) => c.notNull())
    .addColumn("target_type", "varchar(32)")
    .addColumn("target_id", "varchar(24)")
    .addColumn("ip", "varchar(45)")
    .addColumn("user_agent", "text")
    .addColumn("detail", "jsonb")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id); CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action); CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);`.execute(db);

  // ---- 用户同意日志 ----
  await db.schema.createTable("consent_logs").ifNotExists()
    .addColumn("id", "varchar(24)", (c) => c.primaryKey())
    .addColumn("user_id", "varchar(24)", (c) => c.notNull().references("users.id"))
    .addColumn("type", "varchar(32)", (c) => c.notNull())
    .addColumn("agreed", "boolean", (c) => c.notNull())
    .addColumn("ip", "varchar(45)")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_logs(user_id);`.execute(db);

  console.log("✅ 数据库迁移完成 (v1.2 安全加固)");
  await db.destroy();
}

migrate().catch((err) => { console.error("❌ 迁移失败:", err); process.exit(1); });
