/**
 * Row types and helpers shared by every runtime. The storage driver is chosen
 * by the entrypoint: `src/index.ts` (Node) opens SQLite through `./sqlite.js`,
 * `src/worker.ts` (Cloudflare Workers) wraps a D1 binding through `./d1.js`.
 * Nothing else imports a driver.
 */

export type { AppDb, Stmt, SqlParam, StatementName } from "./statements.js";

export interface DbUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  xui_user_id: string | null;
  xui_api_key: string | null;
  xui_username: string | null;
  permissions: string | null;
  created_at: string;
  last_accessed: string | null;
  last_auth_date: number | null;
  reseller_group_chat_id: number | null;
}

export interface UserPermissions {
  canCreateLine: boolean;
  canDeleteLine: boolean;
  canBuyCredits: boolean;
  canToggleAdult: boolean;
}

export const DEFAULT_PERMISSIONS: UserPermissions = {
  canCreateLine: true,
  canDeleteLine: true,
  canBuyCredits: true,
  canToggleAdult: true,
};

export function parsePermissions(json: string | null): UserPermissions {
  if (!json) return { ...DEFAULT_PERMISSIONS };
  try {
    return { ...DEFAULT_PERMISSIONS, ...JSON.parse(json) };
  } catch {
    return { ...DEFAULT_PERMISSIONS };
  }
}

export interface DbPayment {
  id: number;
  telegram_id: number;
  btcpay_invoice_id: string;
  credits: number;
  amount: string;
  currency: string;
  item_title: string;
  xui_user_id: string;
  checkout_url: string | null;
  status: string;
  status_message_id: number | null;
  created_at: string;
}
