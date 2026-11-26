import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bot } from "grammy";
import type { AppDb } from "../db/index.js";
import { xerocoolAuthMiddleware, type AuthEnv } from "./auth.js";
import { registerMeRoutes } from "./me.js";
import { registerLineRoutes } from "./lines.js";
import { registerCreditRoutes, registerBtcpayWebhook } from "./credits.js";
import { registerAdminRoutes } from "./admin.js";
import { registerXerocoolXposedRoutes, createXposedApi } from "./xposed.js";

/** Paths owned by the API; static hosting must never answer for them. */
export const API_PREFIXES = ["/xerocool", "/xposed", "/webhooks", "/telegram", "/setup", "/health"];

/** Host that serves the Xposed (customer) mini-app; every other host serves XeroCool. */
export function xposedHost(): string {
  try {
    return new URL(process.env.XPOSED_WEBAPP_URL || "").host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The API: everything except static hosting, which differs per runtime
 * (`static-node.ts` reads ./dist, the Worker uses its assets binding) and is
 * mounted by the entrypoint after this returns.
 */
export function createApp(db: AppDb, xerocoolBot: Bot, xposedBot?: Bot) {
  const app = new Hono();

  // XeroCool (reseller) API — authenticated
  const xerocoolApi = new Hono<AuthEnv>();
  xerocoolApi.use("/*", xerocoolAuthMiddleware(db));
  registerMeRoutes(xerocoolApi);
  registerLineRoutes(xerocoolApi, db);
  registerCreditRoutes(xerocoolApi, db, xerocoolBot);
  registerAdminRoutes(xerocoolApi, db);
  registerXerocoolXposedRoutes(xerocoolApi, db);

  // Xposed (customer) API — separate auth
  const xposedApi = createXposedApi(db, xposedBot);

  // Health check — for uptime monitors (UptimeRobot, etc.)
  app.get("/health", (c) => c.json({ ok: true }));

  // BTCPay webhook (unauthenticated)
  registerBtcpayWebhook(app, db, xerocoolBot);

  // APIs — mounted under distinct prefixes regardless of host
  app.use("/xerocool/*", cors());
  app.route("/xerocool", xerocoolApi);
  app.use("/xposed/*", cors());
  app.route("/xposed", xposedApi);

  return app;
}
