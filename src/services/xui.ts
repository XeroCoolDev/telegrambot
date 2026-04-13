/**
 * XUI Admin & Reseller API client.
 *
 * Admin API:  ?api_key=X&action=get_user&id=Y
 * Reseller:   ?api_key=X&action=create_line&package=Z
 *
 * Response format: { status: "STATUS_SUCCESS", data: {...} }
 * Exception: get_packages returns a raw array.
 */

const TIMEOUT = Number(process.env.API_TIMEOUT_MS || 10000);

// ── Types ───────────────────────────────────────────────

export interface XuiUser {
  id: string;
  username: string;
  credits: string; // XUI returns credits as string
  api_key: string;
  reseller_dns: string;
}

export interface XuiLine {
  id: string;
  username: string;
  password: string;
  exp_date: string | number | null; // unix timestamp (string from get_lines, number from get_line)
  max_connections: string;
  bouquet: string; // JSON array string (only from get_line)
  allowed_outputs: string; // JSON array string (only from get_line)
  member_id: string;
  admin_notes: string;
  reseller_notes: string;
  contact: string;
  force_server_id: string;
  is_trial: string;
  last_ip: string | null;
  enabled: string; // "0" | "1" from get_lines
  admin_enabled: string; // "0" | "1" from get_lines
  status: number; // 0 | 1 from get_line
  created_at: string;
}

/** Normalise enabled state across get_lines (enabled field) and get_line (status field) */
export function isLineEnabled(line: XuiLine): boolean {
  // get_line uses numeric status, get_lines uses string enabled + admin_enabled
  if (line.enabled !== undefined) return String(line.enabled) === "1" && String(line.admin_enabled) === "1";
  return line.status === 1;
}

/** Normalise exp_date to number (XUI returns string from get_lines, number from get_line) */
export function normaliseExpDate(expDate: string | number | null): number | null {
  if (expDate === null || expDate === undefined || expDate === "" || expDate === "0" || expDate === 0) return null;
  return Number(expDate);
}

export interface XuiPackage {
  id: string;
  package_name: string;
  official_credits: string;
  official_duration: string;
  official_duration_in: string; // "months" | "days" | "hours"
  max_connections: string;
  is_trial: string;
  // add fields as needed
}

// ── Helpers ─────────────────────────────────────────────

/** Append bouquet and allowed_outputs as array params (reseller API format) */
function appendLineArrayFields(params: URLSearchParams, line: XuiLine) {
  const bouquets: (string | number)[] = JSON.parse(line.bouquet || "[]");
  bouquets.forEach((b) => params.append("bouquets_selected[]", String(b)));
  const outputs: (string | number)[] = JSON.parse(line.allowed_outputs || "[]");
  outputs.forEach((a) => params.append("access_output[]", String(a)));
}

/** Build full reseller edit_line params preserving all fields */
function buildResellerEditParams(
  resellerApiKey: string,
  lineData: XuiLine,
  overrides: Record<string, string> = {}
): URLSearchParams {
  const params = new URLSearchParams({
    api_key: resellerApiKey,
    action: "edit_line",
    id: lineData.id,
    exp_date: formatApiDate(lineData.exp_date),
    max_connections: lineData.max_connections,
    admin_notes: lineData.admin_notes || "",
    reseller_notes: lineData.reseller_notes || "",
    contact: lineData.contact || "",
    password: lineData.password,
    username: lineData.username,
  });
  for (const [key, value] of Object.entries(overrides)) {
    params.set(key, value);
  }
  appendLineArrayFields(params, lineData);
  return params;
}

