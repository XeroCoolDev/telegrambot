import { createHmac } from "node:crypto";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface InitData {
  user: TelegramUser;
  authDate: number;
  hash: string;
  queryId?: string;
}

/**
 * Validate Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initDataStr: string, botToken?: string): InitData | null {
  botToken = botToken || process.env.XEROCOOL_BOT_TOKEN!;
  const params = new URLSearchParams(initDataStr);
  const hash = params.get("hash");
  if (!hash) return null;

  // Build check string (sorted key=value pairs, excluding hash)
  params.delete("hash");
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const checkString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  // HMAC chain: secret = HMAC-SHA256("WebAppData", bot_token)
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (computed !== hash) return null;

  // Check auth_date isn't too old (allow 24h)
  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) return null;

  const userStr = params.get("user");
  if (!userStr) return null;

  try {
    const user = JSON.parse(userStr) as TelegramUser;
    return { user, authDate, hash, queryId: params.get("query_id") || undefined };
  } catch {
    return null;
  }
}
