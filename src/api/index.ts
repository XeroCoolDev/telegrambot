import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import type { Bot } from "grammy";
import type { AppDb } from "../db/index.js";
import { resellerAuthMiddleware, type AuthEnv } from "./auth.js";
import { registerMeRoutes } from "./me.js";
import { registerLineRoutes } from "./lines.js";
import { registerCreditRoutes, registerBtcpayWebhook } from "./credits.js";
import { registerAdminRoutes } from "./admin.js";
import { registerResellerCustomerRoutes, createCustomerApi } from "./customer.js";

export function createApp(db: AppDb, bot: Bot, customerBot?: Bot) {
  const app = new Hono();

  // Reseller API (authenticated)
  const api = new Hono<AuthEnv>();
  api.use("/*", resellerAuthMiddleware(db));
  registerMeRoutes(api);
  registerLineRoutes(api, db);
  registerCreditRoutes(api, db);
  registerAdminRoutes(api, db);
  registerResellerCustomerRoutes(api, db);

  // Customer API (separate auth)
  const customerApi = createCustomerApi(db, customerBot);

  // BTCPay webhook (unauthenticated)
  registerBtcpayWebhook(app, db, bot);

  // Mount
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
