import cron from "node-cron";
import { scrapeDamai } from "./scrapers/damai.js";
import { scrapeMaoyan } from "./scrapers/maoyan.js";
import { scrapeYongle } from "./scrapers/yongle.js";
import { cancelTimeoutOrders } from "./jobs/cancel-orders.js";

console.log("🤖 Ticket Hunter Worker 启动");

cron.schedule("*/30 * * * *", async () => {
  try { await scrapeDamai(); console.log("[cron] 大麦完成"); } catch (e: any) { console.error("[cron] 大麦失败:", e.message); }
});
cron.schedule("*/30 * * * *", async () => {
  try { await scrapeMaoyan(); console.log("[cron] 猫眼完成"); } catch (e: any) { console.error("[cron] 猫眼失败:", e.message); }
});
cron.schedule("0 */2 * * *", async () => {
  try { await scrapeYongle(); console.log("[cron] 永乐完成"); } catch (e: any) { console.error("[cron] 永乐失败:", e.message); }
});
cron.schedule("* * * * *", async () => {
  try { await cancelTimeoutOrders(); } catch (e: any) { console.error("[cron] 超时扫描失败:", e.message); }
});

console.log("✅ 定时任务已注册: 大麦/猫眼 30min | 永乐 2h | 超时扫描 1min");

// 启动时立即执行
scrapeDamai().catch(() => {});
scrapeMaoyan().catch(() => {});
scrapeYongle().catch(() => {});
