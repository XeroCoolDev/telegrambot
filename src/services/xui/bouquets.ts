import type { XuiLine } from "./types.js";
import { getLine, getLineAsReseller, editLine } from "./lines.js";

const XUI_ADULT_BOUQUET_IDS = new Set(
  (process.env.XUI_ADULT_BOUQUET_IDS || "").split(",").map((s) => s.trim()).filter(Boolean)
);

export function hasAdultBouquets(line: XuiLine): boolean {
  if (XUI_ADULT_BOUQUET_IDS.size === 0) return false;
  const bouquets: (string | number)[] = JSON.parse(line.bouquet || "[]");
  return bouquets.some((id) => XUI_ADULT_BOUQUET_IDS.has(String(id)));
}

function withAdultBouquets(line: XuiLine, enable: boolean): number[] {
  const bouquets: (string | number)[] = JSON.parse(line.bouquet || "[]");
  if (enable) {
    const existing = new Set(bouquets.map(String));
    const toAdd = [...XUI_ADULT_BOUQUET_IDS].filter((id) => !existing.has(id));
    return [...bouquets, ...toAdd].map(Number);
  }
  return bouquets.filter((id) => !XUI_ADULT_BOUQUET_IDS.has(String(id))).map(Number);
}

/**
 * Admin API — add or remove the adult bouquets on a line. Done with the
 * admin key because the Reseller API only accepts bouquets that belong to
 * the line's package, which the adult pack usually does not. The caller
 * is responsible for checking the line is theirs first.
 */
export async function toggleAdultContentAsAdmin(
  lineId: string,
  enable: boolean
): Promise<boolean> {
  if (XUI_ADULT_BOUQUET_IDS.size === 0) return false;
  const lineData = await getLine(lineId);
  if (!lineData) return false;
  return editLine(lineId, { bouquet_ids: withAdultBouquets(lineData, enable) });
}

/**
 * Reseller-initiated toggle: the reseller's key proves the line is in
 * their tree (the Engine answers 404 otherwise), then the change itself is
 * made as admin.
 */
export async function toggleAdultContent(
  resellerApiKey: string,
  lineId: string,
  enable: boolean
): Promise<boolean> {
  if (XUI_ADULT_BOUQUET_IDS.size === 0) return false;
  const owned = await getLineAsReseller(resellerApiKey, lineId);
  if (!owned) return false;
  return toggleAdultContentAsAdmin(lineId, enable);
}
