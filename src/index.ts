import { serve } from "@hono/node-server";
import { createXerocoolBot } from "./bot/xerocool.js";
import { createXposedBot } from "./bot/xposed.js";
import { createApp } from "./api/index.js";
import { startScheduler } from "./scheduler/index.js";
import { initDb } from "./db/index.js";

const PORT = Number(process.env.PORT || 3000);

async function main() {
  const db = initDb(process.env.DATABASE_PATH || "./data/bot.db");
  console.log("[db] Initialised");


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
