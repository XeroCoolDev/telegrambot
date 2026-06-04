import type { XuiLine } from "./types.js";

/** Normalise enabled state across get_lines (enabled field) and get_line (status field) */
export function isLineEnabled(line: XuiLine): boolean {
  if (line.enabled !== undefined) return String(line.enabled) === "1" && String(line.admin_enabled) === "1";
  return line.status === 1;
}

/** Normalise exp_date to number (XUI returns string from get_lines, number from get_line) */
export function normaliseExpDate(expDate: string | number | null): number | null {
  if (expDate === null || expDate === undefined || expDate === "" || expDate === "0" || expDate === 0) return null;
  return Number(expDate);
}

/** Format for XUI API (YYYY-MM-DD HH:MM:SS) */
export function formatApiDate(timestamp: string | number | null): string {
  const ts = normaliseExpDate(timestamp);
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** Display date only (e.g. "14 Apr 2026") */
export function formatExpiry(expDate: string | number | null): string {
  const ts = normaliseExpDate(expDate);
  if (!ts) return "Unlimited";
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Display date + time */
export function formatExpiryWithTime(expDate: string | number | null): string {
  const ts = normaliseExpDate(expDate);
  if (!ts) return "Unlimited";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysUntilExpiry(expDate: string | number | null): number | null {
  const ts = normaliseExpDate(expDate);
  if (!ts) return null;
  const expDay = new Date(ts * 1000);
  expDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((expDay.getTime() - today.getTime()) / 86400000);
}
