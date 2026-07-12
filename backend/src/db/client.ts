import pg from "pg";
import { Kysely, PostgresDialect, sql } from "kysely";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://ticket:ticket_dev@localhost:5433/ticket_hunter",
  max: 20,
});

export const db = new Kysely({ dialect: new PostgresDialect({ pool }) });

export type ShowCategory =
  | "concert" | "sports" | "drama" | "exhibition" | "music_festival"
  | "opera" | "dance" | "city_pass" | "other";

export interface ShowsTable {
  id: string; title: string; category: ShowCategory;
  city: string; venue: string; poster_url: string | null;
  description: string | null;
  status: "pending" | "on_sale" | "sold_out" | "ended" | "cancelled";
  source: "damai" | "maoyan" | "yongle" | "manual";
  source_id: string | null; created_at: Date; updated_at: Date;
}

export interface SessionsTable {
  id: string; show_id: string; start_time: Date;
  sale_start_time: Date; sale_end_time: Date;
  status: "upcoming" | "selling" | "sold_out" | "ended"; created_at: Date;
}

export interface Eligibility {
  citizen_only?: boolean; city?: string; id_verify?: boolean;
  age_min?: number; age_max?: number; max_per_person?: number;
}

export interface TicketTypesTable {
  id: string; session_id: string; name: string; original_price: number;
  total_stock: number; sold_count: number; version: number;
  eligibility: Eligibility | null; created_at: Date;
}

export interface OrdersTable {
  id: string; user_id: string; session_id: string; total_amount: number;
  status: "pending" | "paid" | "cancelled" | "refunded";
  paid_at: Date | null; created_at: Date;
}

export interface OrderItemsTable {
  id: string; order_id: string; ticket_type_id: string;
  quantity: number; unit_price: number;
}

export interface UsersTable {
  id: string; openid: string; unionid: string | null;
  nickname: string | null; avatar_url: string | null;
  phone: string | null;                   // DEPRECATED: 改为 phone_encrypted
  phone_encrypted: string | null;         // v1.2: AES-256-GCM 加密
  id_card_hash: string | null;            // v1.2: HMAC-SHA256 不可逆
  id_verified: boolean;                   // v1.2: 是否通过实名核验
  created_at: Date;
}

export interface DataSourcesTable {
  id: string; name: string; last_scraped_at: Date | null;
  item_count: number; status: "active" | "error" | "disabled";
  error_msg: string | null;
}

export interface PassBundlesTable {
  id: string; ticket_type_id: string; show_id: string;
  max_visits: number; created_at: Date;
}

export interface AuditLogsTable {
  id: string; user_id: string | null; action: string;
  target_type: string | null; target_id: string | null;
  ip: string | null; user_agent: string | null;
  detail: string | null; created_at: Date;
}

export interface ConsentLogsTable {
  id: string; user_id: string; type: string;
  agreed: boolean; ip: string | null; created_at: Date;
}

export interface Database {
  shows: ShowsTable; sessions: SessionsTable;
  ticket_types: TicketTypesTable; orders: OrdersTable;
  order_items: OrderItemsTable; users: UsersTable;
  data_sources: DataSourcesTable; pass_bundles: PassBundlesTable;
  audit_logs: AuditLogsTable; consent_logs: ConsentLogsTable;
}
