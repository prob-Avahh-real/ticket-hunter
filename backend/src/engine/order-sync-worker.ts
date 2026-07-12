// ============================================
// 异步订单同步 Worker
// Lua 脚本在 Redis 写入订单结果后，
// 本 Worker 轮询将订单持久化到 PostgreSQL
// ============================================

import Redis from "ioredis";
import { db } from "../db/client.js";
import { nanoid } from "nanoid";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6380");

// 全量扫描所有 session 的结果列表
export async function syncOrdersToPostgres(): Promise<number> {
  // 扫描所有 snatch:result:* key
  const keys = await redis.keys("snatch:result:*");
  let synced = 0;

  for (const key of keys) {
    // RPOP 消费 (先进先出，保证顺序)
    let raw: string | null;
    while ((raw = await redis.rpop(key)) !== null) {
      try {
        const order = JSON.parse(raw);
        await persistOrder(order);
        synced++;
      } catch (e: any) {
        console.error("  [sync] 订单落库失败:", e.message, raw.slice(0, 200));
      }
    }
  }

  return synced;
}

async function persistOrder(order: {
  orderId: string;
  userId: string;
  sessionId: string;
  amount: number;
  items: { ttId: string; qty: number; price: number }[];
  status: string;
  createdAt: number;
}) {
  const now = new Date(order.createdAt * 1000);

  await db.transaction().execute(async (trx) => {
    await trx.insertInto("orders").values({
      id: order.orderId,
      user_id: order.userId,
      session_id: order.sessionId,
      total_amount: order.amount,
      status: order.status as "pending",
      created_at: now,
    }).execute();

    for (const item of order.items) {
      await trx.insertInto("order_items").values({
        id: nanoid(),
        order_id: order.orderId,
        ticket_type_id: item.ttId,
        quantity: item.qty,
        unit_price: item.price,
      }).execute();
    }

    // 同步 stock 回 PG (最终一致性)
    await trx.updateTable("ticket_types")
      .set((eb) => ({
        sold_count: eb("sold_count", "+", item.qty),
        version: eb("version", "+", 1),
      }))
      .where("id", "=", item.ttId)
      .execute();
  });
}

// ---- 定时同步入口 ----
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startOrderSyncWorker(intervalMs = 500): void {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    try {
      const count = await syncOrdersToPostgres();
      if (count > 0) {
        console.log("  [sync] 同步", count, "笔订单到PG");
      }
    } catch (e: any) {
      console.error("  [sync] 同步异常:", e.message);
    }
  }, intervalMs);

  console.log("  [sync] 订单同步Worker已启动 (interval:", intervalMs, "ms)");
}

export function stopOrderSyncWorker(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
