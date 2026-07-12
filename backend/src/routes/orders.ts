import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { AppError, snatchTickets } from "../engine/snatcher.js";
import { audit } from "../middleware/audit.js";
import { z } from "zod";

const snatchSchema = z.object({
  sessionId: z.string().min(1),
  items: z.array(z.object({
    ticketTypeId: z.string().min(1),
    quantity: z.number().int().min(1).max(6),
  })).min(1).max(5),
});

export async function orderRoutes(app: FastifyInstance) {
  // ========== POST /api/orders/snatch — 抢票 (含审计) ==========
  app.post("/snatch", { preHandler: [app.authenticate] } as any, async (request: any, reply) => {
    const body = snatchSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "参数错误", details: body.error.flatten() });

    const userId = request.user.id;
    const { sessionId, items } = body.data;
    const ip = String(request.ip || "");

    try {
      const result = await snatchTickets({ userId, sessionId, items });

      await audit({ userId, action: "snatch", targetType: "order", targetId: result.orderId,
        ip, detail: { sessionId, totalAmount: result.totalAmount, itemCount: items.length } });

      return { success: true, ...result };
    } catch (err: any) {
      if (err instanceof AppError) {
        await audit({ userId, action: "snatch_fail", targetType: "session", targetId: sessionId,
          ip, detail: { error: err.message } });
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  // ========== GET /api/orders — 我的订单 ==========
  app.get("/", { preHandler: [app.authenticate] } as any, async (request: any) => {
    const userId = request.user.id;
    const { status, page = "1" } = request.query as Record<string, string>;
    const pageNum = parseInt(page) || 1;
    const limit = 20;

    let query = db.selectFrom("orders")
      .innerJoin("sessions", "sessions.id", "orders.session_id")
      .innerJoin("shows", "shows.id", "sessions.show_id")
      .select(["orders.id", "orders.total_amount", "orders.status", "orders.paid_at", "orders.created_at",
        "shows.title as show_title", "shows.poster_url", "sessions.start_time", "shows.venue"])
      .where("orders.user_id", "=", userId).orderBy("orders.created_at", "desc");

    if (status) query = query.where("orders.status", "=", status);

    const countQuery = db.selectFrom("orders").select(db.fn.countAll().as("total")).where("orders.user_id", "=", userId);
    if (status) countQuery.where("orders.status", "=", status);

    const [orders, countResult] = await Promise.all([
      query.limit(limit).offset((pageNum - 1) * limit).execute(),
      countQuery.executeTakeFirst(),
    ]);
    return { list: orders, pagination: { page: pageNum, pageSize: limit, total: Number(countResult?.total ?? 0) } };
  });

  // ========== GET /api/orders/:id — 订单详情 ==========
  app.get("/:id", { preHandler: [app.authenticate] } as any, async (request: any, reply) => {
    const userId = request.user.id; const { id } = request.params;
    const order = await db.selectFrom("orders").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
    if (!order) return reply.code(404).send({ error: "订单不存在" });
    const items = await db.selectFrom("order_items")
      .innerJoin("ticket_types", "ticket_types.id", "order_items.ticket_type_id")
      .select(["order_items.quantity", "order_items.unit_price", "ticket_types.name as ticket_name"])
      .where("order_items.order_id", "=", id).execute();
    return { ...order, items };
  });

  // ========== POST /api/orders/:id/pay — 支付 (含审计) ==========
  app.post("/:id/pay", { preHandler: [app.authenticate] } as any, async (request: any, reply) => {
    const userId = request.user.id; const { id } = request.params;
    const ip = String(request.ip || "");

    const order = await db.selectFrom("orders").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
    if (!order) return reply.code(404).send({ error: "订单不存在" });
    if (order.status !== "pending") return reply.code(400).send({ error: "订单状态不可支付" });

    await db.updateTable("orders").set({ status: "paid", paid_at: new Date() })
      .where("id", "=", id).where("status", "=", "pending").execute();

    await audit({ userId, action: "pay", targetType: "order", targetId: id,
      ip, detail: { amount: order.total_amount } });

    return { success: true, message: "支付成功" };
  });
}
