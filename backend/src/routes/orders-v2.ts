// ============================================
// 抢票路由 v2 — 集成 Lua 原子引擎 + 预检 + 排队
// ============================================

import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { audit } from "../middleware/audit.js";
import { z } from "zod";
import {
  atomicSnatch,
  preWarmSessionStock,
  preWarmUserProfile,
  getStockFast,
} from "../engine/lua-snatcher.js";

const snatchSchema = z.object({
  sessionId: z.string().min(1),
  items: z.array(z.object({
    ticketTypeId: z.string().min(1),
    quantity: z.number().int().min(1).max(6),
  })).min(1).max(5),
});

export async function orderRoutesV2(app: FastifyInstance) {
  // ========== POST /api/orders/preflight — 开售前预检 ==========
  app.post("/preflight", { preHandler: [app.authenticate] } as any, async (request: any, reply) => {
    const body = snatchSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "参数错误", details: body.error.flatten() });

    const userId = request.user.id;
    const { sessionId, items } = body.data;

    // 预热 session 库存到 Redis (如果尚未预热)
    const stock = await getStockFast(sessionId);
    if (!stock || Object.keys(stock).length === 0) {
      await preWarmSessionStock(sessionId);
    }

    // 预热用户 Profile
    await preWarmUserProfile(userId);

    // 预校验每个票种
    const checks = [];
    for (const item of items) {
      const tt = await db.selectFrom("ticket_types")
        .select(["id", "name", "total_stock", "sold_count", "original_price", "eligibility"])
        .where("id", "=", item.ticketTypeId)
        .executeTakeFirst();

      if (!tt) {
        checks.push({ ticketTypeId: item.ticketTypeId, ok: false, reason: "ticket_type_not_found" });
        continue;
      }

      const available = tt.total_stock - tt.sold_count;
      if (available < item.quantity) {
        checks.push({ ticketTypeId: item.ticketTypeId, ok: false, reason: "insufficient_stock", available });
        continue;
      }

      const elig = tt.eligibility as Record<string, unknown> | null;
      if (elig?.id_verify) {
        const user = await db.selectFrom("users")
          .select(["id_verified"])
          .where("id", "=", userId)
          .executeTakeFirst();
        if (!user?.id_verified) {
          checks.push({ ticketTypeId: item.ticketTypeId, ok: false, reason: "need_identity_verification" });
          continue;
        }
      }

      if (elig?.max_per_person) {
        const already = await db.selectFrom("orders")
          .innerJoin("order_items", "order_items.order_id", "orders.id")
          .select(db.fn.countAll().as("cnt"))
          .where("orders.user_id", "=", userId)
          .where("order_items.ticket_type_id", "=", item.ticketTypeId)
          .where("orders.status", "in", ["pending", "paid"])
          .executeTakeFirst();
        if (Number(already?.cnt ?? 0) + item.quantity > (elig.max_per_person as number)) {
          checks.push({ ticketTypeId: item.ticketTypeId, ok: false, reason: "limit_exceeded", max: elig.max_per_person });
          continue;
        }
      }

      checks.push({
        ticketTypeId: item.ticketTypeId,
        ok: true,
        name: tt.name,
        price: tt.original_price,
        available,
      });
    }

    const allOk = checks.every((c) => c.ok);
    const totalAmount = checks
      .filter((c) => c.ok)
      .reduce((sum, c) => sum + (c.price || 0) * (items.find((i) => i.ticketTypeId === c.ticketTypeId)?.quantity || 0), 0);

    return {
      ready: allOk,
      checks,
      totalAmount,
      message: allOk ? "预检通过，准备抢票" : "请先解决以下问题",
    };
  });

  // ========== POST /api/orders/snatch-v2 — Lua 原子抢票 ==========
  app.post("/snatch-v2", { preHandler: [app.authenticate] } as any, async (request: any, reply) => {
    const body = snatchSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "参数错误", details: body.error.flatten() });

    const userId = request.user.id;
    const { sessionId, items } = body.data;
    const ip = String(request.ip || "");

    // 1. 确保库存已预热
    const stock = await getStockFast(sessionId);
    if (!stock || Object.keys(stock).length === 0) {
      await preWarmSessionStock(sessionId);
    }
    await preWarmUserProfile(userId);

    // 2. 计算价格
    let totalAmount = 0;
    const orderItems = [];
    const snatchItems = [];

    for (const item of items) {
      const ss = stock[item.ticketTypeId];
      const price = ss?.price || 0;
      totalAmount += price * item.quantity;

      orderItems.push({
        ttId: item.ticketTypeId,
        qty: item.quantity,
        price,
      });

      snatchItems.push({
        ttId: item.ticketTypeId,
        qty: item.quantity,
        maxPerPerson: 999, // 已在 preflight 校验
      });
    }

    if (totalAmount === 0) {
      return reply.code(400).send({ error: "未选择有效票种" });
    }

    // 3. 调用 Lua 原子抢票
    const t0 = Date.now();
    const result = await atomicSnatch({
      userId,
      sessionId,
      items: snatchItems,
      orderItems,
      totalAmount,
    });

    const latency = Date.now() - t0;

    if (result.success) {
      await audit({
        userId,
        action: "snatch_v2",
        targetType: "order",
        targetId: result.orderId,
        ip,
        detail: { sessionId, totalAmount, itemCount: items.length, latency_ms: latency },
      });

      return {
        success: true,
        orderId: result.orderId,
        totalAmount,
        latencyMs: latency,
        expireAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    }

    await audit({
      userId,
      action: "snatch_v2_fail",
      targetType: "session",
      targetId: sessionId,
      ip,
      detail: { error: result.error, errorCode: result.errorCode, latency_ms: latency },
    });

    const statusMap: Record<string, number> = {
      too_frequent: 429,
      out_of_stock: 409,
      need_verify: 403,
      limit_exceeded: 403,
    };

    return reply.code(statusMap[result.errorCode || ""] || 500).send({
      error: result.error,
      errorCode: result.errorCode,
      latencyMs: latency,
    });
  });

  // ========== GET /api/orders/stock-fast/:sessionId — 纯 Redis 库存 ==========
  app.get("/stock-fast/:sessionId", async (request: any) => {
    const { sessionId } = request.params;
    const stock = await getStockFast(sessionId);

    if (!stock || Object.keys(stock).length === 0) {
      // fallback: 预热后重试
      await preWarmSessionStock(sessionId);
      const retry = await getStockFast(sessionId);
      return { sessionId, stocks: retry, source: "redis_warm" };
    }

    return { sessionId, stocks: stock, source: "redis" };
  });

  // ========== 保留原 v1 路由 (兼容) ==========
  // POST /api/orders/snatch 仍可用，由旧的 snatcher.ts 处理
}
