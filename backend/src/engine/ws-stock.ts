// ============================================
// WebSocket 实时库存推送服务
// 订阅 Redis Pub/Sub channel stock:update:{sessionId}
// 广播到 connected WebSocket clients
// ============================================

import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6380");

// sessionId → Set<WebSocket>
const rooms = new Map<string, Set<WebSocket>>();

// 全局 pub/sub subscriber (单例)
const sub = redis.duplicate();

sub.on("message", (channel, message) => {
  // channel: stock:update:{sessionId}
  const sessionId = channel.replace("stock:update:", "");
  const clients = rooms.get(sessionId);
  if (!clients || clients.size === 0) return;

  // 解析 stock update: "ttId1:available1,ttId2:available2,..."
  const updates = parseStockUpdate(message);

  const payload = JSON.stringify({
    type: "stock_update",
    sessionId,
    timestamp: Date.now(),
    stocks: updates,
  });

  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
});

function parseStockUpdate(raw: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const pair of raw.split(",")) {
    const [ttId, available] = pair.split(":");
    if (ttId && available) {
      result[ttId] = Number(available);
    }
  }
  return result;
}

export async function registerWebSocketRoutes(app: FastifyInstance) {
  // 动态导入 ws 避免顶层依赖
  const { WebSocketServer } = await import("ws");

  const wss = new WebSocketServer({ noServer: true });

  // 拦截 HTTP Upgrade
  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);

    // 只处理 /ws/stock?sessionId=xxx
    if (!url.pathname.startsWith("/ws/stock")) return;

    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      socket.destroy();
      return;
    }

    // JWT 鉴权 (从 query param)
    const token = url.searchParams.get("token");
    if (!token) {
      socket.destroy();
      return;
    }

    try {
      (app as any).jwt.verify(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket, request: any) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const sessionId = url.searchParams.get("sessionId") || "";

    // join room
    if (!rooms.has(sessionId)) {
      rooms.set(sessionId, new Set());
      // 首次订阅 Redis channel
      sub.subscribe("stock:update:" + sessionId);
    }
    rooms.get(sessionId)!.add(ws);

    console.log("  [ws] client connected, session:", sessionId, "total clients:", rooms.get(sessionId)?.size);

    // 发送当前库存快照
    sendSnapshot(ws, sessionId);

    ws.on("close", () => {
      const clients = rooms.get(sessionId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          rooms.delete(sessionId);
          sub.unsubscribe("stock:update:" + sessionId);
        }
      }
    });

    ws.on("error", () => {
      // ignore
    });

    // 心跳 (30s)
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
      } else {
        clearInterval(heartbeat);
      }
    }, 30000);

    ws.on("close", () => clearInterval(heartbeat));
  });

  console.log("  [ws] WebSocket server ready at /ws/stock");
}

async function sendSnapshot(ws: WebSocket, sessionId: string) {
  try {
    const stockKey = "stock:session:" + sessionId;
    const all = await redis.hgetall(stockKey);

    if (!all || Object.keys(all).length === 0) return;

    const stocks: Record<string, { total: number; sold: number; available: number }> = {};
    for (const [field, value] of Object.entries(all)) {
      const sepIdx = field.indexOf(":");
      if (sepIdx === -1) continue;
      const ttId = field.slice(0, sepIdx);
      const prop = field.slice(sepIdx + 1);

      if (!stocks[ttId]) stocks[ttId] = { total: 0, sold: 0, available: 0 };
      if (prop === "total") stocks[ttId].total = Number(value);
      else if (prop === "sold") stocks[ttId].sold = Number(value);
    }

    for (const ttId of Object.keys(stocks)) {
      stocks[ttId].available = stocks[ttId].total - stocks[ttId].sold;
    }

    ws.send(JSON.stringify({
      type: "snapshot",
      sessionId,
      stocks,
      timestamp: Date.now(),
    }));
  } catch {
    // ignore
  }
}

// ============================================
// SSE (Server-Sent Events) 降级方案
// 适用于不支持 WebSocket 的环境 (如部分代理/防火墙)
// ============================================
export async function sseStockHandler(request: any, reply: any) {
  const sessionId = (request.params as any)?.sessionId;
  if (!sessionId) return reply.code(400).send({ error: "missing sessionId" });

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // 禁用 nginx 缓冲
  });

  // 发送初始快照
  try {
    const stockKey = "stock:session:" + sessionId;
    const all = await redis.hgetall(stockKey);

    const stocks: Record<string, { total: number; sold: number; available: number }> = {};
    for (const [field, value] of Object.entries(all)) {
      const sepIdx = field.indexOf(":");
      if (sepIdx === -1) continue;
      const ttId = field.slice(0, sepIdx);
      const prop = field.slice(sepIdx + 1);

      if (!stocks[ttId]) stocks[ttId] = { total: 0, sold: 0, available: 0 };
      if (prop === "total") stocks[ttId].total = Number(value);
      else if (prop === "sold") stocks[ttId].sold = Number(value);
    }
    for (const ttId of Object.keys(stocks)) {
      stocks[ttId].available = stocks[ttId].total - stocks[ttId].sold;
    }

    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify({ sessionId, stocks })}\n\n`);
  } catch {
    // ignore
  }

  // Redis Pub/Sub → SSE
  const sseSub = redis.duplicate();
  await sseSub.subscribe("stock:update:" + sessionId);

  sseSub.on("message", (channel, message) => {
    const updates = parseStockUpdate(message);
    reply.raw.write(`event: stock_update\ndata: ${JSON.stringify({ sessionId, stocks: updates })}\n\n`);
  });

  // 心跳 (15s)
  const heartbeat = setInterval(() => {
    reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  // 客户端断开时清理
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    sseSub.unsubscribe("stock:update:" + sessionId);
    sseSub.quit();
  });
}
