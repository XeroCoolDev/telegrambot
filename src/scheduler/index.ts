import cron from "node-cron";
import type { Bot } from "grammy";
import type { AppDb } from "../db/index.js";
import { runDailyTasks } from "./daily.js";

/** Node-only: drive the daily job with node-cron. The Worker uses a Cron Trigger instead. */
export function startScheduler(db: AppDb, bot: Bot) {
  const cronExpr = process.env.REMINDER_CRON || "0 9 * * *";
  console.log(`[scheduler] Cron: ${cronExpr}`);
  cron.schedule(cronExpr, () => {
    runDailyTasks(db, bot).catch((err) => console.error("[scheduler] Daily tasks failed:", err));
  });
}
