import { Hono, type Context, type Next } from "hono";
import type { Bot } from "grammy";
import type { AppDb } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import { validateInitData } from "../services/telegram-auth.js";
import { isRateLimited } from "../services/rate-limit.js";
import type { AuthEnv } from "./auth.js";

export type CustomerEnv = { Variables: { customerTelegramId: number } };

const RENEWAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

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
export function createCustomerApi(db: AppDb, customerBot?: Bot): Hono<CustomerEnv> {
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

    const reseller = await xui.getUser(line.member_id);
    const serverUrl = reseller?.reseller_dns
      ? /^https?:\/\//.test(reseller.reseller_dns)
        ? reseller.reseller_dns
        : `http://${reseller.reseller_dns}`
      : null;

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
      serverUrl,
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

  customerApi.post("/request-renewal", async (c) => {
    const tgId = c.get("customerTelegramId");
    const { lineId } = await c.req.json<{ lineId: string }>();
    if (!lineId) return c.json({ error: "Missing lineId" }, 400);

    if (!db.isLineClaimedBy.get(tgId, lineId)) {
      return c.json({ error: "Line not found" }, 404);
    }

    // Rate limit: once per 24 hours per (customer, line)
    const prev = db.getRenewalRequest.get(tgId, lineId) as { requested_at: string } | undefined;
    if (prev) {
      const prevMs = new Date(prev.requested_at + "Z").getTime();
      if (Date.now() - prevMs < RENEWAL_COOLDOWN_MS) {
        return c.json(
          { error: "You've already requested a renewal today. We'll be in touch." },
          429
        );
      }
    }

    const supportChatId = process.env.SUPPORT_FORUM_CHAT_ID;
    if (!customerBot || !supportChatId) {
      return c.json({ error: "Support is not configured." }, 503);
    }

    const line = await xui.getLine(lineId);
    if (!line) return c.json({ error: "Line not found" }, 404);

    const topic = db.getSupportTopic.get(tgId) as { thread_id: number } | undefined;
    if (!topic) {
      return c.json(
        { error: "Please send a message to the bot first so we can open a chat with you." },
        400
      );
    }

    const expires = xui.formatExpiry(line.exp_date);
    const msg =
      `🔔 <b>Renewal requested</b>\n` +
      `Line: <code>${line.username}</code>\n` +
      `Expires: ${expires}\n` +
      `Connections: ${line.max_connections}`;

    // Post to the customer's DM first so we have a message id to thread back to
    let customerDmMsgId: number | undefined;
    try {
      const sent = await customerBot.api.sendMessage(tgId, msg, { parse_mode: "HTML" });
      customerDmMsgId = sent.message_id;
    } catch (err) {
      console.error("[api] request-renewal customer-side send failed:", err);
    }

    // Post into the topic — if we have a customer-side msg id, record the
    // mapping so reseller replies to this message thread back to the customer
    try {
      const sent = await customerBot.api.sendMessage(Number(supportChatId), msg, {
        message_thread_id: topic.thread_id,
        parse_mode: "HTML",
      });
      if (customerDmMsgId) {
        db.recordRelayedMessage.run(sent.message_id, tgId, customerDmMsgId);
      }
    } catch (err) {
      console.error("[api] request-renewal post failed:", err);
      return c.json({ error: "Couldn't notify support. Try again shortly." }, 502);
    }

    db.upsertRenewalRequest.run(tgId, lineId);
    return c.json({ success: true });
  });

  return customerApi;
}
