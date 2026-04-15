import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import type { Bot } from "grammy";
import type { AppDb } from "../db/index.js";
import { xerocoolAuthMiddleware, type AuthEnv } from "./auth.js";
import { registerMeRoutes } from "./me.js";
import { registerLineRoutes } from "./lines.js";
import { registerCreditRoutes, registerBtcpayWebhook } from "./credits.js";
import { registerAdminRoutes } from "./admin.js";
import { registerXerocoolXposedRoutes, createXposedApi } from "./xposed.js";

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

  // BTCPay webhook (unauthenticated)
  registerBtcpayWebhook(app, db, xerocoolBot);

  // APIs — mounted under distinct prefixes regardless of host
  app.use("/xerocool/*", cors());
  app.route("/xerocool", xerocoolApi);
  app.use("/xposed/*", cors());
  app.route("/xposed", xposedApi);

  // Static hosting per hostname:
  //   XPOSED_HOST  → serve Xposed mini-app at /
  //   anything else → serve XeroCool mini-app at /
  const xposedHost = (() => {
    const u = process.env.XPOSED_WEBAPP_URL || "";
    try {
      return new URL(u).host.toLowerCase();
    } catch {
      return "";
    }
  })();

  app.use("/*", async (c, next) => {
    const host = (c.req.header("host") || "").toLowerCase();
    const isXposed = !!xposedHost && host === xposedHost;
    const root = isXposed ? "./dist/xposed" : "./dist/public";
    const handler = serveStatic({
      root,
      rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
    });
    return handler(c, next);
  });
  app.get("/*", async (c, next) => {
    const host = (c.req.header("host") || "").toLowerCase();
    const isXposed = !!xposedHost && host === xposedHost;
    const root = isXposed ? "./dist/xposed" : "./dist/public";
    const handler = serveStatic({ root, path: "index.html" });
    return handler(c, next);
  });

  return app;
}
