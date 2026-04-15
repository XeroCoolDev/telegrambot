import { serve } from "@hono/node-server";
import { createBot } from "./bot/index.js";
import { createCustomerBot } from "./bot/customer.js";
import { createApp } from "./api/index.js";
import { startScheduler } from "./scheduler/index.js";
import { initDb } from "./db/index.js";

const PORT = Number(process.env.PORT || 3000);

async function main() {
  const db = initDb(process.env.DATABASE_PATH || "./data/bot.db");
  console.log("[db] Initialised");

  const bot = createBot(db);
  bot.start({
    allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member"],
    onStart: () => console.log("[bot] Reseller bot running (polling)"),
  });

  let customerBot: ReturnType<typeof createCustomerBot> | undefined;
  if (process.env.CUSTOMER_BOT_TOKEN) {
    customerBot = createCustomerBot(db);
    customerBot.start({
      allowed_updates: ["message", "callback_query", "my_chat_member", "message_reaction"],
      onStart: () => console.log("[bot] Customer bot running (polling)"),
    });
  }

  const app = createApp(db, bot, customerBot);
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[api] Listening on :${PORT}`);
  });

  startScheduler(db, bot);

  const shutdown = () => {
    console.log("[app] Shutting down...");
    bot.stop();
    customerBot?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[app] Fatal:", err);
  process.exit(1);
});
