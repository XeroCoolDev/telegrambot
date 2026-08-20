import type { XuiLine, XuiUser, XuiPackage } from "./types.js";
import { adminRequest, timedFetch, buildResellerEditParams } from "./client.js";
import { formatApiDate, normaliseExpDate } from "./format.js";

/** Admin API — get any line by ID */
export async function getLine(lineId: string): Promise<XuiLine | null> {
  return adminRequest<XuiLine>("get_line", lineId);
}

/** Reseller API — get a single line (scoped to owner's lines) */
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

const LINE_LIST_COLUMNS =
  "id,username,member_id,exp_date,max_connections,enabled,admin_enabled,bouquet,reseller_notes";

/**
 * Fetch every line owned by the given member IDs via mysql_query.
 * XUI's get_lines endpoint has no server-side member_id filter (12k+ total),
 * so the query is scoped to the IDs we actually care about.
 * Only numeric IDs accepted to prevent SQL injection.
 */
export async function getLinesForMembers(
  memberIds: (string | number)[]
): Promise<XuiLine[] | null> {
  const ids = [
    ...new Set(
      memberIds
        .map((v) => parseInt(String(v), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ];
  if (ids.length === 0) return [];

  const sql = `SELECT ${LINE_LIST_COLUMNS} FROM \`lines\` WHERE member_id IN (${ids.join(",")}) ORDER BY id DESC`;
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

    return Array.isArray(data.data) ? data.data : Object.values(data.data);
  } catch (e) {
    console.error("[xui] getLinesForMembers failed:", e);
    return null;
  }
}

/** Fetch all lines owned by a single user. */
export async function getUserLines(xuiUserId: string): Promise<XuiLine[] | null> {
  const id = parseInt(xuiUserId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return getLinesForMembers([id]);
}

/**
 * Admin API — edit a line, preserving all original fields unless overridden.
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

  for (const [key, value] of Object.entries(options)) {
    params.set(key, value);
  }

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

/** Reseller API — create a new line */
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
 * Extend a line via hybrid flow — reseller API applies the package
 * (deducts credits), then admin API sets the calculated expiry and
 * max_connections.
 */
export async function extendLineHybrid(
  userData: XuiUser,
  lineData: XuiLine,
  selectedPackage: XuiPackage
): Promise<boolean> {
  // Unlimited lines (exp_date null/0) cannot be meaningfully extended — adding
  // a package duration to "now" would downgrade them to a finite expiry.
  if (normaliseExpDate(lineData.exp_date) === null) {
    console.error(`[xui] extendLineHybrid refused: line ${lineData.id} has no expiry`);
    return false;
  }
  try {
    const resellerParams = new URLSearchParams({ package: selectedPackage.id });
    const resellerUrl = `${process.env.XUI_RESELLER_API_URL}?api_key=${userData.api_key}&action=edit_line&id=${lineData.id}&${resellerParams}`;
    const resellerRes = await timedFetch(resellerUrl);
    if (!resellerRes.ok) throw new Error(`Reseller API: ${resellerRes.status}`);
    const resellerResult = await resellerRes.json();
    if (resellerResult.status !== "STATUS_SUCCESS")
      throw new Error("Reseller API non-success");

    // If the line is still valid, extend from its current expiry (customer
    // keeps unused time). If it's already expired or unset, extend from now.
    const expTs = normaliseExpDate(lineData.exp_date);
    const now = Date.now();
    const baseMs = expTs && expTs * 1000 > now ? expTs * 1000 : now;
    const currentExpiry = new Date(baseMs);
    const duration = parseInt(selectedPackage.official_duration, 10);
    const unit = selectedPackage.official_duration_in;

    if (unit === "months") currentExpiry.setMonth(currentExpiry.getMonth() + duration);
    else if (unit === "days") currentExpiry.setDate(currentExpiry.getDate() + duration);
    else if (unit === "hours") currentExpiry.setHours(currentExpiry.getHours() + duration);

    const newExpTimestamp = Math.floor(currentExpiry.getTime() / 1000);

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

/** Admin API — delete a line via dedicated endpoint */
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

/** Admin API — enable/disable a line via dedicated endpoints */
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

/**
 * Reseller API — update contact and/or reseller_notes on a line.
 * Sends all fields because reseller edit_line resets anything omitted.
 */
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