async function timedFetch(
  url: string,
  opts: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function adminRequest<T>(
  action: string,
  id?: string | null
): Promise<T | null> {
  const params = new URLSearchParams({
    api_key: process.env.XUI_ADMIN_API_KEY!,
    action,
  });
  if (id) params.set("id", id);

  const url = `${process.env.XUI_ADMIN_API_URL}?${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`XUI ${action}: ${res.status}`);
    const data = await res.json();

    // get_packages returns a raw array
    if (action === "get_packages") return (Array.isArray(data) ? data : null) as T | null;

    return data.status === "STATUS_SUCCESS" && data.data ? data.data : null;
  } catch (e) {
    console.error(`[xui] ${action} failed:`, e);
    return null;
  }
}

// ── User / Credits ──────────────────────────────────────

export async function getUser(xuiUserId: string): Promise<XuiUser | null> {
  return adminRequest<XuiUser>("get_user", xuiUserId);
}

/** Fetch the reseller's own profile via the reseller API (least privilege) */
export async function getUserAsReseller(
  resellerApiKey: string
): Promise<XuiUser | null> {
  const params = new URLSearchParams({
    api_key: resellerApiKey,
    action: "user_info",
  });
  const url = `${process.env.XUI_RESELLER_API_URL}?${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`Reseller user_info: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS" && data.data ? data.data : null;
  } catch (e) {
    console.error("[xui] getUserAsReseller failed:", e);
    return null;
  }
}

export async function adjustCredits(
  xuiUserId: string,
  credits: number,
  reason: string
): Promise<boolean> {
  const creditAmount = Math.floor(credits);
  const actionText =
    creditAmount > 0 ? `+${creditAmount}` : `-${Math.abs(creditAmount)}`;
  const finalReason = `${reason} (${actionText} credits)`;

  const params = new URLSearchParams({
    api_key: process.env.XUI_ADMIN_API_KEY!,
    action: "adjust_credits",
    id: xuiUserId,
    credits: String(creditAmount),
    reason: finalReason,
  });

  const url = `${process.env.XUI_ADMIN_API_URL}?${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`adjust_credits: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS";
  } catch (e) {
    console.error("[xui] adjustCredits failed:", e);
    return false;
  }
}

// ── Packages ────────────────────────────────────────────

/** Update contact and/or reseller_notes on a line via the reseller API.
 *  Sends all fields — reseller edit_line resets anything omitted. */
export async function updateLineInfo(
  resellerApiKey: string,
  lineId: string,
  fields: { contact?: string; reseller_notes?: string }
): Promise<boolean> {
  const lineData = await getLineAsReseller(resellerApiKey, lineId);
  if (!lineData) return false;

  const overrides: Record<string, string> = {};
  if (fields.contact !== undefined) overrides.contact = fields.contact;
  if (fields.reseller_notes !== undefined) overrides.reseller_notes = fields.reseller_notes;

  const params = buildResellerEditParams(resellerApiKey, lineData, overrides);
  const url = `${process.env.XUI_RESELLER_API_URL}?${params}`;
  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`Reseller edit_line: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS";
  } catch (e) {
    console.error("[xui] updateLineInfo failed:", e);
    return false;
  }
}

export async function getPackages(): Promise<XuiPackage[]> {
  const packages = await adminRequest<XuiPackage[]>("get_packages");
  return packages || [];
}

// ── Lines ───────────────────────────────────────────────

export async function getLine(lineId: string): Promise<XuiLine | null> {
  return adminRequest<XuiLine>("get_line", lineId);
}

/** Fetch a single line via the reseller API (scoped to the user's own lines) */
export async function getLineAsReseller(
  resellerApiKey: string,
  lineId: string
): Promise<XuiLine | null> {
  const id = parseInt(lineId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const params = new URLSearchParams({
    api_key: resellerApiKey,
    action: "get_line",
    id: String(id),
  });
  const url = `${process.env.XUI_RESELLER_API_URL}?${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`Reseller get_line: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS" && data.data ? data.data : null;
  } catch (e) {
    console.error("[xui] getLineAsReseller failed:", e);
    return null;
  }
}

/**
 * Fetch lines for a specific user via mysql_query.
 * The dedicated get_lines endpoint has no server-side member_id filter and
 * returns ALL lines (12k+), so we use a direct SQL query instead.
 * Only numeric IDs are accepted to prevent SQL injection.
 */
export async function getUserLines(
  xuiUserId: string
): Promise<XuiLine[] | null> {
  const id = parseInt(xuiUserId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const sql = `SELECT id,username,member_id,exp_date,max_connections,enabled,admin_enabled,bouquet,reseller_notes FROM \`lines\` WHERE member_id=${id} ORDER BY id DESC`;
  const params = new URLSearchParams({
    api_key: process.env.XUI_ADMIN_API_KEY!,
    action: "mysql_query",
    query: sql,
  });
  const url = `${process.env.XUI_ADMIN_API_URL}?${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`mysql_query get_lines: ${res.status}`);
    const data = await res.json();
    if (data.status !== "STATUS_SUCCESS" || !data.data) return null;

    const lines: XuiLine[] = Array.isArray(data.data)
      ? data.data
      : Object.values(data.data);
    return lines;
  } catch (e) {
    console.error("[xui] getUserLines failed:", e);
    return null;
  }
}

/**
 * Edit an existing line via the Admin API.
 * Preserves all original fields unless overridden in `options`.
 */
export async function editLine(
  lineId: string,
  options: Record<string, string> = {},
  originalLineData?: XuiLine | null
): Promise<boolean> {
  const lineData = originalLineData || (await getLine(lineId));
  if (!lineData) {
    console.error(`[xui] editLine: could not fetch line ${lineId}`);
    return false;
  }

  const params = new URLSearchParams({
    username: lineData.username,
    member_id: lineData.member_id,
    exp_date: formatApiDate(lineData.exp_date),
    admin_notes: lineData.admin_notes || "",
    reseller_notes: lineData.reseller_notes || "",
    contact: lineData.contact || "",
    force_server_id: lineData.force_server_id || "0",
    bouquets_selected: lineData.bouquet || "[]",
    max_connections: lineData.max_connections,
    password: lineData.password,
  });

  // Apply overrides
  for (const [key, value] of Object.entries(options)) {
    params.set(key, value);
  }

  // Preserve allowed_outputs
  const outputs: string[] = JSON.parse(lineData.allowed_outputs || "[]");
  outputs.forEach((a) => params.append("access_output[]", a));

  const url = `${process.env.XUI_ADMIN_API_URL}?api_key=${process.env.XUI_ADMIN_API_KEY}&action=edit_line&id=${lineId}&${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`edit_line: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS";
  } catch (e) {
    console.error("[xui] editLine failed:", e);
    return false;
  }
}

/**
 * Create a new line via the Reseller API (uses user's own api_key).
 */
export async function createNewLine(
  resellerApiKey: string,
  packageId: string,
  resellerNotes = "",
  contact = ""
): Promise<XuiLine | null> {
  const params = new URLSearchParams({
    package: packageId,
    reseller_notes: resellerNotes,
    contact,
  });
  const url = `${process.env.XUI_RESELLER_API_URL}?api_key=${resellerApiKey}&action=create_line&${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.status === "STATUS_SUCCESS" && data.data ? data.data : null;
  } catch (e) {
    console.error("[xui] createNewLine failed:", e);
    return null;
  }
}

/**
 * Extend a line using hybrid flow (reseller API for package, admin API for edit).
 */
export async function extendLineHybrid(
  userData: XuiUser,
  lineData: XuiLine,
  selectedPackage: XuiPackage
): Promise<boolean> {
  try {
    // Step 1: Reseller API to apply the package
    const resellerParams = new URLSearchParams({ package: selectedPackage.id });
    const resellerUrl = `${process.env.XUI_RESELLER_API_URL}?api_key=${userData.api_key}&action=edit_line&id=${lineData.id}&${resellerParams}`;
    const resellerRes = await timedFetch(resellerUrl);
    if (!resellerRes.ok) throw new Error(`Reseller API: ${resellerRes.status}`);
    const resellerResult = await resellerRes.json();
    if (resellerResult.status !== "STATUS_SUCCESS")
      throw new Error("Reseller API non-success");

    // Step 2: Calculate new expiry
    const expTs = normaliseExpDate(lineData.exp_date);
    const currentExpiry = expTs
      ? new Date(expTs * 1000)
      : new Date();
    const duration = parseInt(selectedPackage.official_duration, 10);
    const unit = selectedPackage.official_duration_in;

    if (unit === "months") currentExpiry.setMonth(currentExpiry.getMonth() + duration);
    else if (unit === "days") currentExpiry.setDate(currentExpiry.getDate() + duration);
    else if (unit === "hours") currentExpiry.setHours(currentExpiry.getHours() + duration);

    const newExpTimestamp = Math.floor(currentExpiry.getTime() / 1000);

    // Step 3: Admin API to set expiry + max_connections
    return await editLine(
      lineData.id,
      {
        exp_date: formatApiDate(newExpTimestamp),
        max_connections: selectedPackage.max_connections,
      },
      lineData
    );
  } catch (e) {
    console.error("[xui] extendLineHybrid failed:", e);
    return false;
  }
}

// ── Connection upgrades ────────────────────────────────

function parseConnPrice(env: string, fallbackStd: number, fallbackDisc: number) {
  const parts = (env || "").split(",").map(Number);
  return {
    standard: parts[0] && Number.isFinite(parts[0]) ? parts[0] : fallbackStd,
    discounted: parts[1] && Number.isFinite(parts[1]) ? parts[1] : fallbackDisc,
  };
}

const CONNECTION_PRICES: Record<string, { standard: number; discounted: number }> = {
  "1-2": parseConnPrice(process.env.CONN_PRICE_1_2 || "", 4, 2),
  "1-3": parseConnPrice(process.env.CONN_PRICE_1_3 || "", 7, 4),
  "2-3": parseConnPrice(process.env.CONN_PRICE_2_3 || "", 3, 2),
};

const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS || 3);
const CONN_DISCOUNT_MONTHS = Number(process.env.CONN_DISCOUNT_MONTHS || 6);
const CONN_MULTIPLIER_MONTHS = Number(process.env.CONN_MULTIPLIER_MONTHS || 12);

export interface ConnectionOption {
  from: number;
  to: number;
  cost: number;
  isDiscounted: boolean;
  multiplier: number;
}

export function getConnectionUpgradeOptions(line: XuiLine): ConnectionOption[] {
  const currentConns = parseInt(line.max_connections, 10) || 1;
  if (currentConns >= MAX_CONNECTIONS) return [];

  const now = new Date();
  const expTs = normaliseExpDate(line.exp_date);
  const expiryDate = expTs ? new Date(expTs * 1000) : now;

  // Discount: ≤N months remaining
  const discountThreshold = new Date();
  discountThreshold.setMonth(now.getMonth() + CONN_DISCOUNT_MONTHS);
  const isDiscounted = expiryDate <= discountThreshold;

  // Multiplier: >N months remaining → ceil(monthsRemaining / N)
  let multiplier = 1;
  const multiplierThreshold = new Date();
  multiplierThreshold.setMonth(now.getMonth() + CONN_MULTIPLIER_MONTHS);
  if (expiryDate > multiplierThreshold) {
    const monthsRemaining =
      (expiryDate.getFullYear() - now.getFullYear()) * 12 +
      (expiryDate.getMonth() - now.getMonth());
    multiplier = Math.ceil(monthsRemaining / CONN_MULTIPLIER_MONTHS);
  }

  const options: ConnectionOption[] = [];
  for (let target = currentConns + 1; target <= MAX_CONNECTIONS; target++) {
    const key = `${currentConns}-${target}`;
    const prices = CONNECTION_PRICES[key];
    if (!prices) continue;
    const base = isDiscounted ? prices.discounted : prices.standard;
    options.push({
      from: currentConns,
      to: target,
      cost: base * multiplier,
      isDiscounted,
      multiplier,
    });
  }
  return options;
}

/** Update max_connections on a line — requires admin API (reseller can't change this) */
export async function upgradeConnections(
  lineId: string,
  newConnections: number
): Promise<boolean> {
  return editLine(lineId, { max_connections: String(newConnections) });
}

/** Delete a line via dedicated admin API endpoint */
export async function deleteLine(lineId: string): Promise<boolean> {
  const params = new URLSearchParams({
    api_key: process.env.XUI_ADMIN_API_KEY!,
    action: "delete_line",
    id: lineId,
  });
  const url = `${process.env.XUI_ADMIN_API_URL}?${params}`;
  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`delete_line: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS";
  } catch (e) {
    console.error("[xui] deleteLine failed:", e);
    return false;
  }
}

/** Enable or disable a line via dedicated admin API endpoints */
export async function toggleLineEnabled(
  lineId: string,
  enabled: boolean
): Promise<boolean> {
  const action = enabled ? "enable_line" : "disable_line";
  const params = new URLSearchParams({
    api_key: process.env.XUI_ADMIN_API_KEY!,
    action,
    id: lineId,
  });
  const url = `${process.env.XUI_ADMIN_API_URL}?${params}`;
  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`${action}: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS";
  } catch (e) {
    console.error(`[xui] ${action} failed:`, e);
    return false;
  }
}

// ── Adult content toggle ────────────────────────────────

const ADULT_BOUQUET_IDS = new Set(
  (process.env.ADULT_BOUQUET_IDS || "").split(",").map((s) => s.trim()).filter(Boolean)
);

export function hasAdultBouquets(line: XuiLine): boolean {
  if (ADULT_BOUQUET_IDS.size === 0) return false;
  const bouquets: (string | number)[] = JSON.parse(line.bouquet || "[]");
  return bouquets.some((id) => ADULT_BOUQUET_IDS.has(String(id)));
}

export async function toggleAdultContent(
  resellerApiKey: string,
  lineId: string,
  enable: boolean
): Promise<boolean> {
  if (ADULT_BOUQUET_IDS.size === 0) return false;

  const lineData = await getLineAsReseller(resellerApiKey, lineId);
  if (!lineData) return false;

  const bouquets: (string | number)[] = JSON.parse(lineData.bouquet || "[]");
  let updated: (string | number)[];

  if (enable) {
    const existing = new Set(bouquets.map(String));
    const toAdd = [...ADULT_BOUQUET_IDS].filter((id) => !existing.has(id)).map(Number);
    updated = [...bouquets, ...toAdd];
  } else {
    updated = bouquets.filter((id) => !ADULT_BOUQUET_IDS.has(String(id)));
  }

  // Build params but override bouquet with the updated list
  const params = buildResellerEditParams(resellerApiKey, lineData);
  // Remove the auto-appended bouquets and replace with updated
  const url = new URL(`${process.env.XUI_RESELLER_API_URL}?${params}`);
  url.searchParams.delete("bouquets_selected[]");
  updated.forEach((b) => url.searchParams.append("bouquets_selected[]", String(b)));

  try {
    const res = await timedFetch(url.toString());
    if (!res.ok) throw new Error(`Reseller edit_line: ${res.status}`);
    const data = await res.json();
    return data.status === "STATUS_SUCCESS";
  } catch (e) {
    console.error("[xui] toggleAdultContent failed:", e);
    return false;
  }
}

// ── Date formatting ─────────────────────────────────────

export function formatApiDate(timestamp: string | number | null): string {
  const ts = normaliseExpDate(timestamp);
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function formatExpiry(expDate: string | number | null): string {
  const ts = normaliseExpDate(expDate);
  if (!ts) return "Unlimited";
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatExpiryWithTime(expDate: string | number | null): string {
  const ts = normaliseExpDate(expDate);
  if (!ts) return "Unlimited";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysUntilExpiry(expDate: string | number | null): number | null {
  const ts = normaliseExpDate(expDate);
  if (!ts) return null;
  return Math.floor((ts - Date.now() / 1000) / 86400);
}
