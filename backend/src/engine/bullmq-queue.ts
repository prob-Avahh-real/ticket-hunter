// ============================================
// BullMQ 削峰队列
// 用于超大规模并发场景 (10万+ QPS)
// 将抢票请求排队处理，客户端拿到排队号后轮询结果
// ============================================
// 使用场景: 周杰伦 / Taylor Swift 级别千万人并发
// 正常场景走 Lua 原子引擎即可，无需队列
// ============================================

import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import { atomicSnatch } from "./lua-snatcher.js";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6380", { maxRetriesPerRequest: null });

// 创建抢票队列
const snatchQueue = new Queue("ticket-snatch", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 }, // 保留最近 1000 条
    removeOnFail: { count: 500 },
    attempts: 1, // 不自动重试 (由客户端重试)
  },
});

// 排队号计数器 (sessionId → 当前排队号)
const queueCounters = new Map<string, number>();

// ---- 加入排队 ----
export interface EnqueueResult {
  queueNumber: number;
  estimatedWaitMs: number;
  jobId: string;
}

export async function enqueueSnatch(params: {
  userId: string;
  sessionId: string;
  items: { ttId: string; qty: number; maxPerPerson?: number }[];
  orderItems: { ttId: string; qty: number; price: number }[];
  totalAmount: number;
}): Promise<EnqueueResult> {
  const { sessionId } = params;

  // 递增排队号
  const current = (queueCounters.get(sessionId) || 0) + 1;
  queueCounters.set(sessionId, current);

  const job = await snatchQueue.add("snatch", params, {
    jobId: `snatch:${params.sessionId}:${params.userId}:${Date.now()}`,
  });

  // 估算等待时间 (假设每个任务 2ms 处理)
  const queueLength = await snatchQueue.getWaitingCount();
  const estimatedWaitMs = queueLength * 2;

  return {
    queueNumber: current,
    estimatedWaitMs,
    jobId: job.id || "",
  };
}

// ---- 查询排队结果 ----
export async function getQueueResult(jobId: string): Promise<{
  status: "waiting" | "active" | "completed" | "failed" | "not_found";
  result?: any;
  error?: string;
}> {
  const job = await Job.fromId(snatchQueue, jobId);
  if (!job) return { status: "not_found" };

  const state = await job.getState();
  if (state === "completed") {
    return { status: "completed", result: job.returnvalue };
  }
  if (state === "failed") {
    return { status: "failed", error: job.failedReason };
  }
  return { status: state as "waiting" | "active" };
}

// ---- 启动 Worker ----
let workerInstance: Worker | null = null;

export function startSnatchWorker(concurrency = 50): void {
  if (workerInstance) return;

  workerInstance = new Worker(
    "ticket-snatch",
    async (job: Job) => {
      const { userId, sessionId, items, orderItems, totalAmount } = job.data;
      return atomicSnatch({ userId, sessionId, items, orderItems, totalAmount });
    },
    {
      connection: redis,
      concurrency,
      limiter: {
        max: 1000,      // 每秒最多处理 1000 个任务
        duration: 1000,
      },
    },
  );

  workerInstance.on("completed", (job) => {
    // 可选: 通知客户端 (WebSocket)
  });

  workerInstance.on("failed", (job, err) => {
    console.error("  [bullmq] job failed:", job?.id, err.message);
  });

  console.log("  [bullmq] snatch worker started, concurrency:", concurrency);
}

export function stopSnatchWorker(): void {
  if (workerInstance) {
    workerInstance.close();
    workerInstance = null;
  }
}

export { snatchQueue };
