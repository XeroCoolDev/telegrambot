import type { XuiLine, ConnectionOption } from "./types.js";
import { normaliseExpDate } from "./format.js";
import { editLine } from "./lines.js";

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

/**
 * Calculate available connection upgrade options with dynamic pricing.
 * - Discount applies if ≤CONN_DISCOUNT_MONTHS remaining
 * - Multiplier applies if >CONN_MULTIPLIER_MONTHS remaining (ceil of monthsRemaining / N)
 */
export function getConnectionUpgradeOptions(line: XuiLine): ConnectionOption[] {
  const currentConns = parseInt(line.max_connections, 10) || 1;
  if (currentConns >= MAX_CONNECTIONS) return [];

  const now = new Date();
  const expTs = normaliseExpDate(line.exp_date);
  const expiryDate = expTs ? new Date(expTs * 1000) : now;

  const discountThreshold = new Date();
  discountThreshold.setMonth(now.getMonth() + CONN_DISCOUNT_MONTHS);
  const isDiscounted = expiryDate <= discountThreshold;

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

/** Admin API — upgrade max_connections on a line (reseller can't change this field) */
export async function upgradeConnections(
  lineId: string,
  newConnections: number
): Promise<boolean> {
  return editLine(lineId, { max_connections: String(newConnections) });
}
