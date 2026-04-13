import type { Hono } from "hono";
import type { AppDb, DbUser } from "../db/index.js";
import { parsePermissions } from "../db/index.js";
import * as xui from "../services/xui.js";
import { ADMIN_IDS, type AuthEnv } from "./auth.js";

export function registerAdminRoutes(api: Hono<AuthEnv>, db: AppDb) {
  api.get("/admin/users", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const users = db.db
      .prepare(
        "SELECT telegram_id, username, first_name, xui_user_id, permissions, created_at FROM users ORDER BY created_at DESC"
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

  api.get("/admin/customers", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const customers = db.db
      .prepare("SELECT c.telegram_id, c.username, c.first_name, c.created_at FROM customers c ORDER BY c.created_at DESC")
      .all();
    return c.json(customers);
  });

  api.get("/admin/customer-lines", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const lines = db.db
      .prepare(
        "SELECT cl.xui_line_id, cl.customer_telegram_id, cl.reseller_xui_user_id, cl.notes, cl.created_at, c.username as customer_username FROM customer_lines cl LEFT JOIN customers c ON cl.customer_telegram_id = c.telegram_id ORDER BY cl.created_at DESC"
      )
      .all();
    return c.json(lines);
  });

  api.post("/admin/link", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, xuiUserId } = await c.req.json<{ telegramId: number; xuiUserId: string }>();

    const targetUser = db.getUser.get(telegramId) as DbUser | undefined;
    if (!targetUser) return c.json({ error: "User not found. They need to /start first." }, 404);

    const xuiUser = await xui.getUser(xuiUserId);
    if (!xuiUser) return c.json({ error: "XUI user not found" }, 404);

    db.linkXui.run(xuiUserId, xuiUser.api_key, telegramId);
    return c.json({ success: true, username: xuiUser.username });
  });

  api.post("/admin/unlink", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId } = await c.req.json<{ telegramId: number }>();
    db.linkXui.run(null, null, telegramId);
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
