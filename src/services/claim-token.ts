import { createHmac } from "node:crypto";

/**
 * Signed claim tokens for customer deep-links.
 *
 * Format: `c<lineId>_<sig8>` where sig8 is the first 8 hex chars of
 * HMAC-SHA256(lineId, XPOSED_BOT_TOKEN). Fits well within Telegram's
 * 64-char deep-link payload limit.
 *
 * Security model: only our backend (which has the bot token) can mint a
 * valid signature. A customer forwarding the link to someone else isn't
 * a concern — the first TG user who taps it claims the line, which is
 * the intended behavior.
 */

function secret(): string {
  const t = process.env.XPOSED_BOT_TOKEN;
  if (!t) throw new Error("XPOSED_BOT_TOKEN not set");
  return t;
}

export function generateClaimToken(lineId: string): string {
  const sig = createHmac("sha256", secret()).update(String(lineId)).digest("hex").slice(0, 8);
  return `c${lineId}_${sig}`;
}

/** Returns the lineId if the token is valid, else null. */
export function verifyClaimToken(token: string): string | null {
  if (!token || !token.startsWith("c")) return null;
  const body = token.slice(1);
  const idx = body.lastIndexOf("_");
  if (idx <= 0) return null;

  const lineId = body.slice(0, idx);
  const sig = body.slice(idx + 1);
  if (!/^\d+$/.test(lineId)) return null;

  const expected = createHmac("sha256", secret()).update(lineId).digest("hex").slice(0, 8);
  // timing-safe compare not critical here (8 hex chars, low-value target)
  return sig === expected ? lineId : null;
}
