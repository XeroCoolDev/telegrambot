import { Bot, InlineKeyboard } from "grammy";
import type { AppDb, DbUser, DbPayment } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import { isRateLimited } from "../services/rate-limit.js";
import { notifyAdminPaymentSettled } from "../services/notifications.js";
import { upsertInvoiceMessage } from "../services/invoice-message.js";

export function createXerocoolBot(db: AppDb) {
  const bot = new Bot(process.env.XEROCOOL_BOT_TOKEN!);
  const WEBAPP_URL = process.env.XEROCOOL_WEBAPP_URL!;
  const ADMIN_IDS = new Set(
    (process.env.XEROCOOL_ADMIN_TELEGRAM_IDS || "").split(",").map((s) => Number(s.trim())).filter(Boolean)
  );

  function isAdmin(userId: number): boolean {
    return ADMIN_IDS.has(userId);
  }

  // Default menu button (bot-level): Dashboard web-app button. This also makes
  // the "Open" button appear in the Telegram chat-list preview for the bot.
  // Per-chat override flips it back to commands for unlinked users on /start.
  if (WEBAPP_URL) {
    bot.api
      .setChatMenuButton({
        menu_button: { type: "web_app", text: "Dashboard", web_app: { url: WEBAPP_URL } },
      })
      .catch((err) => console.error("[xerocool-bot] setChatMenuButton default failed:", err));
  }

  async function setDashboardButton(chatId: number, enabled: boolean) {
    if (!WEBAPP_URL) return;
    try {
      if (enabled) {
        await bot.api.setChatMenuButton({
          chat_id: chatId,
          menu_button: { type: "web_app", text: "Dashboard", web_app: { url: WEBAPP_URL } },
        });
      } else {
        // Unlinked: override per-chat back to commands so the Dashboard
        // button doesn't show until they're linked.
        await bot.api.setChatMenuButton({
          chat_id: chatId,
          menu_button: { type: "commands" },
        });
      }
    } catch (err) {
      console.error("[xerocool-bot] setChatMenuButton chat failed:", err);
    }
  }

  // Rate limit all incoming messages
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId && isRateLimited(`bot:${userId}`)) {
      return; // silently drop
    }
    await next();
  });

  // ── /start ──────────────────────────────────────────
  bot.command("start", async (ctx) => {
    const tgUser = ctx.from!;
    const payload = ctx.match?.trim();

    // Upsert user (xui_user_id stays null until admin links it)
    db.upsertUser.run(tgUser.id, tgUser.username || null, tgUser.first_name);

    const user = db.getUser.get(tgUser.id) as DbUser | undefined;

    if (!user?.xui_user_id) {
      await setDashboardButton(tgUser.id, false);
      await ctx.reply(
        `Your Telegram User ID is: \`${tgUser.id}\`\n\n` +
          `Please provide this ID to an administrator to register your account.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // `payload` currently unused but kept for future deep-link flows
    void payload;
    await setDashboardButton(tgUser.id, true);

    await ctx.reply(
      `Welcome back${tgUser.first_name ? `, ${tgUser.first_name}` : ""}! 👋\n\n` +
        `Tap the Dashboard button below to manage your subscriptions and credits.`
    );
  });

  // ── /credits ────────────────────────────────────────
  bot.command("credits", async (ctx) => {
    const user = db.getUser.get(ctx.from!.id) as DbUser | undefined;
    if (!user?.xui_user_id) {
      return ctx.reply("Your account isn't linked yet. Please contact an administrator.");
    }

    try {
      const xuiUser = await xui.getUser(user.xui_user_id);
      if (!xuiUser) throw new Error("XUI fetch failed");

      const keyboard = new InlineKeyboard().webApp("💰 Buy Credits", `${WEBAPP_URL}/buy`);
      await ctx.reply(`💰 Your balance: *${xuiUser.credits}* credits`, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } catch {
      await ctx.reply("Couldn't fetch your balance right now. Try again shortly.");
    }
  });

  // ── /status ─────────────────────────────────────────
  bot.command("status", async (ctx) => {
    const user = db.getUser.get(ctx.from!.id) as DbUser | undefined;
    if (!user?.xui_user_id) {
      return ctx.reply("Your account isn't linked yet. Please contact an administrator.");
    }

    await ctx.reply("Tap below to see your active subscriptions:", {
      reply_markup: new InlineKeyboard().webApp("📊 View Subscriptions", WEBAPP_URL),
    });
  });

  // ── /link (admin only — link a telegram user to xui.one) ──
  bot.command("link", async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    if (args.length !== 2) {
      return ctx.reply("Usage: /link <telegram_id> <xui_user_id>");
    }

    const [telegramId, xuiUserId] = args;
    const targetUser = db.getUser.get(Number(telegramId)) as DbUser | undefined;
    if (!targetUser) {
      return ctx.reply(`No user found with Telegram ID ${telegramId}. They need to /start first.`);
    }

    // Verify the XUI user exists
    const xuiUser = await xui.getUser(xuiUserId);
    if (!xuiUser) {
      return ctx.reply(`XUI user ID ${xuiUserId} not found.`);
    }

    db.linkXui.run(xuiUserId, xuiUser.api_key, Number(telegramId));
    await ctx.reply(
      `✅ Linked Telegram user ${telegramId} → XUI user ${xuiUser.username} (ID: ${xuiUserId})`
    );
  });

  // ── /settle (admin only — manually settle a pending payment) ──
  bot.command("settle", async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    if (args.length !== 1) {
      return ctx.reply("Usage: /settle <btcpay_invoice_id>");
    }

    const invoiceId = args[0];
    const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
    if (!payment) {
      return ctx.reply(`Invoice \`${invoiceId}\` not found.`, { parse_mode: "Markdown" });
    }
    if (payment.status === "settled") {
      return ctx.reply(`Invoice \`${invoiceId}\` is already settled.`, { parse_mode: "Markdown" });
    }

    const success = await xui.adjustCredits(
      payment.xui_user_id,
      payment.credits,
      `Manual settle: BTCPay invoice ${invoiceId}`
    );

    db.updatePaymentStatus.run(success ? "settled" : "failed", invoiceId);

    const fresh = db.getPayment.get(invoiceId) as DbPayment | undefined;
    if (success) {
      if (fresh) await upsertInvoiceMessage(bot, db, fresh, { status: "settled", settledAt: new Date() });
      await notifyAdminPaymentSettled(bot, db, payment, invoiceId, true);
      await ctx.reply(`✅ Invoice \`${invoiceId}\` settled. ${payment.credits} credits added to user ${payment.xui_user_id}.`, { parse_mode: "Markdown" });
    } else {
      if (fresh) await upsertInvoiceMessage(bot, db, fresh, { status: "failed" });
      await ctx.reply(`❌ Failed to add credits for invoice \`${invoiceId}\`.`, { parse_mode: "Markdown" });
    }
  });

  // ── /chatid (admin only — get current chat ID) ──
  bot.command("chatid", async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await ctx.reply(`Chat ID: \`${ctx.chat.id}\``, { parse_mode: "Markdown" });
  });

  bot.catch((err) => {
    console.error("[bot] Error:", err.message);
  });

  return bot;
}
