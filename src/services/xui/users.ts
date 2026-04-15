import type { XuiUser } from "./types.js";
import { adminRequest, timedFetch } from "./client.js";

/** Admin API — get any user by XUI ID */
export async function getUser(xuiUserId: string): Promise<XuiUser | null> {
  return adminRequest<XuiUser>("get_user", xuiUserId);
}

/** Reseller API — get the reseller's own profile (least privilege) */
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

/**
 * Admin API — set a user's api_key via mysql_query.
 * Used when XUI hasn't generated a key for a reseller and we need one for the
 * reseller API to work. Caller provides the key (generate with randomBytes).
 */
export async function setUserApiKey(xuiUserId: string, apiKey: string): Promise<boolean> {
  const id = parseInt(xuiUserId, 10);
  if (!Number.isFinite(id) || id <= 0) return false;
  // Accept only alnum — matches the standard XUI 32-char hex format
  if (!/^[A-Za-z0-9]+$/.test(apiKey)) return false;

  const sql = `UPDATE users SET api_key='${apiKey}' WHERE id=${id}`;
  const params = new URLSearchParams({
    api_key: process.env.XUI_ADMIN_API_KEY!,
    action: "mysql_query",
    query: sql,
  });
  const url = `${process.env.XUI_ADMIN_API_URL}?${params}`;

  try {
    const res = await timedFetch(url);
    if (!res.ok) throw new Error(`mysql_query setUserApiKey: ${res.status}`);
    // UPDATE statements on some XUI versions return an empty body. Treat that
    // as success; verify by re-fetching the user and comparing.
    const text = (await res.text()).trim();
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data.status !== "STATUS_SUCCESS") return false;
      } catch {
        // fall through to verification
      }
    }
    const verify = await getUser(xuiUserId);
    return verify?.api_key === apiKey;
  } catch (e) {
    console.error("[xui] setUserApiKey failed:", e);
    return false;
  }
}

/** Admin API — adjust credits on a user's XUI account */
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
