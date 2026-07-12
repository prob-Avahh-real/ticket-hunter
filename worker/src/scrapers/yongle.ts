import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { nanoid } from "nanoid";
import axios from "axios";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://ticket:ticket_dev@localhost:5433/ticket_hunter",
});
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

export async function scrapeYongle() {
  await db.updateTable("data_sources").set({ last_scraped_at: new Date() })
    .where("name", "=", "yongle").executeTakeFirst();

  try {
    const { data } = await axios.get("https://www.228.com.cn/search/", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      params: { keyword: "演唱会", page: 1 }, timeout: 15000,
    });

    const shows = extractShows(data);
    let inserted = 0;

    for (const show of shows) {
      const existing = await db.selectFrom("shows").select("id")
        .where("source", "=", "yongle").where("source_id", "=", show.title).executeTakeFirst();
      if (!existing) {
        await db.insertInto("shows").values({
          id: nanoid(), title: show.title, category: show.category || "concert",
          city: show.city, venue: show.venue, status: "pending",
          source: "yongle", source_id: show.title,
          created_at: new Date(), updated_at: new Date(),
        }).execute();
        inserted++;
      }
    }

    await db.updateTable("data_sources").set({ item_count: inserted, status: "active" })
      .where("name", "=", "yongle").execute();
    console.log(`  [yongle] ${shows.length} 条, 新入库 ${inserted}`);
  } catch (e: any) {
    console.error("  [yongle] 爬取异常:", e.message);
    await db.updateTable("data_sources").set({ status: "error", error_msg: e.message })
      .where("name", "=", "yongle").execute();
  } finally { await pool.end(); }
}

function extractShows(html: string) {
  const results: { title: string; city: string; venue: string; category: string }[] = [];
  const re = /<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    results.push({ title: m[1].trim(), city: "待确认", venue: "待确认", category: "concert" });
  }
  return results.slice(0, 20);
}
