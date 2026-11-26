import type { Bot } from "grammy";
import type { AppDb, DbUser, DbPayment } from "../db/index.js";
import * as xui from "../services/xui/index.js";

/**
 * The once-a-day job: expire stale invoices, prune old terminal ones, send
 * expiry and top-up reminders. Runtime-neutral — `index.ts` drives it with
 * node-cron, `src/worker.ts` from a Cloudflare Cron Trigger. Config is read
 * per run so a Worker isolate that was created before its env was populated
 * still sees the right values.
 */

function reminderDays(): number[] {
  return (process.env.REMINDER_DAYS || "0,1,3")
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
}

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

/**
 * How many Telegram messages one run may send. Cloudflare's free plan allows
 * 50 outbound requests per invocation; the panel fetch takes a few of them and
 * the admin summary one, so 40 leaves headroom. Raise it on the paid plan
 * (1000 per invocation) or on Node, where there is no cap at all.
 */
function messageBudget(): number {
  return Number(process.env.DAILY_MESSAGE_BUDGET || 40);
}

/** Expiry section of a reseller's reminder, or null if nothing is in a window. */
function expirySection(
  lines: xui.XuiLine[],
  REMINDER_DAYS: number[]
): { text: string; count: number } | null {
  // Bucket lines by daysLeft, preserving REMINDER_DAYS order
  const buckets = new Map<number, xui.XuiLine[]>();
  for (const line of lines) {
    if (!line.exp_date || !xui.isLineEnabled(line)) continue;
    const daysLeft = xui.daysUntilExpiry(line.exp_date);
    if (daysLeft === null || !REMINDER_DAYS.includes(daysLeft)) continue;
    const bucket = buckets.get(daysLeft) ?? [];
    bucket.push(line);
    buckets.set(daysLeft, bucket);
  }
  if (buckets.size === 0) return null;

  // Single section if only one day bucket, headed sections otherwise
  const activeDays = REMINDER_DAYS.filter((d) => buckets.has(d));
  const count = activeDays.reduce((sum, d) => sum + buckets.get(d)!.length, 0);

  if (activeDays.length === 1) {
    const daysLeft = activeDays[0];
    const bucket = buckets.get(daysLeft)!;
    const header = bucket.length === 1
      ? `⚠️ *Subscription expiring ${dayLabel(daysLeft)}*`
      : `⚠️ *${bucket.length} subscriptions expiring ${dayLabel(daysLeft)}*`;
    return { text: `${header}\n\n${bucket.map(lineBullet).join("\n")}`, count };
  }

  const sections = activeDays
    .map((daysLeft) => {
      const bucket = buckets.get(daysLeft)!;
      return `${sectionHeading(daysLeft, bucket[0].exp_date)}\n${bucket.map(lineBullet).join("\n")}`;
    })
    .join("\n\n");
  return {
    text: `⚠️ *${count} subscription${count !== 1 ? "s" : ""} expiring soon*\n\n${sections}`,
    count,
  };
}

/** Days since the reseller's last settled top-up, if it is overdue; else null. */
async function overdueTopUpDays(db: AppDb, user: DbUser, threshold: number): Promise<number | null> {
  if (threshold <= 0) return null;
  const lastPayment = await db.getLastSettledPayment.get<DbPayment>(user.telegram_id);
  if (!lastPayment?.created_at) return null;
  const lastDate = new Date(lastPayment.created_at.replace(" ", "T") + "Z").getTime();
  if (isNaN(lastDate)) return null;
  const daysSince = Math.floor((Date.now() - lastDate) / 86400000);
  return daysSince >= threshold ? daysSince : null;
}

/**
 * Run the daily tasks once. Intended to be triggered once per day; a second
 * run on the same day would repeat that day's reminders. (The Node build used
 * to keep an in-memory "already reminded today" map; it never survived a
 * restart and cannot exist in a Worker, so it was dropped rather than faked.)
 *
 * Outbound calls are what the Worker runtime meters, so the job is shaped
 * around them: two panel calls for every expiring line on the panel (not one
 * per reseller), one Telegram message per reseller carrying both the expiry
 * and the top-up reminder, and one admin summary. If the message budget runs
 * out the remaining resellers are skipped and the admin summary says so.
 */
