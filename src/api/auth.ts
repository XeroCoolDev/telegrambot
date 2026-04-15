import type { Context, Next } from "hono";
import type { AppDb, DbUser } from "../db/index.js";
import { parsePermissions } from "../db/index.js";
import { validateInitData } from "../services/telegram-auth.js";
import { isRateLimited } from "../services/rate-limit.js";

export type AuthEnv = {
  Variables: {
    telegramId: number;
    xuiUserId: string;
    xuiApiKey: string;
    permissions: string | null;
  };
};

export const ADMIN_IDS = new Set(
  (process.env.XEROCOOL_ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean)
);

/** XeroCool (reseller) auth middleware — validates initData, auto-registers admins */
export function xerocoolAuthMiddleware(db: AppDb) {
  return async (c: Context<AuthEnv>, next: Next) => {
    const initData = c.req.header("X-Telegram-Init-Data");
    if (!initData) return c.json({ error: "Unauthorized" }, 401);

    const validated = validateInitData(initData);
    if (!validated) return c.json({ error: "Invalid init data" }, 401);

    if (isRateLimited(`tg:${validated.user.id}`)) {
      return c.json({ error: "Too many requests" }, 429);
    }

    let user = db.getUser.get(validated.user.id) as DbUser | undefined;

    // Auto-register admins if not in DB
    if (!user && ADMIN_IDS.has(validated.user.id)) {
      db.upsertUser.run(
        validated.user.id,
        validated.user.username || null,
        validated.user.first_name
      );
      user = db.getUser.get(validated.user.id) as DbUser | undefined;
    }

    if (!user) return c.json({ error: "Account not registered" }, 403);

    c.set("telegramId", validated.user.id);
    c.set("xuiUserId", user.xui_user_id || "");
    c.set("xuiApiKey", user.xui_api_key || "");
    c.set("permissions", user.permissions || null);
    await next();
  };
}

/** Check if context user has a permission, returns 403 if not */
export function requirePerm(
  c: Context<AuthEnv>,
  perm: keyof ReturnType<typeof parsePermissions>
) {
  const perms = parsePermissions(c.get("permissions"));
  if (!perms[perm]) return c.json({ error: "Permission denied" }, 403);
  return null;
}

/** Check if context user is an admin */
export function isAdmin(c: Context<AuthEnv>): boolean {
  return ADMIN_IDS.has(c.get("telegramId"));
}
