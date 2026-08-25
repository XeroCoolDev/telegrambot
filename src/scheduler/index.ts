import cron from "node-cron";
import type { Bot } from "grammy";
import type { AppDb, DbUser, DbPayment } from "../db/index.js";
import * as xui from "../services/xui/index.js";

const CRON_EXPR = process.env.REMINDER_CRON || "0 9 * * *";
const REMINDER_DAYS: number[] = (process.env.REMINDER_DAYS || "0,1,3")
  .split(",")
  .map(Number)
  .filter((n) => Number.isFinite(n) && n >= 0);
const TOPUP_REMINDER_DAYS = Number(process.env.TOPUP_REMINDER_DAYS || 30);

function dayLabel(daysLeft: number): string {
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return `in ${daysLeft} days`;
}

function escapeMd(text: string): string {
  return text.replace(/[_*`[]/g, "\\$&");
}

/** Longest note preview shown beside a username in a reminder. */
const NOTE_PREVIEW_MAX = 40;

/**
 * Wrap text so Telegram renders it as inline code, which taps to copy.
 *
 * Markdown specials are already literal inside a code span, so escapeMd must
 * NOT be used here — its backslashes would show up in the message. The one
 * character that matters is the backtick, which would close the span early
 * and corrupt the rest of the message.
 */
function codeSpan(text: string): string {
  return `\`${String(text).replace(/`/g, "'")}\``;
}

/**
 * Opening line of a reseller's note, capped — notes run to many lines and a
 * reminder listing a dozen expiring lines has to stay scannable.
 *
 * Uses the first non-empty line rather than literally the first, so a note
 * that starts with a blank line still previews instead of vanishing. Reports
 * truncation separately so the caller can put the ellipsis outside the
 * tap-to-copy span — copying should yield the note text, not a stray "…".
 */
function notePreview(notes: string | null | undefined): { text: string; truncated: boolean } {
  if (!notes) return { text: "", truncated: false };
  const lines = String(notes)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { text: "", truncated: false };

  const first = lines[0];
  if (first.length > NOTE_PREVIEW_MAX) {
    return { text: first.slice(0, NOTE_PREVIEW_MAX).trimEnd(), truncated: true };
  }
  return { text: first, truncated: lines.length > 1 };
}

/**
 * One bullet: username and note preview as separate tap-to-copy spans, so
 * either can be lifted out of the message on its own.
 */
function lineBullet(line: xui.XuiLine): string {
  const bullet = `• ${codeSpan(line.username)}`;
  const note = notePreview(line.reseller_notes);
  if (!note.text) return bullet;
  return `${bullet} — ${codeSpan(note.text)}${note.truncated ? "…" : ""}`;
}

function sectionHeading(daysLeft: number, expDate: string | number | null): string {
  if (daysLeft === 0) return "*Today*";
  if (daysLeft === 1) return "*Tomorrow*";
  return `*In ${daysLeft} days (${xui.formatExpiry(expDate)})*`;
}

// Track reminders sent today to avoid duplicates
const reminded = new Map<string, string>();

