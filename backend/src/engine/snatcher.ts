import Redis from "ioredis";
import { db } from "../db/client.js";
import { nanoid } from "nanoid";

// ============================================
// 抢票引擎 v1.2 — 分布式锁 + 乐观锁 + 身份核验
// ============================================

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6380");
const LOCK_TTL = 5;
const ORDER_TIMEOUT = 15 * 60;
const MAX_RETRIES = 3;

export async function snatchTickets(params: {
  userId: string; sessionId: string;
  items: { ticketTypeId: string; quantity: number }[];
}) {
  const { userId, sessionId, items } = params;
  const lockKey = `lock:snatch:${sessionId}`;
  const lockValue = nanoid();

  const locked = await redis.set(lockKey, lockValue, "EX", LOCK_TTL, "NX");
  if (!locked) throw new AppError(429, "请求过于频繁，请稍后再试");

  try {
    // ---- 1. 身份核验 ----
    for (const item of items) {
      const tt = await db.selectFrom("ticket_types")
        .select(["total_stock", "sold_count", "name", "eligibility"])
        .where("id", "=", item.ticketTypeId).executeTakeFirst();

      if (!tt) throw new AppError(404, `票种 ${item.ticketTypeId} 不存在`);
      if (tt.sold_count + item.quantity > tt.total_stock) {
        throw new AppError(400, `票种"${tt.name}"库存不足 (剩余 ${tt.total_stock - tt.sold_count} 张)`);
      }

      // v1.2: 检查 eligibility 约束
      const elig = tt.eligibility as Record<string, unknown> | null;
      if (elig) {
        if (elig.citizen_only || elig.id_verify) {
          const user = await db.selectFrom("users")
            .select(["id_verified", "id_card_hash"])
            .where("id", "=", userId).executeTakeFirst();

          if (elig.id_verify && (!user || !user.id_verified)) {
            throw new AppError(403, "该票种需要实名核验，请先完成身份认证");
          }
          if (elig.max_per_person) {
            const alreadyBought = await db.selectFrom("orders")
              .innerJoin("order_items", "order_items.order_id", "orders.id")
              .select(db.fn.countAll().as("cnt"))
              .where("orders.user_id", "=", userId)
              .where("order_items.ticket_type_id", "=", item.ticketTypeId)
              .where("orders.status", "in", ["pending", "paid"])
              .executeTakeFirst();
            if (Number(alreadyBought?.cnt ?? 0) + item.quantity > (elig.max_per_person as number)) {
              throw new AppError(403, `该票种每人限购 ${elig.max_per_person} 张`);
            }
          }
        }
      }
    }

    // ---- 2. 乐观锁扣库存 ----
    for (const item of items) {
      const ok = await deductStock(item.ticketTypeId, item.quantity);
      if (!ok) {
        await rollbackStock(items, item.ticketTypeId);
        throw new AppError(409, "抢票失败，库存已被抢光");
      }
    }

    // ---- 3. 计算总价 & 创建订单 ----
    let totalAmount = 0;
    for (const item of items) {
      const tt = await db.selectFrom("ticket_types").select("original_price")
        .where("id", "=", item.ticketTypeId).executeTakeFirstOrThrow();
      totalAmount += tt.original_price * item.quantity;
    }

    const orderId = `TH${Date.now().toString(36).toUpperCase()}${nanoid(8)}`;
    const now = new Date();

    await db.transaction().execute(async (trx) => {
      await trx.insertInto("orders").values({
        id: orderId, user_id: userId, session_id: sessionId,
        total_amount: totalAmount, status: "pending", created_at: now,
      }).execute();
      for (const item of items) {
        const tt = await trx.selectFrom("ticket_types").select("original_price")
          .where("id", "=", item.ticketTypeId).executeTakeFirstOrThrow();
        await trx.insertInto("order_items").values({
          id: nanoid(), order_id: orderId, ticket_type_id: item.ticketTypeId,
          quantity: item.quantity, unit_price: tt.original_price,
        }).execute();
      }
    });

    await redis.set(`order:timeout:${orderId}`, JSON.stringify({ userId, items }), "EX", ORDER_TIMEOUT);

    return { orderId, totalAmount, expireAt: new Date(Date.now() + ORDER_TIMEOUT * 1000).toISOString() };
  } finally {
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1, lockKey, lockValue
    );
  }
}

async function deductStock(ticketTypeId: string, quantity: number): Promise<boolean> {
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    const row = await db.selectFrom("ticket_types")
      .select(["version", "total_stock", "sold_count"])
      .where("id", "=", ticketTypeId).executeTakeFirst();
    if (!row) return false;
    if (row.sold_count + quantity > row.total_stock) return false;

    const result = await db.updateTable("ticket_types")
      .set({ sold_count: row.sold_count + quantity, version: row.version + 1 })
      .where("id", "=", ticketTypeId).where("version", "=", row.version)
      .where("total_stock", ">=", row.sold_count + quantity)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) > 0) return true;
    await sleep(20 + Math.random() * 50);
  }
  return false;
}

async function rollbackStock(items: { ticketTypeId: string; quantity: number }[], stopAt: string) {
  for (const item of items) {
    if (item.ticketTypeId === stopAt) break;
    await db.updateTable("ticket_types")
      .set((eb) => ({ sold_count: eb("sold_count", "-", item.quantity), version: eb("version", "+", 1) }))
      .where("id", "=", item.ticketTypeId).execute();
  }
}

export async function cancelTimeoutOrders() {
  const keys = await redis.keys("order:timeout:*");
  for (const key of keys) {
    const exists = await redis.exists(key); if (!exists) continue;
    const orderId = key.replace("order:timeout:", "");
    const order = await db.selectFrom("orders").select("status").where("id", "=", orderId).executeTakeFirst();
    if (order && order.status === "pending") {
      await db.transaction().execute(async (trx) => {
        await trx.updateTable("orders").set({ status: "cancelled" })
          .where("id", "=", orderId).where("status", "=", "pending").execute();
        const items = await trx.selectFrom("order_items").select(["ticket_type_id", "quantity"])
          .where("order_id", "=", orderId).execute();
        for (const item of items) {
          await trx.updateTable("ticket_types")
            .set((eb) => ({ sold_count: eb("sold_count", "-", item.quantity), version: eb("version", "+", 1) }))
            .where("id", "=", item.ticket_type_id).execute();
        }
      });
    }
    await redis.del(key);
  }
}

export async function getStock(ticketTypeId: string) {
  const cached = await redis.get(`stock:${ticketTypeId}`);
  if (cached) return JSON.parse(cached);
  const row = await db.selectFrom("ticket_types")
    .select(["total_stock", "sold_count", "name", "original_price", "eligibility"])
    .where("id", "=", ticketTypeId).executeTakeFirst();
  if (!row) return null;
  const stock = { ...row, available: row.total_stock - row.sold_count };
  await redis.set(`stock:${ticketTypeId}`, JSON.stringify(stock), "EX", 10);
  return stock;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export class AppError extends Error {
  constructor(public statusCode: number, message: string) { super(message); this.name = "AppError"; }
}
