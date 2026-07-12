// ============================================
// 抢票引擎端到端压测脚本
// 用法: npx tsx src/benchmark.ts
// ============================================
// 测试场景:
//   1. 单用户单票种 — 基准延迟
//   2. 100 并发抢同一票种 — 竞争条件
//   3. 500 并发混合票种 — 吞吐上限
// ============================================

import Redis from "ioredis";
import { initSnatchScript, atomicSnatch } from "./engine/lua-snatcher.js";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6380");

const SESSION_ID = "bench_session_001";
const TICKET_IDS = ["bench_tt_vip", "bench_tt_a", "bench_tt_b", "bench_tt_c"];

async function setup() {
  console.log("🔧 初始化压测环境...");
  await initSnatchScript();

  // 手动预热 Redis 库存 (不依赖 PG)
  const stockKey = "stock:session:" + SESSION_ID;
  const eligKey = "eligibility:session:" + SESSION_ID;

  const p = redis.pipeline();
  p.del(stockKey);
  p.del(eligKey);

  // VIP: 100张, A: 500张, B: 1000张, C: 2000张
  const stocks = { bench_tt_vip: 100, bench_tt_a: 500, bench_tt_b: 1000, bench_tt_c: 2000 };
  for (const [ttId, total] of Object.entries(stocks)) {
    p.hset(stockKey, ttId + ":total", String(total));
    p.hset(stockKey, ttId + ":sold", "0");
    p.hset(stockKey, ttId + ":name", ttId);
    p.hset(stockKey, ttId + ":price", "9900");
    p.hset(eligKey, ttId + ":id_verify", "0");
    p.hset(eligKey, ttId + ":max_per_person", "6");
    p.hset(eligKey, ttId + ":citizen_only", "0");
  }
  p.expire(stockKey, 3600);
  p.expire(eligKey, 3600);
  await p.exec();

  console.log("  ✅ 库存已预热:", stocks);
}

async function singleUserBenchmark() {
  console.log("\n📊 [场景1] 单用户抢票 — 基准延迟");
  const times: number[] = [];

  for (let i = 0; i < 20; i++) {
    const userId = "bench_user_" + i;
    await redis.hset("user:profile:" + userId, "id_verified", "1");
    await redis.expire("user:profile:" + userId, 3600);

    const t0 = Date.now();
    const result = await atomicSnatch({
      userId,
      sessionId: SESSION_ID,
      items: [{ ttId: TICKET_IDS[1], qty: 1 }],
      orderItems: [{ ttId: TICKET_IDS[1], qty: 1, price: 9900 }],
      totalAmount: 9900,
    });
    const elapsed = Date.now() - t0;
    times.push(elapsed);

    if (result.success) {
      console.log("  ✅", result.orderId, "延迟:", elapsed, "ms");
    } else {
      console.log("  ❌", result.error, "延迟:", elapsed, "ms");
    }
  }

  const sorted = times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log("\n  统计 (", times.length, "次):");
  console.log("    P50:", sorted[Math.floor(times.length * 0.5)], "ms");
  console.log("    P95:", sorted[Math.floor(times.length * 0.95)], "ms");
  console.log("    P99:", sorted[Math.floor(times.length * 0.99)], "ms");
  console.log("    Avg:", avg.toFixed(1), "ms");
  console.log("    Min:", sorted[0], "ms");
  console.log("    Max:", sorted[sorted.length - 1], "ms");
  console.log("    QPS:", (1000 / avg).toFixed(0), "(理论单线程)");
}

