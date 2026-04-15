import type { Bot } from "grammy";
import type { AppDb, DbUser } from "../db/index.js";

const XEROCOOL_ADMIN_CHAT_ID = process.env.XEROCOOL_ADMIN_CHAT_ID || "";

function getUserLink(db: AppDb, telegramId: number): string {
  const user = db.getUser.get(telegramId) as DbUser | undefined;
  if (user?.username) return `[@${user.username}](tg://user?id=${telegramId})`;
  if (user?.first_name) return `[${user.first_name}](tg://user?id=${telegramId})`;
  return `[User ${telegramId}](tg://user?id=${telegramId})`;
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
