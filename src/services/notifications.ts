import type { Bot } from "grammy";
import type { AppDb, DbUser } from "../db/index.js";

const XEROCOOL_ADMIN_CHAT_ID = process.env.XEROCOOL_ADMIN_CHAT_ID || "";

function getUserLink(db: AppDb, telegramId: number): string {
  const user = db.getUser.get(telegramId) as DbUser | undefined;
  if (user?.username) return `[@${user.username}](tg://user?id=${telegramId})`;
  if (user?.first_name) return `[${user.first_name}](tg://user?id=${telegramId})`;
  return `[User ${telegramId}](tg://user?id=${telegramId})`;
}

export async function notifyPaymentSettled(
  bot: Bot,
  db: AppDb,
  payment: { telegram_id: number; amount: string; currency: string; credits: number },
  invoiceId: string,
  manual = false
) {
  const userLink = getUserLink(db, payment.telegram_id);

  // Notify user
  try {
    await bot.api.sendMessage(payment.telegram_id,
      `✅ Payment confirmed! ${payment.credits} credits added to your account.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[notify] Failed to message user:", err);
  }

  // Notify admin chat
  if (XEROCOOL_ADMIN_CHAT_ID) {
    try {
      await bot.api.sendMessage(XEROCOOL_ADMIN_CHAT_ID,
        `💰 Payment ${manual ? "settled (manual)" : "received"}\nUser: ${userLink}\nAmount: ${payment.amount} ${payment.currency}\nCredits: ${payment.credits}\nInvoice: \`${invoiceId}\``,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("[notify] Failed to message admin chat:", err);
    }
  }
}
