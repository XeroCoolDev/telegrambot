import type { XuiUser } from "./types.js";
import type { EngineUser } from "./engine.js";
import { toXuiUser } from "./engine.js";
import { adminCall, adminList, resellerCall, toId, logFailure } from "./client.js";

/** Fields the bot reads off an account; keeps users.list pages light. */
const USER_FIELDS = "id,username,credits,dns";

/** Admin API — get any account by id */
export async function getUser(xuiUserId: string): Promise<XuiUser | null> {
  const id = toId(xuiUserId);
  if (!id) return null;
  try {
    const u = await adminCall<EngineUser>("users.get", { id });
    return toXuiUser(u);
  } catch (e) {
    logFailure("getUser", e);
    return null;
  }
}

/** Admin API — every account (administrators and resellers), paged. */
export async function getAllUsers(): Promise<XuiUser[] | null> {
  try {
    const rows = await adminList<EngineUser>("users.list", { fields: USER_FIELDS });
    return rows.map((u) => toXuiUser(u));
  } catch (e) {
    logFailure("getAllUsers", e);
    return null;
  }
}

/** Reseller API — the account behind the key (least privilege) */
export async function getUserAsReseller(
  resellerApiKey: string
): Promise<XuiUser | null> {
  if (!resellerApiKey) return null;
  try {
    const u = await resellerCall<EngineUser>(resellerApiKey, "account.get");
    return toXuiUser(u, resellerApiKey);
  } catch (e) {
    logFailure("getUserAsReseller", e);
    return null;
  }
}

/**
 * Admin API — move whole credits into (positive) or out of (negative) an
 * account. The Engine refuses `0` and fractions, so the amount is floored
 * and a zero move is reported as success without a call.
 */
export async function adjustCredits(
  xuiUserId: string,
  credits: number,
  reason: string
): Promise<boolean> {
  const id = toId(xuiUserId);
  if (!id) return false;

  const creditAmount = Math.floor(credits);
  if (creditAmount === 0) return true;

  const actionText =
    creditAmount > 0 ? `+${creditAmount}` : `-${Math.abs(creditAmount)}`;
  const finalReason = `${reason} (${actionText} credits)`;

  try {
    await adminCall<EngineUser>("users.adjust_credits", {
      id,
      credits: creditAmount,
      reason: finalReason,
    });
    return true;
  } catch (e) {
    logFailure("adjustCredits", e);
    return false;
  }
}
