import cron from "node-cron";
import type { Bot } from "grammy";
import type { AppDb, DbUser, DbPayment } from "../db/index.js";
import * as xui from "../services/xui/index.js";

const CRON_EXPR = process.env.REMINDER_CRON || "0 9 * * *";
const EXPIRY_REMINDER_DAYS = Number(process.env.EXPIRY_REMINDER_DAYS || 1);
const TOPUP_REMINDER_DAYS = Number(process.env.TOPUP_REMINDER_DAYS || 30);

// Track reminders sent today to avoid duplicates
const reminded = new Map<string, string>();

export function startScheduler(db: AppDb, bot: Bot) {
  console.log(`[scheduler] Cron: ${CRON_EXPR}, expiry reminder at ${EXPIRY_REMINDER_DAYS}d`);

  cron.schedule(CRON_EXPR, async () => {
    console.log("[scheduler] Running daily tasks...");
    const today = new Date().toISOString().split("T")[0];

    // Expire stale pending payments
    const expired = db.expireOldPending.run();
    if (expired.changes > 0) {
      console.log(`[scheduler] Expired ${expired.changes} stale pending payments`);
    }

    const linkedUsers = db.getAllLinkedUsers.all() as DbUser[];
    const adminSummary: { username: string; count: number }[] = [];

    for (const user of linkedUsers) {
      try {
        const lines = await xui.getUserLines(user.xui_user_id!);
        if (!lines) continue;

        // Group expiring lines by days left
        const expiring: { line: xui.XuiLine; daysLeft: number }[] = [];
        for (const line of lines) {
          if (!line.exp_date || !xui.isLineEnabled(line)) continue;
          const daysLeft = xui.daysUntilExpiry(line.exp_date);
          if (daysLeft === null) continue;
          if (daysLeft !== EXPIRY_REMINDER_DAYS) continue;
          const key = `${user.telegram_id}:${line.id}`;
          if (reminded.get(key) === today) continue;
          expiring.push({ line, daysLeft });
        }

        if (expiring.length === 0) continue;

        // Build grouped message
        const lineList = expiring
          .map((e) => `• \`${e.line.username}\``)
          .join("\n");

        const expDate = xui.formatExpiry(expiring[0].line.exp_date);
        const header = expiring.length === 1
          ? `⚠️ *Subscription expiring tomorrow (${expDate})*`
          : `⚠️ *${expiring.length} subscriptions expiring tomorrow (${expDate})*`;

        await bot.api.sendMessage(
          user.telegram_id,
          `${header}\n\n${lineList}\n\nUse /start to open the dashboard and extend.`,
          { parse_mode: "Markdown" }
        );

        // Mark all as reminded
        for (const e of expiring) {
          reminded.set(`${user.telegram_id}:${e.line.id}`, today);
        }
        adminSummary.push({ username: user.username || user.first_name || String(user.telegram_id), count: expiring.length });
        console.log(
          `[scheduler] Reminded ${user.telegram_id} about ${expiring.length} expiring line(s)`
        );
      } catch (err) {
        console.error(
          `[scheduler] Error checking user ${user.xui_user_id}:`,
          err
        );
      }
    }

    // Admin summary of expiring lines
    const adminChatId = process.env.XEROCOOL_ADMIN_CHAT_ID;
    if (adminChatId && adminSummary.length > 0) {
      const totalLines = adminSummary.reduce((sum, r) => sum + r.count, 0);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + EXPIRY_REMINDER_DAYS);
      const tomorrowStr = tomorrow.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const list = adminSummary
        .sort((a, b) => b.count - a.count)
        .map((r) => `• ${r.username} — ${r.count} line${r.count !== 1 ? "s" : ""}`)
        .join("\n");
      try {
        await bot.api.sendMessage(adminChatId,
          `📊 *${totalLines} line${totalLines !== 1 ? "s" : ""} expiring tomorrow (${tomorrowStr})*\n\n${list}`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("[scheduler] Failed to send admin summary:", err);
      }
    }

    // Credit top-up reminders
    if (TOPUP_REMINDER_DAYS > 0) {
      for (const user of linkedUsers) {
        const key = `topup:${user.telegram_id}`;
        if (reminded.get(key) === today) continue;

        try {
          const lastPayment = db.getLastSettledPayment.get(user.telegram_id) as DbPayment | undefined;
          if (!lastPayment?.created_at) continue;

          const lastDate = new Date(lastPayment.created_at.replace(" ", "T") + "Z").getTime();
          if (isNaN(lastDate)) continue;

          const daysSince = Math.floor((Date.now() - lastDate) / 86400000);

          if (daysSince >= TOPUP_REMINDER_DAYS) {
            await bot.api.sendMessage(
              user.telegram_id,
              `💰 It's been ${daysSince} days since your last credit top-up.\n\nUse /start to open the dashboard and buy more credits.`,
              { parse_mode: "Markdown" }
            );
            reminded.set(key, today);
            console.log(`[scheduler] Top-up reminder sent to ${user.telegram_id} (${daysSince}d since last payment)`);
          }
        } catch (err) {
          console.error(`[scheduler] Top-up reminder error for ${user.telegram_id}:`, err);
        }
      }
    }
  });
}
