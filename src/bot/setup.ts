import type { Bot } from "grammy";

/**
 * One-time Telegram-side configuration that used to run as a side effect of
 * constructing the bots. It is separate now because the Worker constructs the
 * bots once per isolate, on demand, and must not make Telegram calls at that
 * point. Node calls this at boot; the Worker calls it from POST /setup/telegram.
 */
export async function applyBotDefaults(xerocoolBot: Bot, xposedBot?: Bot): Promise<void> {
  // Default menu button (bot-level): Dashboard web-app button. This also makes
  // the "Open" button appear in the Telegram chat-list preview for the bot.
  // Per-chat override flips it back to commands for unlinked users on /start.
  const webappUrl = process.env.XEROCOOL_WEBAPP_URL;
  if (webappUrl) {
    await xerocoolBot.api
      .setChatMenuButton({
        menu_button: { type: "web_app", text: "Dashboard", web_app: { url: webappUrl } },
      })
      .catch((err) => console.error("[xerocool-bot] setChatMenuButton default failed:", err));
  }

  if (!xposedBot) return;

  // Default menu: commands list for everyone (overridden per-chat once linked)
  await xposedBot.api
    .setChatMenuButton({ menu_button: { type: "commands" } })
    .catch((err) => console.error("[xposed-bot] setChatMenuButton default failed:", err));

  // Clear any previously-registered scoped commands (we used to register /link;
  // autocomplete auto-sends without args so it's unwanted)
  const supportChatId = process.env.XPOSED_SUPPORT_CHAT_ID;
  if (supportChatId) {
    await xposedBot.api
      .deleteMyCommands({ scope: { type: "chat", chat_id: Number(supportChatId) } })
      .catch(() => { /* nothing to clear — fine */ });
  }
}
