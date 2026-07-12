import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { nanoid } from "nanoid";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://ticket:ticket_dev@localhost:5433/ticket_hunter",
});
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

// ============================================
// 种子数据 — 全国文体旅演出 (v1.1 含市民通票)
// ============================================

interface TicketSeed {
  name: string;
  price: number;
  eligibility?: Record<string, unknown> | null;
}

interface ShowSeed {
  title: string;
  category: string;
  city: string;
  venue: string;
  poster_url: string;
  description: string;
  source: string;
  sessions: { start: string; sale: string; end: string }[];
  tickets: TicketSeed[];
}

const SHOWS: ShowSeed[] = [
  // === 演唱会 (3场) ===
  {
    title: "周杰伦「嘉年华」世界巡回演唱会—北京站",
    category: "concert", city: "北京", venue: "国家体育场（鸟巢）",
    poster_url: "https://placehold.co/600x800/1a1a2e/e94560?text=周杰伦嘉年华",
    description: "天王周杰伦2026嘉年华巡演北京站，传奇之夜不容错过！",
    source: "manual",
    sessions: [
      { start: "2026-07-18 19:30", sale: "2026-05-20 12:00", end: "2026-07-18 18:00" },
      { start: "2026-07-19 19:30", sale: "2026-05-20 12:00", end: "2026-07-19 18:00" },
    ],
    tickets: [
      { name: "看台票", price: 580 },
      { name: "内场票", price: 1280 },
      { name: "VIP至尊", price: 2280 },
    ],
  },
  {
    title: "Taylor Swift | The Eras Tour — 上海站",
    category: "concert", city: "上海", venue: "上海体育场",
    poster_url: "https://placehold.co/600x800/f8e71c/000?text=Taylor+Swift+Eras",
    description: "霉霉时代之旅，四小时音乐盛宴，全球现象级巡演首次登陆上海！",
    source: "manual",
    sessions: [
      { start: "2026-08-08 19:00", sale: "2026-06-01 10:00", end: "2026-08-08 18:00" },
      { start: "2026-08-09 19:00", sale: "2026-06-01 10:00", end: "2026-08-09 18:00" },
      { start: "2026-08-10 19:00", sale: "2026-06-01 10:00", end: "2026-08-10 18:00" },
    ],
    tickets: [
      { name: "看台C区", price: 680 },
      { name: "看台B区", price: 880 },
      { name: "内场A区", price: 1680 },
      { name: "VIP Package", price: 3280 },
    ],
  },
  {
    title: "陈奕迅「FEAR and DREAMS」世界巡回—广州站",
    category: "concert", city: "广州", venue: "广州天河体育场",
    poster_url: "https://placehold.co/600x800/16213e/e2e2e2?text=陈奕迅+FEAR+DREAMS",
    description: "陈奕迅带着FEAR and DREAMS来到广州，一场声音与视觉的双重震撼。",
    source: "manual",
    sessions: [{ start: "2026-09-05 20:00", sale: "2026-06-15 10:00", end: "2026-09-05 18:00" }],
    tickets: [
      { name: "看台票", price: 480 },
      { name: "内场票", price: 1080 },
      { name: "VIP内场", price: 1880 },
    ],
  },
  // === 体育 (3场) ===
  {
    title: "2026赛季中超联赛 — 北京国安 vs 上海申花",
    category: "sports", city: "北京", venue: "工人体育场",
    poster_url: "https://placehold.co/600x800/00923f/fff?text=国安+VS+申花",
    description: "京沪大战！中超焦点战役，宿敌对决再燃烽火。",
    source: "manual",
    sessions: [{ start: "2026-06-14 19:35", sale: "2026-05-25 10:00", end: "2026-06-14 18:00" }],
    tickets: [
      { name: "普通看台", price: 80 },
      { name: "中层看台", price: 150 },
      { name: "球迷专区", price: 200 },
      { name: "VIP包厢", price: 580 },
    ],
  },
  {
    title: "NBA中国赛2026 — 湖人 vs 勇士 — 深圳站",
    category: "sports", city: "深圳", venue: "深圳大运中心体育馆",
    poster_url: "https://placehold.co/600x800/552583/fdb927?text=NBA中国赛+湖人VS勇士",
    description: "勒布朗·詹姆斯领衔湖人，库里率勇士，NBA中国赛重磅对决！",
    source: "manual",
    sessions: [{ start: "2026-10-10 19:00", sale: "2026-08-15 12:00", end: "2026-10-10 18:00" }],
    tickets: [
      { name: "上层看台", price: 380 },
      { name: "下层看台", price: 880 },
      { name: "场边座", price: 2880 },
      { name: "VIP包厢", price: 5800 },
    ],
  },
  {
    title: "2026成都马拉松",
    category: "sports", city: "成都", venue: "金沙遗址博物馆（起点）",
    poster_url: "https://placehold.co/600x800/d32f2f/fff?text=成都马拉松2026",
    description: "奔跑成都，感受天府之国的魅力！全程/半程/欢乐跑全面开放。",
    source: "manual",
    sessions: [{ start: "2026-10-25 07:30", sale: "2026-08-01 10:00", end: "2026-10-24 23:59" }],
    tickets: [
      { name: "欢乐跑 (5km)", price: 80 },
      { name: "半程马拉松", price: 180 },
      { name: "全程马拉松", price: 280 },
    ],
  },
  // === 话剧 (2场) ===
  {
    title: "《剧院魅影》中文版 — 2026全国巡演·上海站",
    category: "drama", city: "上海", venue: "上海大剧院",
    poster_url: "https://placehold.co/600x800/1a1a2e/c9a96e?text=剧院魅影中文版",
    description: "安德鲁·劳埃德·韦伯传世经典，中文版制作，倾城之恋永不落幕。",
    source: "manual",
    sessions: [
      { start: "2026-07-01 19:30", sale: "2026-05-20 10:00", end: "2026-07-01 18:00" },
      { start: "2026-07-02 19:30", sale: "2026-05-20 10:00", end: "2026-07-02 18:00" },
      { start: "2026-07-03 14:00", sale: "2026-05-20 10:00", end: "2026-07-03 13:00" },
    ],
    tickets: [
      { name: "三层看台", price: 280 },
      { name: "二层看台", price: 480 },
      { name: "一层中区", price: 780 },
      { name: "一层前排", price: 1080 },
    ],
  },
  {
    title: "孟京辉戏剧作品《恋爱的犀牛》— 杭州站",
    category: "drama", city: "杭州", venue: "杭州蜂巢剧场",
    poster_url: "https://placehold.co/600x800/ff4081/fff?text=恋爱的犀牛",
    description: "当代中国戏剧旗帜性作品，「永远的爱情圣经」。",
    source: "manual",
    sessions: [
      { start: "2026-06-20 19:30", sale: "2026-05-20 10:00", end: "2026-06-20 18:00" },
      { start: "2026-06-21 19:30", sale: "2026-05-20 10:00", end: "2026-06-21 18:00" },
    ],
    tickets: [
      { name: "B区", price: 180 },
      { name: "A区", price: 280 },
      { name: "VIP区", price: 380 },
    ],
  },
  // === 展览 (2场) ===
  {
    title: "「永恒的风景」莫奈与印象派大师展 — 北京",
    category: "exhibition", city: "北京", venue: "北京UCCA尤伦斯当代艺术中心",
    poster_url: "https://placehold.co/600x800/4a90d9/fff?text=莫奈+印象派大展",
    description: "囊括莫奈、雷诺阿、德加等印象派大师真迹60余件，来自法国奥赛美术馆馆藏。",
    source: "manual",
    sessions: [{ start: "2026-06-01 09:00", sale: "2026-05-20 10:00", end: "2026-09-30 17:00" }],
    tickets: [
      { name: "平日票", price: 120 },
      { name: "周末票", price: 150 },
      { name: "VIP导览票", price: 380 },
    ],
  },
  {
    title: "teamLab无界美术馆 — 深圳站",
    category: "exhibition", city: "深圳", venue: "深圳海上世界文化艺术中心",
    poster_url: "https://placehold.co/600x800/0f0c29/feac5e?text=teamLab无界",
    description: "全球必看数字艺术展，沉浸式光影体验，在无界的世界中探索。",
    source: "manual",
    sessions: [{ start: "2026-06-15 10:00", sale: "2026-05-20 10:00", end: "2026-12-31 20:00" }],
    tickets: [
      { name: "平日票", price: 199 },
      { name: "假日票", price: 249 },
      { name: "亲子套票(2大1小)", price: 498 },
    ],
  },
  // === 音乐节 (2场) ===
  {
    title: "2026草莓音乐节 — 成都站",
    category: "music_festival", city: "成都", venue: "成都国际非物质文化遗产博览园",
    poster_url: "https://placehold.co/600x800/ff2a2a/fff?text=草莓音乐节2026成都",
    description: "两天两夜音乐狂欢！新裤子、万青、五条人、赵雷等30+组音乐人齐聚。",
    source: "manual",
    sessions: [{ start: "2026-08-15 14:00", sale: "2026-06-20 12:00", end: "2026-08-15 12:00" }],
    tickets: [
      { name: "单日票", price: 380 },
      { name: "双日通票", price: 680 },
      { name: "双日PRO票", price: 980 },
    ],
  },
  {
    title: "2026迷笛音乐节 — 太湖站",
    category: "music_festival", city: "苏州", venue: "苏州太湖迷笛营",
    poster_url: "https://placehold.co/600x800/111/00c853?text=迷笛音乐节2026",
    description: "迷笛三十周年！中国摇滚的乌托邦，三天三夜不停歇。",
    source: "manual",
    sessions: [{ start: "2026-09-12 14:00", sale: "2026-07-10 12:00", end: "2026-09-12 12:00" }],
    tickets: [
      { name: "单日票", price: 280 },
      { name: "通票(含露营)", price: 580 },
    ],
  },

  // ============================================
  // v1.1: 市民一票通 (3场)
  // ============================================
  {
    title: "「上海文化一卡通」2026年度市民通票",
    category: "city_pass", city: "上海",
    venue: "上海大剧院 + 东方艺术中心 + 文化广场 + 上海博物馆",
    poster_url: "https://placehold.co/600x800/c9a96e/1a1a2e?text=上海文化一卡通",
    description: "上海市政府文旅惠民项目！一卡畅游上海大剧院、东方艺术中心、文化广场、上海博物馆等12家文化场馆。全年有效，不限场次（热门演出需预约）。仅限上海户籍或在沪缴纳社保满1年市民购买。",
    source: "manual",
    sessions: [{ start: "2026-06-01 00:00", sale: "2026-05-20 10:00", end: "2026-12-31 23:59" }],
    tickets: [
      { name: "市民单人通票", price: 399, eligibility: { citizen_only: true, city: "上海", id_verify: true, max_per_person: 1 } },
      { name: "市民家庭通票(2大1小)", price: 899, eligibility: { citizen_only: true, city: "上海", id_verify: true, max_per_person: 1 } },
      { name: "非市民单人通票", price: 599, eligibility: { citizen_only: false } },
    ],
  },
  {
    title: "「京彩文惠」北京市民文化一票通",
    category: "city_pass", city: "北京",
    venue: "国家大剧院 + 首都剧场 + 天桥艺术中心 + 798艺术区",
    poster_url: "https://placehold.co/600x800/e94560/fff?text=京彩文惠一票通",
    description: "北京市文旅局「京彩文惠」计划！一票通行国家大剧院、首都剧场、天桥艺术中心、798艺术区等10+场馆。季度通票，每季度可预约6场演出。需北京身份证或居住证核验。",
    source: "manual",
    sessions: [{ start: "2026-07-01 00:00", sale: "2026-05-25 10:00", end: "2026-09-30 23:59" }],
    tickets: [
      { name: "市民季度通票", price: 299, eligibility: { citizen_only: true, city: "北京", id_verify: true, max_per_person: 1 } },
      { name: "市民半年通票", price: 499, eligibility: { citizen_only: true, city: "北京", id_verify: true, max_per_person: 1 } },
      { name: "非市民季度通票", price: 459, eligibility: { citizen_only: false } },
    ],
  },
  {
    title: "「天府惠民」成都文体旅一卡通",
    category: "city_pass", city: "成都",
    venue: "四川大剧院 + 成都博物馆 + 金沙遗址 + 都江堰景区",
    poster_url: "https://placehold.co/600x800/00c853/1a1a2e?text=天府惠民一卡通",
    description: "成都市文体旅局「天府惠民」工程！一卡覆盖四川大剧院、成都博物馆、金沙遗址博物馆、都江堰景区等15家文体旅场馆。年票制，不限预约次数。成都户籍或居住证持有者专享。",
    source: "manual",
    sessions: [{ start: "2026-06-15 00:00", sale: "2026-05-20 10:00", end: "2026-12-31 23:59" }],
    tickets: [
      { name: "市民年票", price: 268, eligibility: { citizen_only: true, city: "成都", id_verify: true, max_per_person: 1 } },
      { name: "市民年票+景区", price: 398, eligibility: { citizen_only: true, city: "成都", id_verify: true, max_per_person: 1 } },
      { name: "非市民年票", price: 398, eligibility: { citizen_only: false } },
    ],
  },
];

