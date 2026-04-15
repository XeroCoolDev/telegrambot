import { Hono, type Context, type Next } from "hono";
import type { AppDb } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import { validateInitData } from "../services/telegram-auth.js";
import { isRateLimited } from "../services/rate-limit.js";
import type { AuthEnv } from "./auth.js";

export type CustomerEnv = { Variables: { customerTelegramId: number } };

/** Register reseller-side endpoints for managing customer claims */
export function registerResellerCustomerRoutes(api: Hono<AuthEnv>, db: AppDb) {
  // List customers linked to a given line (reseller must own it)
  api.get("/customer/line-claims/:lineId", async (c) => {
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const lineId = c.req.param("lineId");
    const xuiApiKey = c.get("xuiApiKey");
    const line = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!line) return c.json({ error: "Line not found" }, 404);

    const rows = db.getClaimsForLine.all(lineId) as {
      telegram_id: number;
      username: string | null;
      first_name: string | null;
      created_at: string;
    }[];
    return c.json(rows);
  });

  // Unlink a specific tg id from a line (reseller must own the line)
  api.post("/customer/unclaim", async (c) => {
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { lineId, telegramId } = await c.req.json<{ lineId: string; telegramId: number }>();
    if (!lineId || !telegramId) return c.json({ error: "Missing lineId or telegramId" }, 400);

    const xuiApiKey = c.get("xuiApiKey");
    const line = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!line) return c.json({ error: "Line not found" }, 404);

    db.unclaimLine.run(telegramId, lineId);
    return c.json({ success: true });
  });
}

/** Build the customer API (separate auth, own middleware) */
export function createCustomerApi(db: AppDb): Hono<CustomerEnv> {
  const customerApi = new Hono<CustomerEnv>();

  customerApi.use("/*", async (c: Context<CustomerEnv>, next: Next) => {
    const initData = c.req.header("X-Telegram-Init-Data");
    if (!initData) return c.json({ error: "Unauthorized" }, 401);

    const customerToken = process.env.CUSTOMER_BOT_TOKEN;
    if (!customerToken) return c.json({ error: "Customer bot not configured" }, 503);

    const validated = validateInitData(initData, customerToken);
    if (!validated) return c.json({ error: "Invalid init data" }, 401);

    if (isRateLimited(`ctg:${validated.user.id}`)) {
      return c.json({ error: "Too many requests" }, 429);
    }

    c.set("customerTelegramId", validated.user.id);
    await next();
  });

  customerApi.get("/lines", async (c) => {
    const tgId = c.get("customerTelegramId");
    const rows = db.getClaimedLineIds.all(tgId) as { xui_line_id: string }[];
    if (rows.length === 0) return c.json([]);

    const lines = (
      await Promise.all(rows.map((r) => xui.getLine(r.xui_line_id)))
    ).filter((l): l is NonNullable<typeof l> => !!l);

    return c.json(
      lines.map((line) => ({
        id: line.id,
        username: line.username,
        password: "", // not included in list view; fetched per-line on detail
        status: xui.isLineEnabled(line) ? "active" : "disabled",
        expDate: xui.normaliseExpDate(line.exp_date),
        expiresFormatted: xui.formatExpiry(line.exp_date),
        expiresDateTime: xui.formatExpiryWithTime(line.exp_date),
        daysLeft: xui.daysUntilExpiry(line.exp_date),
        maxConnections: line.max_connections,
        adultEnabled: xui.hasAdultBouquets(line),
      }))
    );
  });

  customerApi.get("/line/:id", async (c) => {
    const tgId = c.get("customerTelegramId");
    const lineId = c.req.param("id");

    if (!db.isLineClaimedBy.get(tgId, lineId)) {
      return c.json({ error: "Line not found" }, 404);
    }

    const line = await xui.getLine(lineId);
    if (!line) return c.json({ error: "Line not found" }, 404);

    return c.json({
      id: line.id,
      username: line.username,
      password: line.password,
      status: xui.isLineEnabled(line) ? "active" : "disabled",
      expDate: xui.normaliseExpDate(line.exp_date),
      expiresFormatted: xui.formatExpiry(line.exp_date),
      expiresDateTime: xui.formatExpiryWithTime(line.exp_date),
      daysLeft: xui.daysUntilExpiry(line.exp_date),
      maxConnections: line.max_connections,
      adultEnabled: xui.hasAdultBouquets(line),
    });
  });

  customerApi.post("/toggle-adult", async (c) => {
    const tgId = c.get("customerTelegramId");
    const { lineId, enable } = await c.req.json<{ lineId: string; enable: boolean }>();

    if (!db.isLineClaimedBy.get(tgId, lineId)) {
      return c.json({ error: "Line not found" }, 404);
    }

    const line = await xui.getLine(lineId);
    if (!line) return c.json({ error: "Line not found" }, 404);

    const reseller = await xui.getUser(line.member_id);
    if (!reseller) return c.json({ error: "Failed to fetch reseller data" }, 502);

    const success = await xui.toggleAdultContent(reseller.api_key, lineId, enable);
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true, adultEnabled: enable });
  });

  return customerApi;
}
