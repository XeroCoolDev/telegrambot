import type { Hono } from "hono";
import * as xui from "../services/xui.js";
import { requirePerm, type AuthEnv } from "./auth.js";

export function registerLineRoutes(api: Hono<AuthEnv>) {
  // GET /subscriptions — live lines from xui.one
  api.get("/subscriptions", async (c) => {
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json([]);

    const lines = await xui.getUserLines(xuiUserId);
    if (!lines) return c.json({ error: "Failed to fetch lines" }, 502);

    return c.json(
      lines.map((line) => ({
        id: line.id,
        username: line.username,
        status: xui.isLineEnabled(line) ? "active" : "disabled",
        expDate: xui.normaliseExpDate(line.exp_date),
        expiresFormatted: xui.formatExpiry(line.exp_date),
        daysLeft: xui.daysUntilExpiry(line.exp_date),
        maxConnections: line.max_connections,
        adultEnabled: xui.hasAdultBouquets(line),
        resellerNotes: line.reseller_notes || null,
      }))
    );
  });

  // GET /line/:id — single line details
  api.get("/line/:id", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const lineData = await xui.getLineAsReseller(xuiApiKey, c.req.param("id"));
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    return c.json({
      id: lineData.id,
      username: lineData.username,
      password: lineData.password,
      status: xui.isLineEnabled(lineData) ? "active" : "disabled",
      expDate: xui.normaliseExpDate(lineData.exp_date),
      expiresFormatted: xui.formatExpiry(lineData.exp_date),
      expiresDateTime: xui.formatExpiryWithTime(lineData.exp_date),
      daysLeft: xui.daysUntilExpiry(lineData.exp_date),
      maxConnections: lineData.max_connections,
      isTrial: lineData.is_trial === "1",
      lastIp: lineData.last_ip || null,
      contact: lineData.contact || null,
      resellerNotes: lineData.reseller_notes || null,
      adultEnabled: xui.hasAdultBouquets(lineData),
    });
  });

  // GET /line/:id/connection-options — pricing for connection upgrades
  api.get("/line/:id/connection-options", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const lineData = await xui.getLineAsReseller(xuiApiKey, c.req.param("id"));
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    return c.json(xui.getConnectionUpgradeOptions(lineData));
  });

  // POST /lines/add-connections — upgrade connections on a line
  api.post("/lines/add-connections", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    const xuiUserId = c.get("xuiUserId");
    if (!xuiApiKey || !xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { lineId, targetConnections } = await c.req.json<{
      lineId: string;
      targetConnections: number;
    }>();

    const [lineData, userData] = await Promise.all([
      xui.getLineAsReseller(xuiApiKey, lineId),
      xui.getUserAsReseller(xuiApiKey),
    ]);
    if (!lineData || !userData) return c.json({ error: "Failed to fetch data" }, 502);

    const options = xui.getConnectionUpgradeOptions(lineData);
    const selected = options.find((o) => o.to === targetConnections);
    if (!selected) return c.json({ error: "Invalid connection upgrade" }, 400);

    const userCredits = parseInt(userData.credits, 10);
    if (userCredits < selected.cost) {
      return c.json({ error: "Insufficient credits" }, 400);
    }

    const creditOk = await xui.adjustCredits(
      xuiUserId,
      -selected.cost,
      `Upgraded line ${lineId} to ${targetConnections} connections`
    );
    if (!creditOk) return c.json({ error: "Failed to deduct credits" }, 500);

    const success = await xui.upgradeConnections(lineId, targetConnections);
    if (!success) {
      await xui.adjustCredits(
        xuiUserId,
        selected.cost,
        `Refund: failed connection upgrade on line ${lineId}`
      );
      return c.json({ error: "Failed to upgrade connections" }, 500);
    }

    return c.json({ success: true, connections: targetConnections, cost: selected.cost });
  });

  // POST /lines/extend — extend a line using credits
  api.post("/lines/extend", async (c) => {
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { lineId, packageId } = await c.req.json<{
      lineId: string;
      packageId: string;
    }>();

    const [packages, userData, lineData] = await Promise.all([
      xui.getPackages(),
      xui.getUser(xuiUserId),
      xui.getLine(lineId),
    ]);

    if (!packages || !userData || !lineData) {
      return c.json({ error: "Failed to fetch required data" }, 502);
    }

    const selectedPackage = packages.find((p) => p.id === packageId);
    if (!selectedPackage) return c.json({ error: "Package not found" }, 404);

    // Connection lock: cannot extend with higher-connection package if too many days remaining
    const connLockDays = Number(process.env.EXTEND_CONN_LOCK_DAYS || 30);
    const daysLeft = xui.daysUntilExpiry(lineData.exp_date);
    const pkgConns = parseInt(selectedPackage.max_connections, 10);
    const lineConns = parseInt(lineData.max_connections, 10);
    if (pkgConns > lineConns && daysLeft !== null && daysLeft > connLockDays) {
      return c.json({
        error: `Cannot upgrade connections with >${connLockDays} days remaining. Use Add Connections instead.`,
      }, 400);
    }

    const userCredits = parseInt(userData.credits, 10);
    const packageCost = parseInt(selectedPackage.official_credits, 10);
    if (userCredits < packageCost) {
      return c.json({ error: "Insufficient credits" }, 400);
    }

    const success = await xui.extendLineHybrid(userData, lineData, selectedPackage);
    if (!success) return c.json({ error: "Failed to extend line" }, 500);

    return c.json({ success: true });
  });

  // POST /lines/update-info — update contact and/or reseller notes
  api.post("/lines/update-info", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId, contact, resellerNotes } = await c.req.json<{
      lineId: string;
      contact?: string;
      resellerNotes?: string;
    }>();

    const success = await xui.updateLineInfo(xuiApiKey, lineId, {
      contact,
      reseller_notes: resellerNotes,
    });
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true });
  });

  // POST /lines/delete — delete a line
  api.post("/lines/delete", async (c) => {
    const permErr = requirePerm(c, "canDeleteLine");
    if (permErr) return permErr;

    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId } = await c.req.json<{ lineId: string }>();

    const lineData = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    const success = await xui.deleteLine(lineId);
    if (!success) return c.json({ error: "Failed to delete line" }, 500);

    return c.json({ success: true });
  });

  // POST /lines/toggle-enabled — enable/disable a line
  api.post("/lines/toggle-enabled", async (c) => {
    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId, enabled } = await c.req.json<{ lineId: string; enabled: boolean }>();

    const lineData = await xui.getLineAsReseller(xuiApiKey, lineId);
    if (!lineData) return c.json({ error: "Line not found" }, 404);

    const success = await xui.toggleLineEnabled(lineId, enabled);
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true, enabled });
  });

  // POST /lines/toggle-adult — enable/disable adult bouquets
  api.post("/lines/toggle-adult", async (c) => {
    const permErr = requirePerm(c, "canToggleAdult");
    if (permErr) return permErr;

    const xuiApiKey = c.get("xuiApiKey");
    if (!xuiApiKey) return c.json({ error: "Account not linked" }, 400);

    const { lineId, enable } = await c.req.json<{ lineId: string; enable: boolean }>();

    const success = await xui.toggleAdultContent(xuiApiKey, lineId, enable);
    if (!success) return c.json({ error: "Failed to update line" }, 500);

    return c.json({ success: true, adultEnabled: enable });
  });

  // POST /lines/create — create a new line using credits
  api.post("/lines/create", async (c) => {
    const permErr = requirePerm(c, "canCreateLine");
    if (permErr) return permErr;

    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { packageId, resellerNotes, contact } = await c.req.json<{
      packageId: string;
      resellerNotes?: string;
      contact?: string;
    }>();

    const [packages, userData] = await Promise.all([xui.getPackages(), xui.getUser(xuiUserId)]);
    if (!packages || !userData) return c.json({ error: "Failed to fetch required data" }, 502);

    const selectedPackage = packages.find((p) => p.id === packageId);
    if (!selectedPackage) return c.json({ error: "Package not found" }, 404);

    const userCredits = parseInt(userData.credits, 10);
    const packageCost = parseInt(selectedPackage.official_credits, 10);
    if (userCredits < packageCost) return c.json({ error: "Insufficient credits" }, 400);

    const newLine = await xui.createNewLine(
      userData.api_key,
      packageId,
      resellerNotes || "",
      contact || ""
    );
    if (!newLine) return c.json({ error: "Failed to create line" }, 500);

    return c.json({ success: true, lineId: newLine.id });
  });

  // GET /packages — available packages
  api.get("/packages", async (c) => {
    const packages = await xui.getPackages();
    return c.json(
      packages.map((p) => ({
        id: p.id,
        name: p.package_name,
        credits: parseInt(p.official_credits, 10),
        duration: p.official_duration,
        durationUnit: p.official_duration_in,
        maxConnections: p.max_connections,
      }))
    );
  });
}
