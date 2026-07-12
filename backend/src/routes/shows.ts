import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { getStock } from "../engine/snatcher.js";

export async function showRoutes(app: FastifyInstance) {
  // ========== GET /api/shows — 演出列表（搜索+筛选） ==========
  app.get("/", async (request: any) => {
    const {
      keyword, category, city, status = "on_sale",
      page = "1", pageSize = "20", sort = "start_time",
    } = request.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page));
    const limit = Math.min(50, parseInt(pageSize));
    const offset = (pageNum - 1) * limit;

    let query = db
      .selectFrom("shows")
      .innerJoin("sessions", "sessions.show_id", "shows.id")
      .select([
        "shows.id", "shows.title", "shows.category", "shows.city",
        "shows.venue", "shows.poster_url", "shows.status",
        "sessions.start_time", "sessions.sale_start_time",
        "sessions.id as session_id",
      ])
      .where("shows.status", "=", status);

    if (keyword) {
      query = query.where((eb) =>
        eb.or([
          eb("shows.title", "ilike", `%${keyword}%`),
          eb("shows.venue", "ilike", `%${keyword}%`),
        ]));
    }
    if (category) query = query.where("shows.category", "=", category);
    if (city) query = query.where("shows.city", "=", city);

    if (sort === "start_time") query = query.orderBy("sessions.start_time", "asc");
    else if (sort === "sale_start") query = query.orderBy("sessions.sale_start_time", "asc");
    else if (sort === "hot") query = query.orderBy("shows.created_at", "desc");

    const countQuery = db.selectFrom("shows")
      .innerJoin("sessions", "sessions.show_id", "shows.id")
      .select(db.fn.countAll().as("total"))
      .where("shows.status", "=", status);

    if (keyword) countQuery.where((eb) => eb.or([eb("shows.title", "ilike", `%${keyword}%`), eb("shows.venue", "ilike", `%${keyword}%`)]));
    if (category) countQuery.where("shows.category", "=", category);
    if (city) countQuery.where("shows.city", "=", city);

    const [shows, countResult] = await Promise.all([
      query.limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    const total = Number(countResult?.total ?? 0);
    return {
      list: shows,
      pagination: { page: pageNum, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
    };
  });

  // ========== GET /api/shows/:id — 演出详情 ==========
  app.get("/:id", async (request: any, reply) => {
    const { id } = request.params;

    const show = await db.selectFrom("shows").selectAll().where("id", "=", id).executeTakeFirst();
    if (!show) return reply.code(404).send({ error: "演出不存在" });

    const sessions = await db.selectFrom("sessions").selectAll()
      .where("show_id", "=", id).orderBy("start_time", "asc").execute();

    // v1.1: 含 eligibility
    const sessionsWithTickets = await Promise.all(sessions.map(async (s) => {
      const ticketTypes = await db.selectFrom("ticket_types")
        .select(["id", "name", "original_price", "total_stock", "sold_count", "eligibility"])
        .where("session_id", "=", s.id).execute();

      return {
        ...s,
        ticketTypes: ticketTypes.map((tt) => ({
          ...tt, available: tt.total_stock - tt.sold_count,
        })),
      };
    }));

    return { ...show, sessions: sessionsWithTickets };
  });

  // ========== GET /api/shows/:id/sessions/:sessionId/tickets — 票种库存 ==========
  app.get("/:id/sessions/:sessionId/tickets", async (request: any) => {
    const { sessionId } = request.params;

    const ticketTypes = await db.selectFrom("ticket_types")
      .select(["id", "name", "original_price", "total_stock", "sold_count", "eligibility"])
      .where("session_id", "=", sessionId).execute();

    const result = await Promise.all(ticketTypes.map(async (tt) => {
      const stock = await getStock(tt.id);
      return { ...tt, available: stock?.available ?? tt.total_stock - tt.sold_count };
    }));

    return result;
  });

  // ========== v1.1: GET /api/shows/:id/pass-bundles — 通票关联场馆 ==========
  app.get("/:id/pass-bundles", async (request: any) => {
    const { id } = request.params;

    const bundles = await db.selectFrom("pass_bundles")
      .innerJoin("shows", "shows.id", "pass_bundles.show_id")
      .innerJoin("ticket_types", "ticket_types.id", "pass_bundles.ticket_type_id")
      .select([
        "pass_bundles.id", "pass_bundles.max_visits",
        "shows.title as show_title", "shows.poster_url", "shows.venue",
        "ticket_types.name as ticket_name",
      ])
      .where("pass_bundles.show_id", "=", id).execute();

    return bundles;
  });

  // ========== GET /api/shows/cities — 城市列表 ==========
  app.get("/cities/list", async () => {
    const cities = await db.selectFrom("shows").select("city").distinct()
      .orderBy("city", "asc").execute();
    return cities.map((c) => c.city);
  });
}