export async function runDailyTasks(db: AppDb, bot: Bot): Promise<void> {
  const REMINDER_DAYS = reminderDays();
  const TOPUP_REMINDER_DAYS = Number(process.env.TOPUP_REMINDER_DAYS || 30);
  let budget = messageBudget();
  console.log(`[scheduler] Running daily tasks (reminder days: [${REMINDER_DAYS.join(", ")}], message budget ${budget})`);

  // Expire stale pending payments
  const expired = await db.expireOldPending.run();
  if (expired.changes > 0) {
    console.log(`[scheduler] Expired ${expired.changes} stale pending payments`);
  }

  // Prune terminal payments older than 90 days (keeps settled rows forever
  // for audit; only removes expired/invalid/failed clutter)
  const pruned = await db.pruneTerminalPayments.run();
  if (pruned.changes > 0) {
    console.log(`[scheduler] Pruned ${pruned.changes} old terminal payments`);
  }

  const linkedUsers = await db.getAllLinkedUsers.all<DbUser>();
  const userByMember = new Map<string, DbUser>();
  for (const u of linkedUsers) {
    if (u.xui_user_id) userByMember.set(String(u.xui_user_id), u);
  }

  // One panel-wide fetch, then group by owner. Null = panel unreachable: the
  // top-up reminders still go out and the admin is told expiry ones did not.
  const expiringLines = await xui.getExpiringLines();
  const linesByTelegramId = new Map<number, xui.XuiLine[]>();
  for (const line of expiringLines ?? []) {
    const owner = userByMember.get(String(line.member_id));
    if (!owner) continue;
    const list = linesByTelegramId.get(owner.telegram_id) ?? [];
    list.push(line);
    linesByTelegramId.set(owner.telegram_id, list);
  }

  const adminExpiry: { username: string; count: number }[] = [];
  const adminTopUp: { username: string; daysSince: number }[] = [];
  let skipped = 0;

  for (const user of linkedUsers) {
    try {
      const expiry = expiringLines ? expirySection(linesByTelegramId.get(user.telegram_id) ?? [], REMINDER_DAYS) : null;
      const topUpDays = await overdueTopUpDays(db, user, TOPUP_REMINDER_DAYS);
      if (!expiry && topUpDays === null) continue;

      if (budget <= 0) {
        skipped++;
        continue;
      }

      const parts: string[] = [];
      if (expiry) parts.push(expiry.text);
      if (topUpDays !== null) {
        parts.push(`💰 It's been ${topUpDays} days since your last credit top-up.`);
      }
      const action = expiry && topUpDays !== null
        ? "Use /start to open the dashboard to extend lines or buy credits."
        : expiry
          ? "Use /start to open the dashboard and extend."
          : "Use /start to open the dashboard and buy more credits.";

      budget--;
      await bot.api.sendMessage(user.telegram_id, `${parts.join("\n\n")}\n\n${action}`, {
        parse_mode: "Markdown",
      });

      const label = user.username || user.first_name || String(user.telegram_id);
      if (expiry) {
        adminExpiry.push({ username: label, count: expiry.count });
        console.log(`[scheduler] Reminded ${user.telegram_id} about ${expiry.count} expiring line(s)`);
      }
      if (topUpDays !== null) {
        adminTopUp.push({ username: label, daysSince: topUpDays });
        console.log(`[scheduler] Top-up reminder sent to ${user.telegram_id} (${topUpDays}d since last payment)`);
      }
    } catch (err) {
      console.error(`[scheduler] Error reminding user ${user.telegram_id}:`, err);
    }
  }

  // One admin message with everything the run did and anything it could not
  const adminChatId = process.env.XEROCOOL_ADMIN_CHAT_ID;
  if (!adminChatId) return;

  const sections: string[] = [];
  if (!expiringLines) {
    sections.push("❌ *Panel unreachable — no expiry reminders were sent today.*");
  }
  if (adminExpiry.length > 0) {
    const total = adminExpiry.reduce((sum, r) => sum + r.count, 0);
    const windowDesc = REMINDER_DAYS.map((d) => dayLabel(d)).join(", ");
    const list = adminExpiry
      .sort((a, b) => b.count - a.count)
      .map((r) => `• ${escapeMd(r.username)} — ${r.count} line${r.count !== 1 ? "s" : ""}`)
      .join("\n");
    sections.push(`📊 *${total} line${total !== 1 ? "s" : ""} expiring (${windowDesc})*\n\n${list}`);
  }
  if (adminTopUp.length > 0) {
    const list = adminTopUp
      .sort((a, b) => b.daysSince - a.daysSince)
      .map((r) => `• ${escapeMd(r.username)} — ${r.daysSince} days`)
      .join("\n");
    sections.push(`💰 *${adminTopUp.length} user${adminTopUp.length !== 1 ? "s" : ""} overdue for a credit top-up*\n\n${list}`);
  }
  if (skipped > 0) {
    sections.push(
      `⚠️ *${skipped} reseller${skipped !== 1 ? "s" : ""} not reminded* — the run hit its message budget (DAILY_MESSAGE_BUDGET=${messageBudget()}). Raise it or move to a plan with a higher request limit.`
    );
  }
  if (sections.length === 0) return;

  try {
    await bot.api.sendMessage(adminChatId, sections.join("\n\n"), { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[scheduler] Failed to send admin summary:", err);
  }
}
