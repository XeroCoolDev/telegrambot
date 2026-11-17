import type { XuiPackage } from "./types.js";
import type { EnginePackage } from "./engine.js";
import { toXuiPackage } from "./engine.js";
import { adminList, logFailure } from "./client.js";

/**
 * Admin API — packages sold for lines that carry a paid subscription, at
 * base price. (What a given reseller pays is in that account's own
 * package_prices; the bot has always quoted the base price.)
 */
export async function getPackages(): Promise<XuiPackage[]> {
  try {
    const rows = await adminList<EnginePackage>("packages.list", { type: "line" });
    return rows
      .map(toXuiPackage)
      .filter((p): p is XuiPackage => p !== null);
  } catch (e) {
    logFailure("getPackages", e);
    return [];
  }
}
