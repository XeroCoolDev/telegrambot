import { Bot, InlineKeyboard } from "grammy";
import type { AppDb, DbCustomerLine } from "../db/index.js";
import { isRateLimited } from "../services/rate-limit.js";

const SUPPORT_CHAT_ID = process.env.SUPPORT_FORUM_CHAT_ID || "";

export function createCustomerBot(db: AppDb) {
  const bot = new Bot(process.env.CUSTOMER_BOT_TOKEN!);
  const WEBAPP_URL = process.env.CUSTOMER_WEBAPP_URL || "";

  // Map thread_id → customer_telegram_id for reply routing
  const threadToCustomer = new Map<number, number>();

  // Pre-load existing topics into memory
  try {
    const existing = db.db.prepare("SELECT customer_telegram_id, thread_id FROM support_topics").all() as { customer_telegram_id: number; thread_id: number }[];
    for (const row of existing) {
      threadToCustomer.set(row.thread_id, row.customer_telegram_id);
    }
  } catch { /* table may not exist yet on first run */ }

  // Rate limit
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId && isRateLimited(`cbot:${userId}`)) return;
    await next();
  });

  // ── /start — link via token or show dashboard ──
  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const tgUser = ctx.from!;
    const payload = ctx.match?.trim();

    db.upsertCustomer.run(tgUser.id, tgUser.username || null, tgUser.first_name);

    if (payload) {
      const tokenRow = db.getCustomerLineByToken.get(payload) as DbCustomerLine | undefined;
      if (!tokenRow) {
        await ctx.reply("This link is invalid or has expired.");
        return;
      }

      if (tokenRow.customer_telegram_id && tokenRow.customer_telegram_id !== tgUser.id) {
        await ctx.reply("This line is already linked to another account.");
        return;
      }

      if (!tokenRow.customer_telegram_id) {
        db.linkCustomerToLine.run(tgUser.id, payload);
      }

      if (WEBAPP_URL) {
        await ctx.reply(
          `Line linked successfully! Tap below to view your subscriptions.`,
          { reply_markup: new InlineKeyboard().webApp("Open Dashboard", WEBAPP_URL) }
        );
      } else {
        await ctx.reply("Line linked successfully!");
      }
      return;
    }

    const lines = db.getCustomerLines.all(tgUser.id) as DbCustomerLine[];

    if (lines.length === 0) {
      await ctx.reply(
        "Welcome! Ask your provider for a link to connect your subscription."
      );
      return;
    }

    if (WEBAPP_URL) {
      await ctx.reply(
        `Welcome back${tgUser.first_name ? `, ${tgUser.first_name}` : ""}!\n\nTap below to manage your subscriptions.\n\nTo contact support, just type your message here.`,
        { reply_markup: new InlineKeyboard().webApp("Open Dashboard", WEBAPP_URL) }
      );
    } else {
      await ctx.reply(
        `Welcome back! You have ${lines.length} linked subscription${lines.length !== 1 ? "s" : ""}.\n\nTo contact support, just type your message here.`
      );
    }
  });

  // ── Handle all messages ──
  bot.on("message", async (ctx) => {
    // Forum group reply from reseller
    if (ctx.chat.type === "supergroup" && String(ctx.chat.id) === SUPPORT_CHAT_ID) {
      const threadId = ctx.message.message_thread_id;
      if (!threadId) return;

      // Don't relay bot's own messages
      if (ctx.from?.id === bot.botInfo.id) return;

      const customerTgId = threadToCustomer.get(threadId);
      if (!customerTgId) return;

      // Update activity
      db.touchSupportTopic.run(customerTgId);

      try {
        await bot.api.copyMessage(customerTgId, ctx.chat.id, ctx.message.message_id);
      } catch (err) {
        console.error("[customer-bot] Failed to relay reply:", err);
      }
      return;
    }

    // Private messages only from here
    if (ctx.chat.type !== "private") return;

    const tgUser = ctx.from!;
    const text = ctx.message.text || ctx.message.caption || "";
    if (text.startsWith("/")) return;

    const hasMedia = ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.voice || ctx.message.sticker;
    if (!text && !hasMedia) return;

    // Ensure customer exists in DB
    db.upsertCustomer.run(tgUser.id, tgUser.username || null, tgUser.first_name);

    if (!SUPPORT_CHAT_ID) {
      await ctx.reply("Support is not available right now.");
      return;
    }

    const lines = db.getCustomerLines.all(tgUser.id) as DbCustomerLine[];
    if (lines.length === 0) {
      await ctx.reply("You don't have any linked subscriptions. Ask your provider for a link.");
      return;
    }

    // Find or create a forum topic for this customer
    let topicRow = db.getSupportTopic.get(tgUser.id) as { customer_telegram_id: number; thread_id: number } | undefined;

    if (!topicRow) {
      // Create a new topic
      const customerName = tgUser.username
        ? `@${tgUser.username}`
        : tgUser.first_name || `Customer ${tgUser.id}`;

      try {
        const topic = await bot.api.createForumTopic(Number(SUPPORT_CHAT_ID), customerName);
        db.upsertSupportTopic.run(tgUser.id, topic.message_thread_id);
        threadToCustomer.set(topic.message_thread_id, tgUser.id);
        topicRow = { customer_telegram_id: tgUser.id, thread_id: topic.message_thread_id };
      } catch (err) {
        console.error("[customer-bot] Failed to create topic:", err);
        await ctx.reply("Unable to reach support right now. Please try again later.");
        return;
      }
    }

    // Reopen topic if it was closed
    try {
      await bot.api.reopenForumTopic(Number(SUPPORT_CHAT_ID), topicRow.thread_id);
    } catch {
      // Already open or doesn't exist — handled below
    }

    // Post message in the topic
    try {
      if (hasMedia) {
        await bot.api.copyMessage(Number(SUPPORT_CHAT_ID), ctx.chat.id, ctx.message.message_id, {
          message_thread_id: topicRow.thread_id,
        });
      } else {
        await bot.api.sendMessage(Number(SUPPORT_CHAT_ID), text, {
          message_thread_id: topicRow.thread_id,
        });
      }
      db.touchSupportTopic.run(tgUser.id);
    } catch (err: any) {
      // Topic may have been deleted — recreate
      if (err.description?.includes("thread not found") || err.description?.includes("TOPIC_DELETED")) {
        db.deleteSupportTopic.run(tgUser.id);
        threadToCustomer.delete(topicRow.thread_id);
        await ctx.reply("Please send your message again.");
      } else {
        console.error("[customer-bot] Failed to send to topic:", err);
        await ctx.reply("Unable to reach support right now. Please try again later.");
      }
    }
  });

  bot.catch((err) => {
    console.error("[customer-bot] Error:", err.message);
  });

  return bot;
}
