import { Bot, InlineKeyboard } from "grammy";
import type { AppDb } from "../db/index.js";
import { isRateLimited } from "../services/rate-limit.js";
import { verifyClaimToken, generateClaimToken } from "../services/claim-token.js";
import * as xui from "../services/xui/index.js";

const SUPPORT_CHAT_ID = process.env.SUPPORT_FORUM_CHAT_ID || "";

/** Render a single line's credentials as a chat message. */
async function formatLineMessage(lineId: string): Promise<string | null> {
  const line = await xui.getLine(lineId);
  if (!line) return null;
  const expires = xui.formatExpiry(line.exp_date);

  return [
    `Username: <code>${escapeHtml(line.username)}</code>`,
    `Password: <code>${escapeHtml(line.password)}</code>`,
    ``,
    `Expires: ${expires}`,
    `Connections: ${line.max_connections}`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createCustomerBot(db: AppDb) {
  const bot = new Bot(process.env.CUSTOMER_BOT_TOKEN!);
  const WEBAPP_URL = process.env.CUSTOMER_WEBAPP_URL || "";

  // Default menu: commands list for everyone (overridden per-chat once linked)
  bot.api
    .setChatMenuButton({ menu_button: { type: "commands" } })
    .catch((err) => console.error("[customer-bot] setChatMenuButton default failed:", err));

  // Clear any previously-registered scoped commands (we used to register /link;
  // autocomplete auto-sends without args so it's unwanted)
  if (SUPPORT_CHAT_ID) {
    bot.api
      .deleteMyCommands({ scope: { type: "chat", chat_id: Number(SUPPORT_CHAT_ID) } })
      .catch(() => { /* nothing to clear — fine */ });
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
        await bot.api.setChatMenuButton({
          chat_id: chatId,
          menu_button: { type: "default" },
        });
      }
    } catch (err) {
      console.error("[customer-bot] setChatMenuButton chat failed:", err);
    }
  }

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
      const lineId = verifyClaimToken(payload);
      if (!lineId) {
        await ctx.reply("This link is invalid or has expired.");
        return;
      }

      // Verify the line still exists in XUI before recording a claim
      const line = await xui.getLine(lineId);
      if (!line) {
        await ctx.reply("We couldn't link your account right now. Please try again later.");
        return;
      }
      if (db.getLineClaimedByOther.get(lineId, tgUser.id)) {
        await ctx.reply(
          "This subscription is already linked to another account. Please contact your provider if this is a mistake."
        );
        return;
      }
      db.claimLine.run(tgUser.id, lineId);

      const msg = await formatLineMessage(lineId);
      await ctx.reply(
        `You're all set up 🎉\n\n${msg ?? ""}\n\nTap Dashboard to view details, or message here for support.`,
        { parse_mode: "HTML" }
      );
      await setDashboardButton(tgUser.id, true);

      // Hide the "/start <payload>" command from the customer's chat
      try {
        await ctx.api.deleteMessage(ctx.chat.id, ctx.message!.message_id);
      } catch { /* best-effort */ }
      return;
    }

    const claimedIds = db.getClaimedLineIds.all(tgUser.id) as { xui_line_id: string }[];

    if (claimedIds.length === 0) {
      await setDashboardButton(tgUser.id, false);
      await ctx.reply(
        `Hi${tgUser.first_name ? ` ${tgUser.first_name}` : ""} 👋\n\n` +
          `This is where you'll manage your subscription once it's set up.\n\n` +
          `Need help? Just send a message here and our support team will reply.`
      );
      return;
    }

    await setDashboardButton(tgUser.id, true);
    await ctx.reply(
      `Welcome back${tgUser.first_name ? `, ${tgUser.first_name}` : ""}!\n\nTap the Dashboard button below to view your subscription${claimedIds.length !== 1 ? "s" : ""}.\n\nTo contact support, just type your message here.`
    );
  });

  // ── Claim button (callback) ──
  bot.callbackQuery(/^claim:(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    const lineId = verifyClaimToken(token);
    const tgUser = ctx.from;

    if (!lineId) {
      await ctx.answerCallbackQuery({ text: "This link is invalid or expired.", show_alert: true });
      return;
    }

    const line = await xui.getLine(lineId);
    if (!line) {
      await ctx.answerCallbackQuery({ text: "Couldn't link right now. Try again later.", show_alert: true });
      return;
    }
    if (db.getLineClaimedByOther.get(lineId, tgUser.id)) {
      await ctx.answerCallbackQuery({
        text: "Already linked to another account. Contact your provider.",
        show_alert: true,
      });
      return;
    }
    db.claimLine.run(tgUser.id, lineId);

    await ctx.answerCallbackQuery({ text: "Linked!" });

    // Replace the claim-prompt message with the welcome + credentials
    const lineMsg = await formatLineMessage(lineId);
    const body = `You're all set up 🎉\n\n${lineMsg ?? ""}\n\nTap Dashboard to view details, or message here for support.`;
    try {
      await ctx.editMessageText(body, { parse_mode: "HTML" });
    } catch {
      // Fallback if the message can't be edited (e.g. too old)
      if (ctx.chat) await ctx.api.sendMessage(ctx.chat.id, body, { parse_mode: "HTML" });
    }

    await setDashboardButton(tgUser.id, true);
  });

  // ── Mirror reactions between topic and customer DM ──
  bot.on("message_reaction", async (ctx) => {
    const update = ctx.update.message_reaction;
    if (!update) return;

    // Ignore reactions from the bot itself to avoid loops
    if (update.user?.id === bot.botInfo.id) return;

    // Only emoji reactions (skip custom stickers for simplicity)
    const reactions = (update.new_reaction || [])
      .filter((r) => r.type === "emoji")
      .map((r) => ({ type: "emoji" as const, emoji: (r as any).emoji }));

    const msgId = update.message_id;
    const chatId = update.chat.id;

    // Case A: reaction happened in the support group — mirror to the customer's DM
    if (String(chatId) === SUPPORT_CHAT_ID) {
      const mapping = db.getRelayedMessage.get(msgId) as
        | { customer_telegram_id: number; customer_msg_id: number }
        | undefined;
      if (!mapping) return;
      try {
        await bot.api.setMessageReaction(mapping.customer_telegram_id, mapping.customer_msg_id, reactions);
      } catch (err) {
        console.error("[customer-bot] Failed to mirror reaction to customer:", err);
      }
      return;
    }

    // Case B: reaction happened in a customer's DM — mirror to the group topic
    if (update.chat.type === "private") {
      const row = db.getGroupMsgByCustomerMsg.get(chatId, msgId) as
        | { group_msg_id: number }
        | undefined;
      if (!row) return;
      try {
        await bot.api.setMessageReaction(Number(SUPPORT_CHAT_ID), row.group_msg_id, reactions);
      } catch (err) {
        console.error("[customer-bot] Failed to mirror reaction to topic:", err);
      }
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

      const text = ctx.message.text || "";

      // /link <lineId> — send the customer a claim button in their DM
      const linkMatch = text.match(/^\/link\s+(\d+)\s*$/);
      if (linkMatch) {
        const lineId = linkMatch[1];
        const line = await xui.getLine(lineId);
        if (!line) {
          await ctx.reply(`Line ${lineId} not found.`, { message_thread_id: threadId });
          return;
        }

        const token = generateClaimToken(lineId);
        const kb = new InlineKeyboard().text("🔗 Claim subscription", `claim:${token}`);

        try {
          await bot.api.sendMessage(
            customerTgId,
            `Your provider has a subscription ready for you. Tap below to link it to your account.`,
            { reply_markup: kb }
          );
          await ctx.reply(`Claim link sent to customer.`, { message_thread_id: threadId });
          try {
            await bot.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
          } catch { /* best-effort */ }
        } catch (err) {
          console.error("[customer-bot] Failed to send claim link:", err);
          await ctx.reply(
            `Couldn't send the link — the customer may need to open the bot first.`,
            { message_thread_id: threadId }
          );
        }
        return;
      }

      // /delete — when used as a reply, wipe both copies
      if (text.trim() === "/delete") {
        const replyTo = ctx.message.reply_to_message;
        if (!replyTo) {
          await ctx.reply("Reply to the message you want to delete with /delete.", {
            message_thread_id: threadId,
          });
          return;
        }

        const mapping = db.getRelayedMessage.get(replyTo.message_id) as
          | { customer_telegram_id: number; customer_msg_id: number }
          | undefined;

        // Delete customer-side copy if we have the mapping
        if (mapping) {
          try {
            await bot.api.deleteMessage(mapping.customer_telegram_id, mapping.customer_msg_id);
          } catch (err) {
            console.error("[customer-bot] Failed to delete customer-side message:", err);
          }
          db.deleteRelayedMessage.run(replyTo.message_id);
        }

        // Delete the group-side original and the /delete command
        try {
          await bot.api.deleteMessage(ctx.chat.id, replyTo.message_id);
        } catch (err) {
          console.error("[customer-bot] Failed to delete group-side message:", err);
        }
        try {
          await bot.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
        } catch { /* ignore */ }
        return;
      }

      // Update activity
      db.touchSupportTopic.run(customerTgId);

      // If the reseller replied to a relayed customer message, thread back to
      // the customer's original so it renders as a reply on their side.
      let replyToCustomerMsgId: number | undefined;
      const replyTarget = ctx.message.reply_to_message;
      if (replyTarget) {
        const mapping = db.getRelayedMessage.get(replyTarget.message_id) as
          | { customer_telegram_id: number; customer_msg_id: number }
          | undefined;
        if (mapping && mapping.customer_telegram_id === customerTgId) {
          replyToCustomerMsgId = mapping.customer_msg_id;
        }
      }

      try {
        const sent = await bot.api.copyMessage(customerTgId, ctx.chat.id, ctx.message.message_id, {
          reply_parameters: replyToCustomerMsgId
            ? { message_id: replyToCustomerMsgId }
            : undefined,
        });
        db.recordRelayedMessage.run(ctx.message.message_id, customerTgId, sent.message_id);
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

    const customerName = tgUser.username
      ? `@${tgUser.username}`
      : tgUser.first_name || `Customer ${tgUser.id}`;

    async function ensureTopic(): Promise<number | null> {
      const existing = db.getSupportTopic.get(tgUser.id) as { thread_id: number } | undefined;
      if (existing) return existing.thread_id;

      try {
        const topic = await bot.api.createForumTopic(Number(SUPPORT_CHAT_ID), customerName);
        db.upsertSupportTopic.run(tgUser.id, topic.message_thread_id);
        threadToCustomer.set(topic.message_thread_id, tgUser.id);
        return topic.message_thread_id;
      } catch (err) {
        console.error("[customer-bot] Failed to create topic:", err);
        return null;
      }
    }

    async function postToTopic(threadId: number): Promise<void> {
      try {
        await bot.api.reopenForumTopic(Number(SUPPORT_CHAT_ID), threadId);
      } catch { /* already open or handled below */ }

      // If the customer is replying to an earlier relayed reseller message,
      // thread back to the reseller's original in the topic.
      let replyToGroupMsgId: number | undefined;
      const replyTarget = ctx.message.reply_to_message;
      if (replyTarget) {
        const row = db.getGroupMsgByCustomerMsg.get(tgUser.id, replyTarget.message_id) as
          | { group_msg_id: number }
          | undefined;
        if (row) replyToGroupMsgId = row.group_msg_id;
      }

      const replyParams = replyToGroupMsgId
        ? { message_id: replyToGroupMsgId }
        : undefined;

      const namePrefix = `<b>${escapeHtml(customerName)}:</b>`;

      let groupMsgId: number;
      if (hasMedia) {
        const origCaption = ctx.message.caption || "";
        const caption = origCaption
          ? `${namePrefix}\n\n${escapeHtml(origCaption)}`
          : namePrefix;
        const sent = await bot.api.copyMessage(
          Number(SUPPORT_CHAT_ID),
          ctx.chat.id,
          ctx.message.message_id,
          {
            message_thread_id: threadId,
            reply_parameters: replyParams,
            caption,
            parse_mode: "HTML",
          }
        );
        groupMsgId = sent.message_id;
      } else {
        const sent = await bot.api.sendMessage(
          Number(SUPPORT_CHAT_ID),
          `${namePrefix}\n\n${escapeHtml(text)}`,
          {
            message_thread_id: threadId,
            reply_parameters: replyParams,
            parse_mode: "HTML",
          }
        );
        groupMsgId = sent.message_id;
      }

      // Map group-side copy → customer's original, so reseller replies can thread back
      db.recordRelayedMessage.run(groupMsgId, tgUser.id, ctx.message.message_id);
    }

    function isDeadThread(err: any): boolean {
      return !!(err?.description?.includes("thread not found") || err?.description?.includes("TOPIC_DELETED"));
    }

    // Try up to twice: once with whatever topic we have, once after recreating if dead
    for (let attempt = 0; attempt < 2; attempt++) {
      const threadId = await ensureTopic();
      if (!threadId) {
        await ctx.reply("Unable to reach support right now. Please try again later.");
        return;
      }
      try {
        await postToTopic(threadId);
        db.touchSupportTopic.run(tgUser.id);
        return;
      } catch (err: any) {
        if (isDeadThread(err) && attempt === 0) {
          // Stored topic was deleted — wipe and let ensureTopic() create a fresh one
          db.deleteSupportTopic.run(tgUser.id);
          threadToCustomer.delete(threadId);
          continue;
        }
        console.error("[customer-bot] Failed to send to topic:", err);
        await ctx.reply("Unable to reach support right now. Please try again later.");
        return;
      }
    }
  });

  bot.catch((err) => {
    console.error("[customer-bot] Error:", err.message);
  });

  return bot;
}
