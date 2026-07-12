// ============================================
// 订单超时取消Job
// 独立于backend运行，定时扫描Redis中的超时订单
// ============================================

import Redis from "ioredis";
import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6380");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://ticket:ticket_dev@localhost:5433/ticket_hunter",
});
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

export async function cancelTimeoutOrders() {
  const keys = await redis.keys("order:timeout:*");
  if (keys.length === 0) return;

  for (const key of keys) {
    const exists = await redis.exists(key);
    if (!exists) continue;

    const orderId = key.replace("order:timeout:", "");
    const order = await db
      .selectFrom("orders")
      .select(["status"])
      .where("id", "=", orderId)
      .executeTakeFirst();

    if (order && order.status === "pending") {
      console.log(`  [order] 超时取消订单: ${orderId}`);

      await db.transaction().execute(async (trx: any) => {
        await trx
          .updateTable("orders")
          .set({ status: "cancelled" })
          .where("id", "=", orderId)
          .where("status", "=", "pending")
          .execute();

        const items = await trx
          .selectFrom("order_items")
          .select(["ticket_type_id", "quantity"])
          .where("order_id", "=", orderId)
          .execute();

        for (const item of items) {
          await trx
            .updateTable("ticket_types")
            .set((eb: any) => ({
              sold_count: eb("sold_count", "-", item.quantity),
              version: eb("version", "+", 1),
            }))
            .where("id", "=", item.ticket_type_id)
            .execute();
        }
      });
    }
    await redis.del(key);
  }
  await pool.end();
}
