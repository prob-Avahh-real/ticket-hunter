// ============================================
// 大麦网数据爬取器（骨架）
// ============================================
// MVP阶段：大麦网反爬严格，此处提供爬取框架。
// 生产环境需配合IP代理池、请求头轮换、验证码识别。
// 推荐方案：使用大麦开放平台API（需企业资质申请）。
// ============================================

import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { nanoid } from "nanoid";
import axios from "axios";
import * as cheerio from "cheerio";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://ticket:ticket_dev@localhost:5433/ticket_hunter",
});
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

export async function scrapeDamai() {
  // 更新数据源状态
  await db
    .updateTable("data_sources")
    .set({ last_scraped_at: new Date() })
    .where("name", "=", "damai")
    .executeTakeFirst();

  try {
    // 大麦网热门演出页
    const { data } = await axios.get("https://search.damai.cn/search.html", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const shows: any[] = [];

    // 大麦页面结构（示例，实际DOM需抓取后适配）
    $(".search-item").each((_, el) => {
      const title = $(el).find(".item-title").text().trim();
      const venue = $(el).find(".item-venue").text().trim();
      const city = $(el).find(".item-city").text().trim();
      if (title) {
        shows.push({
          title,
          venue: venue || "待确认",
          city: city || "待确认",
          category: "concert",
        });
      }
    });

    // 入库（去重）
    for (const show of shows) {
      const existing = await db
        .selectFrom("shows")
        .select("id")
        .where("source", "=", "damai")
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
            source: "damai",
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
      .where("name", "=", "damai")
      .execute();

    console.log(`  [damai] 获取到 ${shows.length} 条数据`);
  } catch (e: any) {
    console.error("  [damai] 爬取异常:", e.message);
    await db
      .updateTable("data_sources")
      .set({ status: "error", error_msg: e.message })
      .where("name", "=", "damai")
      .execute();
  } finally {
    await pool.end();
  }
}
