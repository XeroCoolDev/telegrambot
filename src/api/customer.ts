import { Hono, type Context, type Next } from "hono";
import type { AppDb, DbCustomerLine } from "../db/index.js";
import { generateToken } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import { validateInitData } from "../services/telegram-auth.js";
import { isRateLimited } from "../services/rate-limit.js";
import { requirePerm, type AuthEnv } from "./auth.js";

export type CustomerEnv = { Variables: { customerTelegramId: number } };

/** Register the /customer/generate-token endpoint on the reseller API (authenticated) */
export function registerResellerCustomerRoutes(api: Hono<AuthEnv>, db: AppDb) {
  api.post("/customer/generate-token", async (c) => {
    const permErr = requirePerm(c, "canShareWithCustomers");
    if (permErr) return permErr;

    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { lineId } = await c.req.json<{ lineId: string }>();

    const xuiApiKey = c.get("xuiApiKey");
    const lineData = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    const existing = db.getCustomerLineByLineId.get(lineId) as DbCustomerLine | undefined;
    const botUsername = process.env.CUSTOMER_BOT_USERNAME || "";

    if (existing) {
      return c.json({
        token: existing.token,
        link: botUsername ? `https://t.me/${botUsername}?start=${existing.token}` : existing.token,
      });
    }

    const token = generateToken();
    db.createCustomerToken.run(lineId, xuiUserId, token);

    return c.json({
      token,
      link: botUsername ? `https://t.me/${botUsername}?start=${token}` : token,
    });
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
    const customerLines = db.getCustomerLines.all(tgId) as DbCustomerLine[];
    if (customerLines.length === 0) return c.json([]);

    const lines = [];
    for (const cl of customerLines) {
      const reseller = await xui.getUser(cl.reseller_xui_user_id);
      const line = await xui.getLine(cl.xui_line_id);
      if (!line) continue;

      lines.push({
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
        serverDns: reseller?.reseller_dns || null,
        notes: cl.notes || null,
      });
    }

    return c.json(lines);
  });

  customerApi.get("/line/:id", async (c) => {
    const tgId = c.get("customerTelegramId");
    const lineId = c.req.param("id");

    const cl = db.getCustomerLineByLineId.get(lineId) as DbCustomerLine | undefined;
    if (!cl || cl.customer_telegram_id !== tgId) {
      return c.json({ error: "Line not found" }, 404);
    }

    const line = await xui.getLine(lineId);
    if (!line) return c.json({ error: "Line not found" }, 404);

    const reseller = await xui.getUser(cl.reseller_xui_user_id);

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
      serverDns: reseller?.reseller_dns || null,
      notes: cl.notes || null,
    });
  });

  customerApi.post("/update-notes", async (c) => {
    const tgId = c.get("customerTelegramId");
    const { lineId, notes } = await c.req.json<{ lineId: string; notes: string }>();

    const cl = db.getCustomerLineByLineId.get(lineId) as DbCustomerLine | undefined;
    if (!cl || cl.customer_telegram_id !== tgId) {
      return c.json({ error: "Line not found" }, 404);
    }

    db.updateCustomerLineNotes.run(notes || null, lineId, tgId);
    return c.json({ success: true });
  });

  customerApi.post("/toggle-adult", async (c) => {
    const tgId = c.get("customerTelegramId");
    const { lineId, enable } = await c.req.json<{ lineId: string; enable: boolean }>();

    const cl = db.getCustomerLineByLineId.get(lineId) as DbCustomerLine | undefined;
    if (!cl || cl.customer_telegram_id !== tgId) {
      return c.json({ error: "Line not found" }, 404);
    }

    const reseller = await xui.getUser(cl.reseller_xui_user_id);
    if (!reseller) return c.json({ error: "Failed to fetch reseller data" }, 502);

    const success = await xui.toggleAdultContent(reseller.api_key, lineId, enable);
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true, adultEnabled: enable });
  });

  return customerApi;
}
