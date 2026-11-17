/**
 * XUI.live Engine Admin & Reseller API client.
 *
 * Admin API (XUI_ADMIN_API_URL + XUI_ADMIN_API_KEY) reaches the whole panel.
 * Reseller API (XUI_RESELLER_API_URL + each reseller's own key) is scoped to
 * that reseller's lines and charges their balance for purchases.
 *
 * Wire format: POST {"action": "<resource>.<verb>", ...} with X-API-Key;
 * answers are {"status": "ok", "data": ...} or {"status": "error", "error": {code, message, field}}.
 * See client.ts for the transport and engine.ts for the object mapping.
 */

export * from "./types.js";
export * from "./format.js";
export * from "./users.js";
export * from "./packages.js";
export * from "./lines.js";
export * from "./bouquets.js";
export * from "./pricing.js";
