import type { XuiLine } from "./types.js";
import { timedFetch, buildResellerEditParams } from "./client.js";
import { getLineAsReseller } from "./lines.js";

const XUI_ADULT_BOUQUET_IDS = new Set(
  (process.env.XUI_ADULT_BOUQUET_IDS || "").split(",").map((s) => s.trim()).filter(Boolean)
);

export function hasAdultBouquets(line: XuiLine): boolean {
  if (XUI_ADULT_BOUQUET_IDS.size === 0) return false;
  const bouquets: (string | number)[] = JSON.parse(line.bouquet || "[]");
  return bouquets.some((id) => XUI_ADULT_BOUQUET_IDS.has(String(id)));
}

export async function toggleAdultContent(
  resellerApiKey: string,
  lineId: string,
  enable: boolean
): Promise<boolean> {
  if (XUI_ADULT_BOUQUET_IDS.size === 0) return false;

  const lineData = await getLineAsReseller(resellerApiKey, lineId);
  if (!lineData) return false;

  const bouquets: (string | number)[] = JSON.parse(lineData.bouquet || "[]");
  let updated: (string | number)[];

  if (enable) {
    const existing = new Set(bouquets.map(String));
    const toAdd = [...XUI_ADULT_BOUQUET_IDS].filter((id) => !existing.has(id)).map(Number);
    updated = [...bouquets, ...toAdd];
  } else {
    updated = bouquets.filter((id) => !XUI_ADULT_BOUQUET_IDS.has(String(id)));
  }

  // Build params and override the auto-appended bouquet with the updated list
  const params = buildResellerEditParams(resellerApiKey, lineData);
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
