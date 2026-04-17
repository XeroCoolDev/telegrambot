import type { Bot } from "grammy";
import type { AppDb, DbUser } from "../db/index.js";

const XEROCOOL_ADMIN_CHAT_ID = process.env.XEROCOOL_ADMIN_CHAT_ID || "";

function getUserLink(db: AppDb, telegramId: number): string {
  const user = db.getUser.get(telegramId) as DbUser | undefined;
  const label = user?.username
    ? `@${user.username}`
    : user?.first_name
    ? user.first_name
    : `User ${telegramId}`;
  const target = resellerGroupUrl(user?.reseller_group_chat_id) ?? `tg://user?id=${telegramId}`;
  return `[${label}](${target})`;
}

/** Build a private-supergroup deep link from a chat id like -1001234567890.
 * Strips the -100 prefix and anchors on message id 1 (the universally-present
 * "chat created" system message), which effectively opens the chat. */
function resellerGroupUrl(chatId: number | null | undefined): string | null {
  if (!chatId) return null;
  const stripped = String(chatId).replace(/^-100/, "");
  if (!stripped || stripped === String(chatId)) return null;
  return `https://t.me/c/${stripped}/1`;
}

/** Admin-chat notification when a payment settles. User-side receipt is
 * handled inline by upsertInvoiceMessage editing the original invoice msg. */
export async function notifyAdminPaymentSettled(
  bot: Bot,
  db: AppDb,
  payment: { telegram_id: number; amount: string; currency: string; credits: number },
  invoiceId: string,
  manual = false
) {
  if (!XEROCOOL_ADMIN_CHAT_ID) return;
  const userLink = getUserLink(db, payment.telegram_id);
  try {
    await bot.api.sendMessage(
      XEROCOOL_ADMIN_CHAT_ID,
      `💰 Payment ${manual ? "settled (manual)" : "received"}\nUser: ${userLink}\nAmount: ${payment.amount} ${payment.currency}\nCredits: ${payment.credits}\nInvoice: \`${invoiceId}\``,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[notify] Failed to message admin chat:", err);
  }
}
