import { serve } from "@hono/node-server";
import { createXerocoolBot } from "./bot/xerocool.js";
import { createXposedBot } from "./bot/xposed.js";
import { createApp } from "./api/index.js";
import { startScheduler } from "./scheduler/index.js";
import { initDb } from "./db/index.js";
import * as xui from "./services/xui/index.js";

const PORT = Number(process.env.PORT || 3000);

async function main() {
  const db = initDb(process.env.DATABASE_PATH || "./data/bot.db");
  console.log("[db] Initialised");

  // Backfill missing xui_api_key for already-linked users (one-off after
  // admin-linking, since the key may not have been captured at link time).
  try {
    const missing = db.db
      .prepare(
        "SELECT telegram_id, xui_user_id FROM users WHERE xui_user_id IS NOT NULL AND (xui_api_key IS NULL OR xui_api_key = '')"
      )
      .all() as { telegram_id: number; xui_user_id: string }[];
    for (const u of missing) {
      const xuiUser = await xui.getUser(u.xui_user_id);
      if (xuiUser?.api_key) {
        db.linkXui.run(u.xui_user_id, xuiUser.api_key, u.telegram_id);
        console.log(`[db] Backfilled api_key for telegram_id ${u.telegram_id}`);
      }
    }
  } catch (err) {
    console.error("[db] api_key backfill failed:", err);
  }

  const xerocoolBot = createXerocoolBot(db);
  xerocoolBot.start({
    allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member"],
    onStart: () => console.log("[bot] XeroCool bot running (polling)"),
  });

  let xposedBot: ReturnType<typeof createXposedBot> | undefined;
  if (process.env.XPOSED_BOT_TOKEN) {
    xposedBot = createXposedBot(db);
    xposedBot.start({
      allowed_updates: ["message", "callback_query", "my_chat_member", "message_reaction"],
      onStart: () => console.log("[bot] Xposed bot running (polling)"),
    });
  }

  const app = createApp(db, xerocoolBot, xposedBot);
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[api] Listening on :${PORT}`);
  });

  startScheduler(db, xerocoolBot);

  const shutdown = () => {
    console.log("[app] Shutting down...");
    xerocoolBot.stop();
    xposedBot?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[app] Fatal:", err);
  process.exit(1);
});