async function concurrentBenchmark() {
  console.log("\n📊 [场景2] 100 并发抢同一票种 VIP (100张)");

  // 先重置 VIP 库存
  await redis.hset("stock:session:" + SESSION_ID, "bench_tt_vip:sold", "0");

  const t0 = Date.now();
  const promises = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < 150; i++) {
    const userId = "bench_concurrent_" + i;
    await redis.hset("user:profile:" + userId, "id_verified", "1");
    await redis.expire("user:profile:" + userId, 3600);

    promises.push(
      atomicSnatch({
        userId,
        sessionId: SESSION_ID,
        items: [{ ttId: "bench_tt_vip", qty: 1 }],
        orderItems: [{ ttId: "bench_tt_vip", qty: 1, price: 9900 }],
        totalAmount: 9900,
      }).then((r) => {
        if (r.success) successCount++;
        else failCount++;
        return r;
      }),
    );
  }

  await Promise.all(promises);
  const totalTime = Date.now() - t0;

  const sold = await redis.hget("stock:session:" + SESSION_ID, "bench_tt_vip:sold");

  console.log("  总耗时:", totalTime, "ms");
  console.log("  成功:", successCount, "失败:", failCount);
  console.log("  实际库存扣减:", sold);
  console.log("  吞吐:", ((successCount / totalTime) * 1000).toFixed(0), "QPS");
  console.log("  无超卖检查:", Number(sold) <= 100 ? "✅ PASS" : "❌ FAIL (超卖" + (Number(sold) - 100) + "张)");
}

async function mixedConcurrentBenchmark() {
  console.log("\n📊 [场景3] 500 并发混合票种");

  // 重置所有库存
  for (const ttId of TICKET_IDS) {
    await redis.hset("stock:session:" + SESSION_ID, ttId + ":sold", "0");
  }

  const t0 = Date.now();
  const promises = [];
  let successCount = 0;
  let failCount = 0;

  const ticketTypes = TICKET_IDS;

  for (let i = 0; i < 500; i++) {
    const userId = "bench_mixed_" + i;
    await redis.hset("user:profile:" + userId, "id_verified", "1");
    await redis.expire("user:profile:" + userId, 3600);

    const ttId = ticketTypes[i % ticketTypes.length];
    const qty = 1 + (i % 3);

    promises.push(
      atomicSnatch({
        userId,
        sessionId: SESSION_ID,
        items: [{ ttId, qty }],
        orderItems: [{ ttId, qty, price: 9900 }],
        totalAmount: 9900 * qty,
      }).then((r) => {
        if (r.success) successCount++;
        else failCount++;
        return r;
      }),
    );
  }

  await Promise.all(promises);
  const totalTime = Date.now() - t0;

  console.log("  总耗时:", totalTime, "ms");
  console.log("  成功:", successCount, "失败:", failCount);
  console.log("  吞吐:", ((500 / totalTime) * 1000).toFixed(0), "QPS");

  // 检查各票种无超卖
  const limits = { bench_tt_vip: 100, bench_tt_a: 500, bench_tt_b: 1000, bench_tt_c: 2000 };
  let allOk = true;
  for (const ttId of TICKET_IDS) {
    const sold = Number(await redis.hget("stock:session:" + SESSION_ID, ttId + ":sold") || "0");
    const limit = limits[ttId as keyof typeof limits];
    const ok = sold <= limit;
    if (!ok) allOk = false;
    console.log("  ", ttId, ": sold=", sold, "/", limit, ok ? "✅" : "❌ 超卖" + (sold - limit));
  }
  console.log("  总体:", allOk ? "✅ 无超卖" : "❌ 存在超卖");
}

async function main() {
  console.log("🎯 Ticket Hunter v2.0 压测");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await setup();

  await singleUserBenchmark();
  await concurrentBenchmark();
  await mixedConcurrentBenchmark();

  // 清理
  await redis.del("stock:session:" + SESSION_ID);
  await redis.del("eligibility:session:" + SESSION_ID);
  for (let i = 0; i < 500; i++) {
    await redis.del("user:profile:bench_concurrent_" + i);
    await redis.del("user:profile:bench_mixed_" + i);
  }

  console.log("\n🏁 压测完成");
  await redis.quit();
  process.exit(0);
}

main().catch((e) => {
  console.error("压测失败:", e);
  process.exit(1);
});
