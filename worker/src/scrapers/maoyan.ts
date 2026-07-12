// ============================================
// 猫眼电影/演出数据爬取器（骨架）
// ============================================
// MVP阶段提供框架。猫眼的演出页面为SPA渲染，需用Puppeteer
// 或直接调用猫眼内部API（/api/mmdb 系列）。
// ============================================

import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { nanoid } from "nanoid";
import axios from "axios";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://ticket:ticket_dev@localhost:5433/ticket_hunter",
});
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

export async function scrapeMaoyan() {
  await db
    .updateTable("data_sources")
    .set({ last_scraped_at: new Date() })
    .where("name", "=", "maoyan")
    .executeTakeFirst();

  try {
    // 猫眼演出内部API（示例，实际endpoint需抓包确认）
    const { data } = await axios.get(
      "https://api.maoyan.com/mmdb/show/v2/list.json",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
        },
        timeout: 15000,
      }
    );

    const shows = (data?.data?.list || []).map((item: any) => ({
      title: item.nm || item.showName,
      city: item.cityName || "待确认",
      venue: item.venue || "待确认",
      category: item.category || "concert",
    }));

    for (const show of shows) {
      const existing = await db
        .selectFrom("shows")
        .select("id")
        .where("source", "=", "maoyan")
        .where("source_id", "=", show.title)
        .executeTakeFirst();

      if (!existing) {
        await db
          .insertInto("shows")
          .values({
            id: nanoid(),
            title: show.title,
            category: "concert",
            city: show.city,
            venue: show.venue,
            status: "pending",
            source: "maoyan",
            source_id: show.title,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute();
      }
    }

    await db
      .updateTable("data_sources")
      .set({ item_count: shows.length, status: "active" })
      .where("name", "=", "maoyan")
      .execute();

    console.log(`  [maoyan] 获取到 ${shows.length} 条数据`);
  } catch (e: any) {
    console.error("  [maoyan] 爬取异常:", e.message);
    await db
      .updateTable("data_sources")
      .set({ status: "error", error_msg: e.message })
      .where("name", "=", "maoyan")
      .execute();
  } finally {
    await pool.end();
  }
}
