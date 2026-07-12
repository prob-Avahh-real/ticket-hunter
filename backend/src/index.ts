import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { showRoutes } from "./routes/shows.js";
import { orderRoutes } from "./routes/orders.js";
import { orderRoutesV2 } from "./routes/orders-v2.js";
import { userRoutes } from "./routes/users.js";
import { registerWebSocketRoutes, sseStockHandler } from "./engine/ws-stock.js";
import { initSnatchScript, preWarmSessionStock } from "./engine/lua-snatcher.js";
import { startOrderSyncWorker } from "./engine/order-sync-worker.js";

const PORT = parseInt(process.env.PORT || "4000");

const app = Fastify({ logger: true });

// ---- 插件 ----
await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
await app.register(jwt, { secret: process.env.JWT_SECRET || "dev-secret-change-in-prod" });

// ---- 权限装饰器 ----
app.decorate("authenticate", async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: "未授权，请先登录" });
  }
});

// ---- 初始化 Lua 抢票脚本 ----
await initSnatchScript();

// ---- 启动订单同步 Worker (Redis → PG, 500ms 间隔) ----
startOrderSyncWorker(500);

// ---- 路由注册 ----
// v1 路由 (兼容)
await app.register(showRoutes, { prefix: "/api/shows" });
await app.register(orderRoutes, { prefix: "/api/orders" });
await app.register(userRoutes, { prefix: "/api/users" });

// v2 抢票路由 (Lua 原子引擎)
await app.register(orderRoutesV2, { prefix: "/api/orders" });

// SSE 降级端点 (实时库存)
app.get("/api/orders/sse/:sessionId", sseStockHandler as any);

// 健康检查 (含组件状态)
app.get("/health", async () => ({
  status: "ok",
  service: "ticket-hunter-v2",
  version: "2.0.0",
  timestamp: new Date().toISOString(),
  features: {
    lua_snatch: true,
    ws_stock: true,
    sse_fallback: true,
    order_sync: true,
  },
}));

// ---- WebSocket 注册 (必须在 listen 之前) ----
await registerWebSocketRoutes(app);

// ---- 启动 ----
try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log("🎫 Ticket Hunter v2.0 → http://localhost:" + PORT);
  console.log("   WebSocket: ws://localhost:" + PORT + "/ws/stock");
  console.log("   SSE:       http://localhost:" + PORT + "/api/orders/sse/:sessionId");
  console.log("   Snatch v2: POST http://localhost:" + PORT + "/api/orders/snatch-v2");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
