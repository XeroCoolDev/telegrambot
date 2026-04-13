import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import type { Bot } from "grammy";
import type { AppDb, DbUser, DbPayment, DbCustomerLine } from "../db/index.js";
import { parsePermissions } from "../db/index.js";
import { validateInitData } from "../services/telegram-auth.js";
import { isRateLimited } from "../services/rate-limit.js";
import * as xui from "../services/xui.js";
import * as btcpay from "../services/btcpay.js";
import { notifyPaymentSettled } from "../services/notifications.js";

type Env = { Variables: { telegramId: number; xuiUserId: string; xuiApiKey: string; permissions: string | null } };

export function createApp(db: AppDb, bot: Bot, customerBot?: Bot) {
  const app = new Hono();

  // ── Authenticated API routes ──────────────────────
  const api = new Hono<Env>();

  const ADMIN_IDS_MIDDLEWARE = new Set(
    (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => Number(s.trim())).filter(Boolean)
  );

  api.use("/*", async (c, next) => {
    const initData = c.req.header("X-Telegram-Init-Data");
    if (!initData) return c.json({ error: "Unauthorized" }, 401);

    const validated = validateInitData(initData);
    if (!validated) return c.json({ error: "Invalid init data" }, 401);

    if (isRateLimited(`tg:${validated.user.id}`)) {
      return c.json({ error: "Too many requests" }, 429);
    }

    let user = db.getUser.get(validated.user.id) as DbUser | undefined;

    // Auto-register admins if not in DB
    if (!user && ADMIN_IDS_MIDDLEWARE.has(validated.user.id)) {
      db.upsertUser.run(validated.user.id, validated.user.username || null, validated.user.first_name);
      user = db.getUser.get(validated.user.id) as DbUser | undefined;
    }

    if (!user) return c.json({ error: "Account not registered" }, 403);

    c.set("telegramId", validated.user.id);
    c.set("xuiUserId", user.xui_user_id || "");
    c.set("xuiApiKey", user.xui_api_key || "");
    c.set("permissions", user.permissions || null);
    await next();
  });

  // Helper: check if context user has a permission, returns 403 if not
  function requirePerm(c: any, perm: keyof ReturnType<typeof parsePermissions>) {
    const perms = parsePermissions(c.get("permissions"));
    if (!perms[perm]) return c.json({ error: "Permission denied" }, 403);
    return null;
  }

  // GET /api/me — user info + live credits via reseller API
  api.get("/me", async (c) => {
    const tgId = c.get("telegramId");
    const xuiApiKey = c.get("xuiApiKey");
    const isAdmin = ADMIN_IDS_MIDDLEWARE.has(tgId);

    const permissions = parsePermissions(c.get("permissions"));

    if (!xuiApiKey) {
      return c.json({
        linked: false,
        isAdmin,
        permissions,
        config: {
          maxConnections: Number(process.env.MAX_CONNECTIONS || 3),
          extendConnLockDays: Number(process.env.EXTEND_CONN_LOCK_DAYS || 30),
        },
      });
    }

    const xuiUser = await xui.getUserAsReseller(xuiApiKey);
    if (!xuiUser) return c.json({ error: "Failed to fetch XUI data" }, 502);

    return c.json({
      linked: true,
      credits: parseInt(xuiUser.credits, 10),
      xuiUsername: xuiUser.username,
      isAdmin,
      permissions,
      config: {
        maxConnections: Number(process.env.MAX_CONNECTIONS || 3),
        extendConnLockDays: Number(process.env.EXTEND_CONN_LOCK_DAYS || 30),
      },
    });
  });

  // GET /api/subscriptions — live lines from xui.one
  api.get("/subscriptions", async (c) => {
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json([]);

    const lines = await xui.getUserLines(xuiUserId);
    if (!lines) return c.json({ error: "Failed to fetch lines" }, 502);

    return c.json(
      lines.map((line) => ({
        id: line.id,
        username: line.username,
        status: xui.isLineEnabled(line) ? "active" : "disabled",
        expDate: xui.normaliseExpDate(line.exp_date),
        expiresFormatted: xui.formatExpiry(line.exp_date),
        daysLeft: xui.daysUntilExpiry(line.exp_date),
        maxConnections: line.max_connections,
        adultEnabled: xui.hasAdultBouquets(line),
        resellerNotes: line.reseller_notes || null,
      }))
    );
  });

  // GET /api/line/:id — single line details via reseller get_line endpoint
  api.get("/line/:id", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const lineData = await xui.getLineAsReseller(xuiApiKey, c.req.param("id"));
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    return c.json({
      id: lineData.id,
      username: lineData.username,
      password: lineData.password,
      status: xui.isLineEnabled(lineData) ? "active" : "disabled",
      expDate: xui.normaliseExpDate(lineData.exp_date),
      expiresFormatted: xui.formatExpiry(lineData.exp_date),
      expiresDateTime: xui.formatExpiryWithTime(lineData.exp_date),
      daysLeft: xui.daysUntilExpiry(lineData.exp_date),
      maxConnections: lineData.max_connections,
      isTrial: lineData.is_trial === "1",
      lastIp: lineData.last_ip || null,
      contact: lineData.contact || null,
      resellerNotes: lineData.reseller_notes || null,
      adultEnabled: xui.hasAdultBouquets(lineData),
    });
  });

  // GET /api/packages — available packages from xui.one
  api.get("/packages", async (c) => {
    const packages = await xui.getPackages();
    return c.json(
      packages.map((p) => ({
        id: p.id,
        name: p.package_name,
        credits: parseInt(p.official_credits, 10),
        duration: p.official_duration,
        durationUnit: p.official_duration_in,
        maxConnections: p.max_connections,
      }))
    );
  });

  // GET /api/credit-options — items from BTCPay POS app
  api.get("/credit-options", async (c) => {
    const posApp = await btcpay.fetchPosApp();
    if (!posApp?.items?.length) {
      return c.json({ error: "No credit options available" }, 404);
    }
    return c.json({
      currency: posApp.currency,
      items: posApp.items.map((item) => ({
        id: item.id,
        title: item.title,
        price: item.price,
      })),
    });
  });

  // GET /api/pending-payments — list pending invoices for the current user
  api.get("/pending-payments", async (c) => {
    const tgId = c.get("telegramId");
    const payments = db.getPendingPayments.all(tgId) as DbPayment[];
    return c.json(
      payments.map((p) => ({
        invoiceId: p.btcpay_invoice_id,
        credits: p.credits,
        amount: p.amount,
        currency: p.currency,
        title: p.item_title,
        checkoutUrl: p.checkout_url,
        createdAt: p.created_at,
      }))
    );
  });

  // POST /api/buy-credits — create BTCPay invoice for a POS item
  api.post("/buy-credits", async (c) => {
    const permErr = requirePerm(c, "canBuyCredits");
    if (permErr) return permErr;

    const tgId = c.get("telegramId");
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { itemId, credits, price, itemTitle } = await c.req.json<{
      itemId: string;
      credits: number;
      price: string;
      itemTitle: string;
    }>();

    const posApp = await btcpay.fetchPosApp();
    if (!posApp) return c.json({ error: "Payment system unavailable" }, 502);

    const invoice = await btcpay.createInvoice({
      price,
      currency: posApp.currency,
      metadata: {
        xuiUserId,
        credits,
        itemDesc: itemTitle,
        itemCode: itemId,
      },
    });

    if (!invoice) return c.json({ error: "Failed to create invoice" }, 502);

    // Track for idempotent webhook processing
    db.insertPayment.run(
      tgId,
      invoice.id,
      credits,
      price,
      posApp.currency,
      itemTitle,
      xuiUserId,
      invoice.checkoutLink
    );

    return c.json({
      invoiceId: invoice.id,
      checkoutUrl: invoice.checkoutLink,
    });
  });

  // GET /api/line/:id/connection-options — pricing for connection upgrades
  api.get("/line/:id/connection-options", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const lineData = await xui.getLineAsReseller(xuiApiKey, c.req.param("id"));
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    return c.json(xui.getConnectionUpgradeOptions(lineData));
  });

  // POST /api/lines/add-connections — upgrade connections on a line
  api.post("/lines/add-connections", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    const xuiUserId = c.get("xuiUserId");
    if (!xuiApiKey || !xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { lineId, targetConnections } = await c.req.json<{
      lineId: string;
      targetConnections: number;
    }>();

    const [lineData, userData] = await Promise.all([
      xui.getLineAsReseller(xuiApiKey, lineId),
      xui.getUserAsReseller(xuiApiKey),
    ]);
    if (!lineData || !userData) return c.json({ error: "Failed to fetch data" }, 502);

    const options = xui.getConnectionUpgradeOptions(lineData);
    const selected = options.find((o) => o.to === targetConnections);
    if (!selected) return c.json({ error: "Invalid connection upgrade" }, 400);

    const userCredits = parseInt(userData.credits, 10);
    if (userCredits < selected.cost) {
      return c.json({ error: "Insufficient credits" }, 400);
    }

    // Deduct credits
    const creditOk = await xui.adjustCredits(
      xuiUserId,
      -selected.cost,
      `Upgraded line ${lineId} to ${targetConnections} connections`
    );
    if (!creditOk) return c.json({ error: "Failed to deduct credits" }, 500);

    // Update connections (requires admin API — reseller can't change max_connections)
    const success = await xui.upgradeConnections(lineId, targetConnections);
    if (!success) {
      // Refund credits on failure
      await xui.adjustCredits(xuiUserId, selected.cost, `Refund: failed connection upgrade on line ${lineId}`);
      return c.json({ error: "Failed to upgrade connections" }, 500);
    }

    return c.json({ success: true, connections: targetConnections, cost: selected.cost });
  });

  // POST /api/lines/extend — extend a line using credits (via xui.one)
  api.post("/lines/extend", async (c) => {
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { lineId, packageId } = await c.req.json<{
      lineId: string;
      packageId: string;
    }>();

    const [packages, userData, lineData] = await Promise.all([
      xui.getPackages(),
      xui.getUser(xuiUserId),
      xui.getLine(lineId),
    ]);

    if (!packages || !userData || !lineData) {
      return c.json({ error: "Failed to fetch required data" }, 502);
    }

    const selectedPackage = packages.find((p) => p.id === packageId);
    if (!selectedPackage) {
      return c.json({ error: "Package not found" }, 404);
    }

    // Connection lock: cannot extend with higher-connection package if too many days remaining
    const connLockDays = Number(process.env.EXTEND_CONN_LOCK_DAYS || 30);
    const daysLeft = xui.daysUntilExpiry(lineData.exp_date);
    const pkgConns = parseInt(selectedPackage.max_connections, 10);
    const lineConns = parseInt(lineData.max_connections, 10);
    if (pkgConns > lineConns && daysLeft !== null && daysLeft > connLockDays) {
      return c.json({ error: `Cannot upgrade connections with >${connLockDays} days remaining. Use Add Connections instead.` }, 400);
    }

    const userCredits = parseInt(userData.credits, 10);
    const packageCost = parseInt(selectedPackage.official_credits, 10);
    if (userCredits < packageCost) {
      return c.json({ error: "Insufficient credits" }, 400);
    }

    const success = await xui.extendLineHybrid(
      userData,
      lineData,
      selectedPackage
    );
    if (!success) {
      return c.json({ error: "Failed to extend line" }, 500);
    }

    return c.json({ success: true });
  });

  // POST /api/lines/update-info — update contact and/or reseller notes via reseller API
  api.post("/lines/update-info", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId, contact, resellerNotes } = await c.req.json<{
      lineId: string;
      contact?: string;
      resellerNotes?: string;
    }>();

    const success = await xui.updateLineInfo(xuiApiKey, lineId, {
      contact,
      reseller_notes: resellerNotes,
    });
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true });
  });

  // POST /api/lines/delete — delete a line
  api.post("/lines/delete", async (c) => {
    const permErr = requirePerm(c, "canDeleteLine");
    if (permErr) return permErr;

    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId } = await c.req.json<{ lineId: string }>();

    // Verify the line belongs to this user
    const lineData = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    const success = await xui.deleteLine(lineId);
    if (!success) return c.json({ error: "Failed to delete line" }, 500);

    return c.json({ success: true });
  });

  // POST /api/lines/toggle-enabled — enable/disable a line (admin API)
  api.post("/lines/toggle-enabled", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId, enabled } = await c.req.json<{
      lineId: string;
      enabled: boolean;
    }>();

    // Verify the line belongs to this user
    const lineData = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    const success = await xui.toggleLineEnabled(lineId, enabled);
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true, enabled });
  });

  // POST /api/lines/toggle-adult — enable/disable adult bouquets on a line
  api.post("/lines/toggle-adult", async (c) => {
    const permErr = requirePerm(c, "canToggleAdult");
    if (permErr) return permErr;

    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId, enable } = await c.req.json<{
      lineId: string;
      enable: boolean;
    }>();

    const success = await xui.toggleAdultContent(xuiApiKey, lineId, enable);
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true, adultEnabled: enable });
  });

  // POST /api/lines/create — create a new line using credits (via xui.one)
  api.post("/lines/create", async (c) => {
    const permErr = requirePerm(c, "canCreateLine");
    if (permErr) return permErr;

    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { packageId, resellerNotes, contact } = await c.req.json<{
      packageId: string;
      resellerNotes?: string;
      contact?: string;
    }>();

    const [packages, userData] = await Promise.all([
      xui.getPackages(),
      xui.getUser(xuiUserId),
    ]);

    if (!packages || !userData) {
      return c.json({ error: "Failed to fetch required data" }, 502);
    }

    const selectedPackage = packages.find((p) => p.id === packageId);
    if (!selectedPackage) {
      return c.json({ error: "Package not found" }, 404);
    }

    const userCredits = parseInt(userData.credits, 10);
    const packageCost = parseInt(selectedPackage.official_credits, 10);
    if (userCredits < packageCost) {
      return c.json({ error: "Insufficient credits" }, 400);
    }

    const newLine = await xui.createNewLine(
      userData.api_key,
      packageId,
      resellerNotes || "",
      contact || ""
    );

    if (!newLine) {
      return c.json({ error: "Failed to create line" }, 500);
    }

    return c.json({ success: true, lineId: newLine.id });
  });

  // ── Shared settlement logic ───────────────────────
  async function settlePayment(invoiceId: string): Promise<boolean> {
    const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
    if (!payment) return false;
    if (payment.status === "settled") return true; // already done

    const success = await xui.adjustCredits(
      payment.xui_user_id,
      payment.credits,
      `BTCPay invoice ${invoiceId}`
    );

    db.updatePaymentStatus.run(
      success ? "settled" : "failed",
      invoiceId
    );

    if (success) {
      await notifyPaymentSettled(bot, db, payment, invoiceId);
    } else {
      try {
        await bot.api.sendMessage(payment.telegram_id,
          `⚠️ Payment received but credits could not be applied. Please contact support.\nInvoice: \`${invoiceId}\``,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("[webhook] Failed to notify user:", err);
      }
    }

    return success;
  }

  // ── BTCPay webhook (unauthenticated) ─────────────
  app.post("/webhooks/btcpay", async (c) => {
    const rawBody = await c.req.text();
    const sig = c.req.header("BTCPAY-SIG") || "";

    if (!btcpay.verifyWebhookSignature(rawBody, sig)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(rawBody);
    const { invoiceId, type } = event;

    switch (type) {
      case "InvoiceSettled": {
        await settlePayment(invoiceId);
        break;
      }
      case "InvoiceExpired": {
        const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
        if (payment && payment.status === "pending") {
          db.updatePaymentStatus.run("expired", invoiceId);
        }
        break;
      }
    }

    return c.json({ ok: true });
  });

  // ── Customer API routes ───────────────────────────
  type CustomerEnv = { Variables: { customerTelegramId: number } };
  const customerApi = new Hono<CustomerEnv>();

  customerApi.use("/*", async (c, next) => {
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

  // GET /customer/lines — list customer's linked lines
  customerApi.get("/lines", async (c) => {
    const tgId = c.get("customerTelegramId");
    const customerLines = db.getCustomerLines.all(tgId) as DbCustomerLine[];
    if (customerLines.length === 0) return c.json([]);

    const lines = [];
    for (const cl of customerLines) {
      // Get reseller info for DNS
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

  // GET /customer/line/:id — single line details
  customerApi.get("/line/:id", async (c) => {
    const tgId = c.get("customerTelegramId");
    const lineId = c.req.param("id");

    // Verify customer owns this line
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

  // POST /customer/update-notes — customer updates their own notes on a line
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

  // POST /customer/toggle-adult — toggle adult content
  customerApi.post("/toggle-adult", async (c) => {
    const tgId = c.get("customerTelegramId");
    const { lineId, enable } = await c.req.json<{ lineId: string; enable: boolean }>();

    const cl = db.getCustomerLineByLineId.get(lineId) as DbCustomerLine | undefined;
    if (!cl || cl.customer_telegram_id !== tgId) {
      return c.json({ error: "Line not found" }, 404);
    }

    // Get the reseller's API key to use reseller edit_line
    const reseller = await xui.getUser(cl.reseller_xui_user_id);
    if (!reseller) return c.json({ error: "Failed to fetch reseller data" }, 502);

    const success = await xui.toggleAdultContent(reseller.api_key, lineId, enable);
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true, adultEnabled: enable });
  });

  // POST /customer/generate-token — reseller generates a share link for a line
  api.post("/customer/generate-token", async (c) => {
    const permErr = requirePerm(c, "canShareWithCustomers");
    if (permErr) return permErr;

    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const enabledResellers = new Set(
      (process.env.CUSTOMER_ENABLED_RESELLERS || "").split(",").map((s) => s.trim()).filter(Boolean)
    );
    if (enabledResellers.size > 0 && !enabledResellers.has(xuiUserId)) {
      return c.json({ error: "Customer sharing not enabled for your account" }, 403);
    }

    const { lineId } = await c.req.json<{ lineId: string }>();

    // Verify line belongs to this reseller
    const xuiApiKey = c.get("xuiApiKey");
    const lineData = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    // Check if token already exists for this line
    const existing = db.getCustomerLineByLineId.get(lineId) as DbCustomerLine | undefined;
    if (existing) {
      const botUsername = process.env.CUSTOMER_BOT_USERNAME || "";
      return c.json({ token: existing.token, link: botUsername ? `https://t.me/${botUsername}?start=${existing.token}` : existing.token });
    }

    // Generate new token
    const { generateToken } = await import("../db/index.js");
    const token = generateToken();
    db.createCustomerToken.run(lineId, xuiUserId, token);

    const botUsername = process.env.CUSTOMER_BOT_USERNAME || "";
    return c.json({ token, link: botUsername ? `https://t.me/${botUsername}?start=${token}` : token });
  });

  // ── Admin API (reuses reseller auth, checks admin) ──

  api.get("/admin/users", async (c) => {
    if (!ADMIN_IDS_MIDDLEWARE.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const users = db.db.prepare("SELECT telegram_id, username, first_name, xui_user_id, permissions, created_at FROM users ORDER BY created_at DESC").all() as any[];
    return c.json(users.map((u) => ({ ...u, permissions: parsePermissions(u.permissions) })));
  });

  api.get("/admin/payments", async (c) => {
    if (!ADMIN_IDS_MIDDLEWARE.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const payments = db.db.prepare("SELECT btcpay_invoice_id, telegram_id, credits, amount, currency, item_title, status, created_at FROM payments ORDER BY created_at DESC LIMIT 100").all();
    return c.json(payments);
  });

  api.get("/admin/customers", async (c) => {
    if (!ADMIN_IDS_MIDDLEWARE.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const customers = db.db.prepare("SELECT c.telegram_id, c.username, c.first_name, c.created_at FROM customers c ORDER BY c.created_at DESC").all();
    return c.json(customers);
  });

  api.get("/admin/customer-lines", async (c) => {
    if (!ADMIN_IDS_MIDDLEWARE.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const lines = db.db.prepare("SELECT cl.xui_line_id, cl.customer_telegram_id, cl.reseller_xui_user_id, cl.notes, cl.created_at, c.username as customer_username FROM customer_lines cl LEFT JOIN customers c ON cl.customer_telegram_id = c.telegram_id ORDER BY cl.created_at DESC").all();
    return c.json(lines);
  });

  api.post("/admin/link", async (c) => {
    if (!ADMIN_IDS_MIDDLEWARE.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, xuiUserId } = await c.req.json<{ telegramId: number; xuiUserId: string }>();

    const targetUser = db.getUser.get(telegramId) as DbUser | undefined;
    if (!targetUser) return c.json({ error: "User not found. They need to /start first." }, 404);

    const xuiUser = await xui.getUser(xuiUserId);
    if (!xuiUser) return c.json({ error: "XUI user not found" }, 404);

    db.linkXui.run(xuiUserId, xuiUser.api_key, telegramId);
    return c.json({ success: true, username: xuiUser.username });
  });

  api.post("/admin/unlink", async (c) => {
    if (!ADMIN_IDS_MIDDLEWARE.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId } = await c.req.json<{ telegramId: number }>();
    db.linkXui.run(null, null, telegramId);
    return c.json({ success: true });
  });

  api.post("/admin/set-permissions", async (c) => {
    if (!ADMIN_IDS_MIDDLEWARE.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, permissions } = await c.req.json<{ telegramId: number; permissions: Record<string, boolean> }>();
    db.updatePermissions.run(JSON.stringify(permissions), telegramId);
    return c.json({ success: true });
  });

  // ── Mount ─────────────────────────────────────────
  app.use("/api/*", cors());
  app.route("/api", api);
  app.use("/customer/*", cors());
  app.route("/customer", customerApi);

  // Customer mini app (served at /c/*)
  app.use("/c/*", serveStatic({
    root: "./dist/customer",
    rewriteRequestPath: (path) => path.replace(/^\/c/, ""),
  }));
  app.get("/c/*", serveStatic({
    root: "./dist/customer",
    rewriteRequestPath: () => "/index.html",
  }));

  // Reseller mini app (default)
  app.use("/*", serveStatic({ root: "./dist/public" }));
  app.get("/*", serveStatic({ root: "./dist/public", path: "index.html" }));

  return app;
}
