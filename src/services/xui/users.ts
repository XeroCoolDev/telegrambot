import type { XuiUser } from "./types.js";
import { adminRequest, timedFetch } from "./client.js";

/** Admin API — get any user by XUI ID */
export async function getUser(xuiUserId: string): Promise<XuiUser | null> {
  return adminRequest<XuiUser>("get_user", xuiUserId);
}

/** Admin API — list all users in one call */
export async function getAllUsers(): Promise<XuiUser[] | null> {
  return adminRequest<XuiUser[]>("get_users");
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
