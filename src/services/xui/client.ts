import type { XuiLine } from "./types.js";
import { formatApiDate } from "./format.js";

const TIMEOUT = Number(process.env.API_TIMEOUT_MS || 10000);

/** Fetch with AbortController-based timeout */
export async function timedFetch(
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

/** Admin API request helper — uses XUI_ADMIN_API_KEY */
export async function adminRequest<T>(
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

/** Append bouquet and allowed_outputs as array params (reseller API format) */
export function appendLineArrayFields(params: URLSearchParams, line: XuiLine) {
  const bouquets: (string | number)[] = JSON.parse(line.bouquet || "[]");
  bouquets.forEach((b) => params.append("bouquets_selected[]", String(b)));
  const outputs: (string | number)[] = JSON.parse(line.allowed_outputs || "[]");
  outputs.forEach((a) => params.append("access_output[]", String(a)));
}

/** Build full reseller edit_line params preserving all fields */
export function buildResellerEditParams(
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