async function seed() {
  console.log("🌱 开始灌入种子数据 (v1.1 含市民通票)...");

  for (const showData of SHOWS) {
    const showId = nanoid();

    await db.insertInto("shows").values({
      id: showId, title: showData.title, category: showData.category,
      city: showData.city, venue: showData.venue,
      poster_url: showData.poster_url, description: showData.description,
      status: "on_sale", source: showData.source,
      created_at: new Date(), updated_at: new Date(),
    }).execute();

    for (const session of showData.sessions) {
      const sessionId = nanoid();

      await db.insertInto("sessions").values({
        id: sessionId, show_id: showId,
        start_time: new Date(session.start),
        sale_start_time: new Date(session.sale),
        sale_end_time: new Date(session.end),
        status: "selling", created_at: new Date(),
      }).execute();

      for (const ticket of showData.tickets) {
        const stock = 500 + Math.floor(Math.random() * 9500);
        const sold = Math.floor(Math.random() * stock * 0.3);

        await db.insertInto("ticket_types").values({
          id: nanoid(), session_id: sessionId,
          name: ticket.name, original_price: ticket.price,
          total_stock: stock, sold_count: sold, version: 0,
          eligibility: JSON.stringify(ticket.eligibility || null),
          created_at: new Date(),
        }).execute();
      }
    }
    console.log(`  ✅ ${showData.title}`);
  }

  await db.insertInto("data_sources").values({
    id: nanoid(), name: "manual_seed",
    last_scraped_at: new Date(), item_count: SHOWS.length, status: "active",
  }).onConflict((oc: any) => oc.column("name").doNothing()).execute();

  for (const ds of ["damai", "maoyan", "yongle"]) {
    await db.insertInto("data_sources").values({
      id: nanoid(), name: ds, item_count: 0, status: "active",
    }).onConflict((oc: any) => oc.column("name").doNothing()).execute();
  }

  // v1.2: 测试用户 (已通过实名核验)
  await db.insertInto("users").values({
    id: "test_user_verified",
    openid: "mock_test_verified",
    nickname: "测试市民",
    id_verified: true,
    created_at: new Date(),
  }).onConflict((oc: any) => oc.column("openid").doNothing()).execute();

  // v1.2: 通票捆绑 — 市民通票关联同城演出
  const cityPassShows = await db.selectFrom("shows").select(["id", "city"]).where("category", "=", "city_pass").execute();
  const linkedShows = await db.selectFrom("shows").select(["id", "city"]).where("category", "in", ["drama", "concert"]).execute();

  let bundleCount = 0;
  for (const cp of cityPassShows) {
    const ticketTypes = await db.selectFrom("ticket_types")
      .innerJoin("sessions", "sessions.id", "ticket_types.session_id")
      .select(["ticket_types.id"])
      .where("sessions.show_id", "=", cp.id)
      .limit(1).execute();

    const matching = linkedShows.filter(s => s.city === cp.city);
    for (const show of matching) {
      for (const tt of ticketTypes) {
        await db.insertInto("pass_bundles").values({
          id: nanoid(), ticket_type_id: tt.id, show_id: show.id,
          max_visits: 2, created_at: new Date(),
        }).execute();
        bundleCount++;
      }
    }
  }

  const cityPassCount = SHOWS.filter(s => s.category === "city_pass").length;
  console.log(`\n🎫 种子数据完成！共 ${SHOWS.length} 场演出 (含 ${cityPassCount} 个市民通票) + ${bundleCount} 条通票关联 + 1个测试用户。`);
  await pool.end();
}

seed().catch((err) => {
  console.error("❌ 种子写入失败:", err);
  process.exit(1);
});
