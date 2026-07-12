import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { nanoid } from "nanoid";
import { encrypt, decrypt, hashIdCard, maskPhone, maskName } from "../lib/crypto.js";
import { audit } from "../middleware/audit.js";

export async function userRoutes(app: FastifyInstance) {
  // ========== POST /api/users/login — 微信登录 ==========
  app.post("/login", async (request: any, reply) => {
    const { code } = request.body as { code?: string };
    if (!code) return reply.code(400).send({ error: "缺少登录凭证" });

    // 测试用户映射: code "test_verified" → 已核验的种子用户
    const openid = code === "test_verified"
      ? "mock_test_verified"
      : `mock_${code}_${nanoid(6)}`;
    const ip = String(request.ip || request.headers["x-forwarded-for"] || "");
    const ua = request.headers["user-agent"] || "";

    let user = await db.selectFrom("users")
      .select(["id", "openid", "nickname", "avatar_url", "id_verified"])
      .where("openid", "=", openid).executeTakeFirst();

    if (!user) {
      const userId = nanoid();
      await db.insertInto("users").values({
        id: userId, openid,
        nickname: `用户${openid.slice(-4)}`,
        id_verified: false, created_at: new Date(),
      }).execute();
      user = { id: userId, openid, nickname: `用户${openid.slice(-4)}`, avatar_url: null, id_verified: false };

      // 记录同意日志
      await db.insertInto("consent_logs").values({
        id: nanoid(), user_id: userId, type: "privacy_policy",
        agreed: true, ip, created_at: new Date(),
      }).execute();
    }

    // JWT: access(1h) + refresh(7d)
    const accessToken = app.jwt.sign({ id: user.id, openid: user.openid }, { expiresIn: "1h" });
    const refreshToken = app.jwt.sign({ id: user.id, type: "refresh" }, { expiresIn: "7d" });

    await audit({ userId: user.id, action: "login", ip, userAgent: ua,
      detail: { method: "wx_miniapp" } });

    return { accessToken, refreshToken, user };
  });

  // ========== POST /api/users/refresh — 刷新Token ==========
  app.post("/refresh", async (request: any, reply) => {
    try {
      const decoded = app.jwt.verify(request.body?.refreshToken || "");
      if ((decoded as any).type !== "refresh") throw new Error("invalid");
      const accessToken = app.jwt.sign({ id: (decoded as any).id, openid: (decoded as any).openid }, { expiresIn: "1h" });
      const refreshToken = app.jwt.sign({ id: (decoded as any).id, type: "refresh" }, { expiresIn: "7d" });
      return { accessToken, refreshToken };
    } catch {
      return reply.code(401).send({ error: "refresh token 无效" });
    }
  });

  // ========== GET /api/users/me — 个人信息 (脱敏输出) ==========
  app.get("/me", { preHandler: [app.authenticate] } as any, async (request: any) => {
    const user = await db.selectFrom("users")
      .select(["id", "nickname", "avatar_url", "phone_encrypted", "id_verified"])
      .where("id", "=", request.user.id).executeTakeFirst();

    if (!user) return { error: "用户不存在" };
    const rawPhone = user.phone_encrypted ? decrypt(user.phone_encrypted) : null;
    return {
      id: user.id, nickname: user.nickname, avatar_url: user.avatar_url,
      phone: rawPhone ? maskPhone(rawPhone) : null,
      id_verified: user.id_verified,
    };
  });

  // ========== PUT /api/users/profile — 更新信息 (加密存储) ==========
  app.put("/profile", { preHandler: [app.authenticate] } as any, async (request: any) => {
    const { nickname, phone } = request.body as { nickname?: string; phone?: string };
    const updates: any = {};
    if (nickname) updates.nickname = nickname;
    if (phone) updates.phone_encrypted = encrypt(phone);

    if (Object.keys(updates).length === 0) return { error: "无更新内容" };

    await db.updateTable("users").set(updates).where("id", "=", request.user.id).execute();

    await audit({ userId: request.user.id, action: "update_profile",
      ip: String(request.ip || ""), userAgent: request.headers["user-agent"] });

    return { success: true };
  });

  // ========== v1.2: POST /api/users/verify-id — 实名核验 ==========
  app.post("/verify-id", { preHandler: [app.authenticate] } as any, async (request: any, reply) => {
    const { realName, idCard } = request.body as { realName?: string; idCard?: string };
    if (!realName || !idCard) return reply.code(400).send({ error: "缺少姓名或身份证号" });
    if (!/^\d{17}[\dXx]$/.test(idCard)) return reply.code(400).send({ error: "身份证号格式错误" });

    const userId = request.user.id;
    const ip = String(request.ip || "");

    // MVP: 模拟核验 (生产环境对接 CTID / NCIIC)
    // 真实实现：调用第三方API，返回 match: true/false
    const verified = idCard.length >= 18; // 模拟总是通过

    if (verified) {
      const idHash = hashIdCard(idCard);
      await db.updateTable("users").set({
        id_card_hash: idHash, id_verified: true,
      }).where("id", "=", userId).execute();

      await audit({ userId, action: "id_verify", targetType: "user", targetId: userId,
        ip, detail: { name_masked: maskName(realName) } });

      return { verified: true, message: "实名核验通过" };
    }

    await audit({ userId, action: "id_verify_fail", targetType: "user", targetId: userId,
      ip, detail: { reason: "身份信息不匹配" } });
    return reply.code(400).send({ verified: false, error: "身份信息不匹配" });
  });

  // ========== v1.2: DELETE /api/users/account — 注销账号 ==========
  app.delete("/account", { preHandler: [app.authenticate] } as any, async (request: any) => {
    const userId = request.user.id;
    const ip = String(request.ip || "");

    // 物理删除敏感字段，保留订单(合规)
    await db.updateTable("users").set({
      openid: `deleted_${nanoid(8)}`,  // 唯一性冲突规避
      nickname: null, avatar_url: null,
      phone_encrypted: null, phone: null,
      id_card_hash: null, id_verified: false,
    }).where("id", "=", userId).execute();

    await audit({ userId, action: "account_deleted", targetType: "user", targetId: userId, ip });
    return { success: true, message: "账号已注销" };
  });
}
