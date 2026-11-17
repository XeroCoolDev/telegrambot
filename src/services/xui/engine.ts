/**
 * Raw XUI.live Engine objects (https://xui.live/docs/api/) and the mappers
 * that turn them into the bot's internal XuiUser / XuiLine / XuiPackage
 * shapes. Those shapes predate the Engine (they mirror xui.one's API) and
 * are what every route, bot handler and the scheduler consume, so the
 * Engine is adapted here rather than everywhere.
 *
 * Fields are optional because `fields=` trims list rows to what was asked
 * for, and the Reseller API omits administrator-only fields.
 */
import type { XuiUser, XuiLine, XuiPackage } from "./types.js";

export interface EngineUser {
  id: number;
  username?: string;
  email?: string | null;
  owner_id?: number | null;
  role?: "admin" | "reseller" | null;
  status?: "active" | "disabled";
  enabled?: boolean;
  credits?: number;
  dns?: string | null;
  notes?: string | null;
  line_count?: number;
  created_at?: number;
  package_prices?: Record<string, number>;
}

export interface EngineLine {
  id: number;
  username?: string;
  password?: string;
  owner_id?: number;
  package_id?: number | null;
  status?: "active" | "disabled" | "banned" | "expired" | "trial";
  enabled?: boolean;
  banned?: boolean;
  is_trial?: boolean;
  max_connections?: number;
  active_connections?: number;
  online?: boolean;
  last_activity?: number | null;
  expires_at?: number | null;
  created_at?: number;
  bouquet_ids?: number[];
  notes?: string | null;
  admin_notes?: string | null;
  contact?: string | null;
  outputs?: string[];
  forced_server_id?: number | null;
  last_ip?: string | null;
}

export interface EngineSubscription {
  credits: number;
  duration: number;
  duration_unit: "hours" | "days" | "months" | "years";
}

export interface EnginePackage {
  id: number;
  name?: string;
  addon?: boolean;
  types?: string[];
  official?: EngineSubscription | null;
  trial?: EngineSubscription | null;
  max_connections?: number;
  bouquet_ids?: number[];
}

/**
 * The Engine never returns an account's API key, so `api_key` is whatever
 * the caller already holds (the key the reseller gave us), or "".
 */
export function toXuiUser(u: EngineUser, apiKey = ""): XuiUser {
  return {
    id: String(u.id),
    username: u.username ?? "",
    credits: String(u.credits ?? 0),
    api_key: apiKey,
    reseller_dns: u.dns ?? "",
  };
}

export function toXuiLine(l: EngineLine): XuiLine {
  const enabled = l.enabled ?? l.status !== "disabled";
  const banned = l.banned ?? l.status === "banned";
  return {
    id: String(l.id),
    username: l.username ?? "",
    password: l.password ?? "",
    exp_date: l.expires_at ?? null,
    max_connections: String(l.max_connections ?? 1),
    bouquet: JSON.stringify(l.bouquet_ids ?? []),
    allowed_outputs: JSON.stringify(l.outputs ?? []),
    member_id: String(l.owner_id ?? 0),
    admin_notes: l.admin_notes ?? "",
    reseller_notes: l.notes ?? "",
    contact: l.contact ?? "",
    force_server_id: String(l.forced_server_id ?? 0),
    is_trial: l.is_trial ? "1" : "0",
    last_ip: l.last_ip ?? null,
    enabled: enabled ? "1" : "0",
    admin_enabled: banned ? "0" : "1",
    status: enabled && !banned ? 1 : 0,
    created_at: String(l.created_at ?? ""),
  };
}

/**
 * Only packages with a paid subscription are sellable through the bot;
 * a trial-only package maps to null and is dropped by the caller.
 */
export function toXuiPackage(p: EnginePackage): XuiPackage | null {
  if (!p.official) return null;
  return {
    id: String(p.id),
    package_name: p.name ?? "",
    official_credits: String(p.official.credits),
    official_duration: String(p.official.duration),
    official_duration_in: p.official.duration_unit,
    max_connections: String(p.max_connections ?? 1),
    is_trial: "0",
  };
}
