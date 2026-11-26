import type { Hono } from "hono";
import type { AppDb, DbUser } from "../db/index.js";
import { parsePermissions } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import { ADMIN_IDS, type AuthEnv } from "./auth.js";
import { buildClaimByLine, ownerLabel, toLineSummary } from "./lines.js";

export function registerAdminRoutes(api: Hono<AuthEnv>, db: AppDb) {
  // GET /admin/lines — every line belonging to a linked reseller, annotated
  // with its owner. Scoped to members the bot knows about rather than the
  // whole panel, which carries 12k+ lines.
  api.get("/admin/lines", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);

    const owners = await db.getAllLinkedUsers.all() as DbUser[];
    const ownerByMemberId = new Map<string, DbUser>();
    for (const o of owners) {
      if (o.xui_user_id) ownerByMemberId.set(String(o.xui_user_id), o);
    }

    const lines = await xui.getLinesForMembers([...ownerByMemberId.keys()]);
    if (!lines) return c.json({ error: "Failed to fetch lines" }, 502);

    const claimByLine = await buildClaimByLine(db);

    return c.json(
      lines.map((line) => {
        const owner = ownerByMemberId.get(String(line.member_id));
        return {
          ...toLineSummary(line, claimByLine.get(line.id)),
          ownerTelegramId: owner?.telegram_id ?? null,
          ownerName: owner ? ownerLabel(owner) : null,
          ownerXuiUsername: owner?.xui_username ?? null,
          ownerXuiUserId: String(line.member_id),
        };
      })
    );
  });

  api.get("/admin/users", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const users = await db.listUsersForAdmin.all<any>();

    // Fold panel credits in via one paged users.list. If the panel is unreachable,
    // the map stays empty and every row reports credits: null — the UI still
    // renders, just without the credit number.
    const xuiList = await xui.getAllUsers();
    const creditsByXuiId = new Map<string, number>();
    if (xuiList) {
      for (const x of xuiList) creditsByXuiId.set(x.id, parseInt(x.credits, 10));
    }

    // Last settled top-up per user — one grouped query instead of N lookups.
    const lastTopUps = await db.lastSettledTopUps.all<{ telegram_id: number; credits: number; created_at: string }>();
    const topUpByTgId = new Map(lastTopUps.map((r) => [r.telegram_id, r]));

    return c.json(
      users.map((u) => {
        const topUp = topUpByTgId.get(u.telegram_id);
        return {
          ...u,
          permissions: parsePermissions(u.permissions),
          credits: u.xui_user_id ? creditsByXuiId.get(u.xui_user_id) ?? null : null,
          lastTopUp: topUp ? { credits: topUp.credits, at: topUp.created_at } : null,
        };
      })
    );
  });

  api.get("/admin/payments", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const payments = await db.listRecentPayments.all();
    return c.json(payments);
  });

  // GET /admin/user/:telegramId/payments — one user's ledger, paged.
  // Paged server-side rather than shipping the whole history and slicing in
  // the app: a long-running reseller accumulates hundreds of rows.
  api.get("/admin/user/:telegramId/payments", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);

    const telegramId = Number(c.req.param("telegramId"));
    if (!Number.isInteger(telegramId)) return c.json({ error: "Invalid telegram id" }, 400);

    const perPage = Math.min(50, Math.max(1, Number(c.req.query("perPage")) || 10));
    const summary = await db.getUserPaymentsSummary.get(telegramId) as {
      total: number;
      settledCredits: number;
    };
    const totalPages = Math.max(1, Math.ceil(summary.total / perPage));
    // Clamp rather than trusting the caller — an out-of-range page would
    // otherwise return an empty list and strand the pager.
    const page = Math.min(totalPages, Math.max(1, Number(c.req.query("page")) || 1));

    const payments = await db.getUserPaymentsPage.all(telegramId, perPage, (page - 1) * perPage);

    return c.json({
      payments,
      total: summary.total,
      settledCredits: summary.settledCredits,
      page,
      perPage,
      totalPages,
    });
  });

  api.post("/admin/link", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, xuiUserId } = await c.req.json<{ telegramId: number; xuiUserId: string }>();

    const xuiUser = await xui.getUser(xuiUserId);
    if (!xuiUser) return c.json({ error: "XUI user not found" }, 404);

    // Pre-create the user row if they haven't /start'd yet — username and
    // first_name will be filled in on their first interaction with the bot.
    const targetUser = await db.getUser.get(telegramId) as DbUser | undefined;
    if (!targetUser) {
      await db.upsertUser.run(telegramId, null, null);
    }

    // The panel never returns an account's API key, so a key already stored
    // is kept and apiKeyPresent reflects that; otherwise the admin pastes the
    // reseller's key on the user page once they generate it in their portal.
    const apiKey = targetUser?.xui_api_key || null;
    await db.linkXui.run(xuiUserId, apiKey, xuiUser.username || null, telegramId);
    return c.json({
      success: true,
      username: xuiUser.username,
      apiKeyPresent: !!apiKey,
    });
  });

  // Admin: set/update api_key manually (the reseller generates it under
  // API Access in their Reseller Portal profile; Engine keys are 32 hex chars)
  api.post("/admin/set-api-key", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, apiKey } = await c.req.json<{ telegramId: number; apiKey: string }>();

    if (!apiKey || !/^[A-Za-z0-9]{16,64}$/.test(apiKey)) {
      return c.json({ error: "Invalid api_key (alphanumeric, 16–64 chars)" }, 400);
    }

    const target = await db.getUser.get(telegramId) as DbUser | undefined;
    if (!target?.xui_user_id) return c.json({ error: "User not linked to an XUI user" }, 404);

    await db.linkXui.run(target.xui_user_id, apiKey, target.xui_username || null, telegramId);
    return c.json({ success: true });
  });

  api.post("/admin/unlink", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId } = await c.req.json<{ telegramId: number }>();
    await db.linkXui.run(null, null, null, telegramId);
    return c.json({ success: true });
  });

  // Admin: remove a user from the bot entirely. Their panel account and its
  // lines survive — see deleteUserCascade in db/index.ts.
  api.post("/admin/delete-user", async (c) => {
    const callerId = c.get("telegramId");
    if (!ADMIN_IDS.has(callerId)) return c.json({ error: "Forbidden" }, 403);

    const { telegramId } = await c.req.json<{ telegramId: number }>();
    if (!Number.isInteger(telegramId)) return c.json({ error: "Invalid telegram id" }, 400);
    if (telegramId === callerId) {
      return c.json({ error: "You can't delete your own account" }, 400);
    }

    const target = await db.getUser.get(telegramId) as DbUser | undefined;
    if (!target) return c.json({ error: "User not found" }, 404);

    const removed = await db.deleteUserCascade(telegramId);
    console.log(
      `[admin] ${callerId} deleted user ${telegramId} (${removed.payments} payment row(s) removed)`
    );
    return c.json({ success: true, paymentsDeleted: removed.payments });
  });

  api.post("/admin/set-reseller-group", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, chatId } = await c.req.json<{
      telegramId: number;
      chatId: number | null;
    }>();

    if (chatId !== null && !(Number.isInteger(chatId) && chatId < 0)) {
      return c.json({ error: "Invalid chat id (expected negative supergroup id like -1001234567890)" }, 400);
    }

    const target = await db.getUser.get(telegramId) as DbUser | undefined;
    if (!target) return c.json({ error: "User not found" }, 404);

    await db.setResellerGroupChatId.run(chatId, telegramId);
    return c.json({ success: true });
  });

  api.post("/admin/set-permissions", async (c) => {
    if (!ADMIN_IDS.has(c.get("telegramId"))) return c.json({ error: "Forbidden" }, 403);
    const { telegramId, permissions } = await c.req.json<{
      telegramId: number;
      permissions: Record<string, boolean>;
    }>();
    await db.updatePermissions.run(JSON.stringify(permissions), telegramId);
    return c.json({ success: true });
  });
}
