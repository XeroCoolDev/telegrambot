/**
 * Cloudflare Workers entrypoint. Same bots, API and daily job as `index.ts`,
 * on a different substrate:
 *
 *   storage     D1 (binding BOT_DB) through db/d1.ts
 *   updates     Telegram webhooks at /telegram/<bot> instead of long polling
 *   schedule    a Cron Trigger calling `scheduled()` instead of node-cron
 *   mini-apps   the assets binding (worker/public/app-<bot>/), routed by host
 *   config      Worker vars + secrets, mirrored onto process.env on first use
 *
 * Built and deployed from ./worker (see worker/README.md). Excluded from the
 * Node tsconfig; type-checked with worker/tsconfig.json.
 */
import { webhookCallback, type Bot } from "grammy";
import type { Hono } from "hono";
import { createD1Db, type D1Like } from "./db/d1.js";
import type { AppDb } from "./db/index.js";
import { API_PREFIXES, createApp, xposedHost } from "./api/index.js";
import { createXerocoolBot } from "./bot/xerocool.js";
import { createXposedBot } from "./bot/xposed.js";
import { applyBotDefaults } from "./bot/setup.js";
import { runDailyTasks } from "./scheduler/daily.js";

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** Bindings declared in worker/wrangler.toml plus every var/secret as a string. */
export interface Env {
  BOT_DB: D1Like;
  ASSETS: AssetsBinding;
  [key: string]: unknown;
}

interface Runtime {
  db: AppDb;
  xerocoolBot: Bot;
  xposedBot?: Bot;
  app: Hono;
}

const WEBHOOK_PATHS = { xerocool: "/telegram/xerocool", xposed: "/telegram/xposed" } as const;
type AllowedUpdates = NonNullable<Parameters<Bot["api"]["setWebhook"]>[1]>["allowed_updates"];

/**
 * The shared code reads `process.env`. With the nodejs_compat flag Workers
 * populate it from vars and secrets, but only string values and only at the
 * platform's discretion; copying here makes the contract explicit and keeps
 * the handlers working even if that population is ever disabled.
 */
function syncProcessEnv(env: Env): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && process.env[key] !== value) process.env[key] = value;
  }
}

let runtime: Runtime | undefined;

function getRuntime(env: Env): Runtime {
  syncProcessEnv(env);
  if (!runtime) runtime = buildRuntime();
  return runtime;
}

function buildRuntime(): Runtime {
  const db = createD1Db(() => runtimeEnv().BOT_DB);
  const xerocoolBot = createXerocoolBot(db);
  const xposedBot = process.env.XPOSED_BOT_TOKEN ? createXposedBot(db) : undefined;
  const app = createApp(db, xerocoolBot, xposedBot);

  // Telegram pushes updates here. The secret token is set on the webhook by
  // /setup/telegram and checked by grammY on every delivery.
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
  app.post(WEBHOOK_PATHS.xerocool, webhookCallback(xerocoolBot, "hono", { secretToken }));
  if (xposedBot) {
    app.post(WEBHOOK_PATHS.xposed, webhookCallback(xposedBot, "hono", { secretToken }));
  }

  // One-time wiring after a deploy: point both bots' webhooks at this Worker
  // and apply the default menu buttons. Guarded by the SETUP_KEY secret.
  app.post("/setup/telegram", async (c) => {
    const key = process.env.SETUP_KEY;
    if (!key || c.req.header("X-Setup-Key") !== key) return c.json({ error: "Forbidden" }, 403);
    if (!secretToken) {
      return c.json({ error: "TELEGRAM_WEBHOOK_SECRET is not set — refusing to register unauthenticated webhooks" }, 400);
    }

    const results: Record<string, unknown> = {};
    const register = async (name: keyof typeof WEBHOOK_PATHS, bot: Bot, baseUrl: string | undefined, allowed: AllowedUpdates) => {
      if (!baseUrl) {
        results[name] = { error: "webapp URL not configured" };
        return;
      }
      const url = new URL(WEBHOOK_PATHS[name], baseUrl).toString();
      try {
        await bot.api.setWebhook(url, {
          secret_token: secretToken,
          allowed_updates: allowed,
          drop_pending_updates: false,
        });
        results[name] = { webhook: url };
      } catch (err) {
        results[name] = { webhook: url, error: String(err) };
      }
    };

    await register("xerocool", xerocoolBot, process.env.XEROCOOL_WEBAPP_URL, [
      "message", "callback_query", "chat_member", "my_chat_member",
    ]);
    if (xposedBot) {
      await register("xposed", xposedBot, process.env.XPOSED_WEBAPP_URL, [
        "message", "callback_query", "my_chat_member", "message_reaction",
      ]);
    }
    await applyBotDefaults(xerocoolBot, xposedBot);
    return c.json({ ok: true, results });
  });

  // Everything else is a mini-app asset, chosen by hostname like the Node
  // build does; unknown paths fall back to that app's index.html (SPA routing).
  app.get("/*", async (c) => {
    if (API_PREFIXES.some((p) => c.req.path.startsWith(p))) return c.json({ error: "Not found" }, 404);
    return serveAsset(c.req.raw, runtimeEnv().ASSETS);
  });

  return { db, xerocoolBot, xposedBot, app };
}

/** The bindings of the request being served; set by the handlers below. */
let currentEnv: Env | undefined;
function runtimeEnv(): Env {
  if (!currentEnv) throw new Error("Worker env not initialised");
  return currentEnv;
}

async function serveAsset(request: Request, assets: AssetsBinding): Promise<Response> {
  const url = new URL(request.url);
  const appDir = url.host.toLowerCase() === xposedHost() ? "app-xposed" : "app-xerocool";
  const path = url.pathname === "/" ? "/index.html" : url.pathname;

  const assetReq = (p: string) =>
    new Request(new URL(`/${appDir}${p}`, url.origin).toString(), {
      method: "GET",
      headers: request.headers,
    });

  const res = await assets.fetch(assetReq(path));
  if (res.status !== 404) return res;
  return assets.fetch(assetReq("/index.html"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    currentEnv = env;
    const rt = getRuntime(env);
    return rt.app.fetch(request, env);
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    currentEnv = env;
    const rt = getRuntime(env);
    ctx.waitUntil(
      runDailyTasks(rt.db, rt.xerocoolBot).catch((err) =>
        console.error("[scheduler] Daily tasks failed:", err)
      )
    );
  },
};