export function startScheduler(db: AppDb, bot: Bot) {
  console.log(`[scheduler] Cron: ${CRON_EXPR}, reminder days: [${REMINDER_DAYS.join(", ")}]`);

  cron.schedule(CRON_EXPR, async () => {
    console.log("[scheduler] Running daily tasks...");
    const today = new Date().toISOString().split("T")[0];

    // Expire stale pending payments
    const expired = db.expireOldPending.run();
    if (expired.changes > 0) {
      console.log(`[scheduler] Expired ${expired.changes} stale pending payments`);
    }

    // Prune terminal payments older than 90 days (keeps settled rows forever
    // for audit; only removes expired/invalid/failed clutter)
    const pruned = db.pruneTerminalPayments.run();
    if (pruned.changes > 0) {
      console.log(`[scheduler] Pruned ${pruned.changes} old terminal payments`);
    }

    const linkedUsers = db.getAllLinkedUsers.all() as DbUser[];
    const adminSummary: { username: string; count: number }[] = [];

    for (const user of linkedUsers) {
      try {
        const lines = await xui.getUserLines(user.xui_user_id!);
        if (!lines) continue;

        // Bucket lines by daysLeft, preserving REMINDER_DAYS order
        const buckets = new Map<number, xui.XuiLine[]>();
        for (const line of lines) {
          if (!line.exp_date || !xui.isLineEnabled(line)) continue;
          const daysLeft = xui.daysUntilExpiry(line.exp_date);
          if (daysLeft === null || !REMINDER_DAYS.includes(daysLeft)) continue;
          const key = `${user.telegram_id}:${line.id}`;
          if (reminded.get(key) === today) continue;
          const bucket = buckets.get(daysLeft) ?? [];
          bucket.push(line);
          buckets.set(daysLeft, bucket);
        }

        if (buckets.size === 0) continue;

        // Build one message — single section if only one day bucket, headed sections otherwise
        const activeDays = REMINDER_DAYS.filter((d) => buckets.has(d));
        const totalLines = activeDays.reduce((sum, d) => sum + buckets.get(d)!.length, 0);

        let body: string;
        if (activeDays.length === 1) {
          const daysLeft = activeDays[0];
          const bucket = buckets.get(daysLeft)!;
          const header = bucket.length === 1
            ? `⚠️ *Subscription expiring ${dayLabel(daysLeft)}*`
            : `⚠️ *${bucket.length} subscriptions expiring ${dayLabel(daysLeft)}*`;
          const lineList = bucket.map(lineBullet).join("\n");
          body = `${header}\n\n${lineList}`;
        } else {
          const sections = activeDays
            .map((daysLeft) => {
              const bucket = buckets.get(daysLeft)!;
              const lineList = bucket.map(lineBullet).join("\n");
              return `${sectionHeading(daysLeft, bucket[0].exp_date)}\n${lineList}`;
            })
            .join("\n\n");
          body = `⚠️ *${totalLines} subscription${totalLines !== 1 ? "s" : ""} expiring soon*\n\n${sections}`;
        }

        await bot.api.sendMessage(
          user.telegram_id,
          `${body}\n\nUse /start to open the dashboard and extend.`,
          { parse_mode: "Markdown" }
        );

        // Mark all as reminded
        for (const [, bucket] of buckets) {
          for (const line of bucket) {
            reminded.set(`${user.telegram_id}:${line.id}`, today);
          }
        }

        adminSummary.push({ username: user.username || user.first_name || String(user.telegram_id), count: totalLines });
        console.log(`[scheduler] Reminded ${user.telegram_id} about ${totalLines} expiring line(s)`);
      } catch (err) {
        console.error(`[scheduler] Error checking user ${user.xui_user_id}:`, err);
      }
    }

    // Admin summary
    const adminChatId = process.env.XEROCOOL_ADMIN_CHAT_ID;
    if (adminChatId && adminSummary.length > 0) {
      const total = adminSummary.reduce((sum, r) => sum + r.count, 0);
      const windowDesc = REMINDER_DAYS.map((d) => dayLabel(d)).join(", ");
      const list = adminSummary
        .sort((a, b) => b.count - a.count)
        .map((r) => `• ${escapeMd(r.username)} — ${r.count} line${r.count !== 1 ? "s" : ""}`)
        .join("\n");
      try {
        await bot.api.sendMessage(adminChatId,
          `📊 *${total} line${total !== 1 ? "s" : ""} expiring (${windowDesc})*\n\n${list}`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("[scheduler] Failed to send admin summary:", err);
      }
    }

    // Credit top-up reminders
    const topupSummary: { username: string; daysSince: number }[] = [];
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
            topupSummary.push({ username: user.username || user.first_name || String(user.telegram_id), daysSince });
            console.log(`[scheduler] Top-up reminder sent to ${user.telegram_id} (${daysSince}d since last payment)`);
          }
        } catch (err) {
          console.error(`[scheduler] Top-up reminder error for ${user.telegram_id}:`, err);
        }
      }
    }

    if (adminChatId && topupSummary.length > 0) {
      const list = topupSummary
        .sort((a, b) => b.daysSince - a.daysSince)
        .map((r) => `• ${escapeMd(r.username)} — ${r.daysSince} days`)
        .join("\n");
      try {
        await bot.api.sendMessage(adminChatId,
          `💰 *${topupSummary.length} user${topupSummary.length !== 1 ? "s" : ""} overdue for a credit top-up*\n\n${list}`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("[scheduler] Failed to send top-up admin summary:", err);
      }
    }
  });
}
