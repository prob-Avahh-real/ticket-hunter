import { db } from "../db/client.js";
import { nanoid } from "nanoid";

export interface AuditEntry {
  userId?: string; action: string; targetType?: string;
  targetId?: string; ip?: string; userAgent?: string;
  detail?: Record<string, unknown>;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.insertInto("audit_logs").values({
      id: nanoid(), user_id: entry.userId || null,
      action: entry.action, target_type: entry.targetType || null,
      target_id: entry.targetId || null, ip: entry.ip || null,
      user_agent: entry.userAgent || null,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
      created_at: new Date(),
    }).execute();
  } catch (e) { console.error("[audit] 写入失败:", e); }
}
