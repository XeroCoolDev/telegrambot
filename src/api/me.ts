import type { Hono } from "hono";
import { parsePermissions } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import { ADMIN_IDS, type AuthEnv } from "./auth.js";

export function registerMeRoutes(api: Hono<AuthEnv>) {
  api.get("/me", async (c) => {
    const tgId = c.get("telegramId");
    const xuiApiKey = c.get("xuiApiKey");
    const isAdmin = ADMIN_IDS.has(tgId);
    const permissions = parsePermissions(c.get("permissions"));

    const config = {
      maxConnections: Number(process.env.MAX_CONNECTIONS || 3),
      extendConnLockDays: Number(process.env.EXTEND_CONN_LOCK_DAYS || 30),
    };

    if (!xuiApiKey) {
      return c.json({ linked: false, isAdmin, permissions, config });
    }

    const xuiUser = await xui.getUserAsReseller(xuiApiKey);
    if (!xuiUser) return c.json({ error: "Failed to fetch XUI data" }, 502);

    return c.json({
      linked: true,
      credits: parseInt(xuiUser.credits, 10),
      xuiUsername: xuiUser.username,
      isAdmin,
      permissions,
      config,
    });
  });
}
