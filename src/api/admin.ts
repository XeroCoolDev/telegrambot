import type { Hono } from "hono";
import type { AppDb, DbUser } from "../db/index.js";
import { parsePermissions } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import { ADMIN_IDS, type AuthEnv } from "./auth.js";

export function registerAdminRoutes(api: Hono<AuthEnv>, db: AppDb) {
  api.get("/admin/users", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const users = db.db
      .prepare(
        "SELECT telegram_id, username, first_name, xui_user_id, xui_api_key, xui_username, permissions, created_at, last_accessed FROM users ORDER BY created_at DESC"
      )
      .all() as any[];
    return c.json(users.map((u) => ({ ...u, permissions: parsePermissions(u.permissions) })));
  });

  api.get("/admin/payments", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const payments = db.db
      .prepare(
        "SELECT btcpay_invoice_id, telegram_id, credits, amount, currency, item_title, status, created_at FROM payments ORDER BY created_at DESC LIMIT 100"
      )
      .all();
    return c.json(payments);
  });

  api.post("/admin/link", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, xuiUserId } = await c.req.json<{ telegramId: number; xuiUserId: string }>();

    const xuiUser = await xui.getUser(xuiUserId);
    if (!xuiUser) return c.json({ error: "XUI user not found" }, 404);

    // Pre-create the user row if they haven't /start'd yet — username and
    // first_name will be filled in on their first interaction with the bot.
    const targetUser = db.getUser.get(telegramId) as DbUser | undefined;
    if (!targetUser) {
      db.upsertUser.run(telegramId, null, null);
    }

    // Store whatever api_key XUI has (may be empty — admin can paste it in
    // later on the user page after generating in XUI).
    db.linkXui.run(xuiUserId, xuiUser.api_key || null, xuiUser.username || null, telegramId);
    return c.json({
      success: true,
      username: xuiUser.username,
      apiKeyPresent: !!xuiUser.api_key,
    });
  });

  // Admin: set/update api_key manually (after generating in the XUI panel)
  api.post("/admin/set-api-key", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, apiKey } = await c.req.json<{ telegramId: number; apiKey: string }>();

    if (!apiKey || !/^[A-Za-z0-9]{16,64}$/.test(apiKey)) {
      return c.json({ error: "Invalid api_key (alphanumeric, 16–64 chars)" }, 400);
    }

    const target = db.getUser.get(telegramId) as DbUser | undefined;
    if (!target?.xui_user_id) return c.json({ error: "User not linked to an XUI user" }, 404);

    db.linkXui.run(target.xui_user_id, apiKey, target.xui_username || null, telegramId);
    return c.json({ success: true });
  });

  api.post("/admin/unlink", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId } = await c.req.json<{ telegramId: number }>();
    db.linkXui.run(null, null, null, telegramId);
    return c.json({ success: true });
  });

  api.post("/admin/set-permissions", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, permissions } = await c.req.json<{
      telegramId: number;
      permissions: Record<string, boolean>;
    }>();
    db.updatePermissions.run(JSON.stringify(permissions), telegramId);
    return c.json({ success: true });
  });
}
