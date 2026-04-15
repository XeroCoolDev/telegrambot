import Database from "better-sqlite3";
import crypto from "crypto";

export interface DbUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  xui_user_id: string | null;
  xui_api_key: string | null;
  permissions: string | null;
  created_at: string;
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
  created_at: string;
}

export interface DbCustomer {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  created_at: string;
}

export interface DbCustomerLine {
  id: number;
  customer_telegram_id: number;
  xui_line_id: string;
  reseller_xui_user_id: string;
  token: string;
  notes: string | null;
  created_at: string;
}

export type AppDb = ReturnType<typeof initDb>;

export function initDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      xui_user_id TEXT,
      xui_api_key TEXT,
      permissions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL REFERENCES users(telegram_id),
      btcpay_invoice_id TEXT UNIQUE NOT NULL,
      credits INTEGER NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      item_title TEXT NOT NULL,
      xui_user_id TEXT NOT NULL,
      checkout_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS customers (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS customer_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_telegram_id INTEGER,
      xui_line_id TEXT NOT NULL,
      reseller_xui_user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(xui_line_id)
    );
    CREATE TABLE IF NOT EXISTS support_topics (
      customer_telegram_id INTEGER PRIMARY KEY,
      thread_id INTEGER NOT NULL,
      last_activity TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS relayed_messages (
      group_msg_id INTEGER PRIMARY KEY,
      customer_telegram_id INTEGER NOT NULL,
      customer_msg_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS customer_claims (
      telegram_id INTEGER NOT NULL,
      xui_line_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (telegram_id, xui_line_id)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_claims_tg ON customer_claims(telegram_id);
  `);

  // Migrations for existing databases
  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "xui_api_key")) {
    db.exec("ALTER TABLE users ADD COLUMN xui_api_key TEXT");
  }
  if (!userCols.some((c) => c.name === "permissions")) {
    db.exec("ALTER TABLE users ADD COLUMN permissions TEXT");
  }

  const clCols = db.prepare("PRAGMA table_info(customer_lines)").all() as { name: string }[];
  if (clCols.length > 0 && !clCols.some((c) => c.name === "notes")) {
    db.exec("ALTER TABLE customer_lines ADD COLUMN notes TEXT");
  }

  const paymentCols = db.prepare("PRAGMA table_info(payments)").all() as { name: string }[];
  if (!paymentCols.some((c) => c.name === "checkout_url")) {
    db.exec("ALTER TABLE payments ADD COLUMN checkout_url TEXT");
  }

  // Prepared statements
  const stmts = {
    // ── Reseller users ──
    getUser: db.prepare<[number]>("SELECT * FROM users WHERE telegram_id = ?"),
    upsertUser: db.prepare(`
      INSERT INTO users (telegram_id, username, first_name)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name
    `),
    linkXui: db.prepare("UPDATE users SET xui_user_id = ?, xui_api_key = ? WHERE telegram_id = ?"),
    updatePermissions: db.prepare("UPDATE users SET permissions = ? WHERE telegram_id = ?"),
    getAllLinkedUsers: db.prepare("SELECT * FROM users WHERE xui_user_id IS NOT NULL"),

    // ── Payments ──
    insertPayment: db.prepare(`
      INSERT INTO payments (telegram_id, btcpay_invoice_id, credits, amount, currency, item_title, xui_user_id, checkout_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `),
    getPayment: db.prepare<[string]>("SELECT * FROM payments WHERE btcpay_invoice_id = ?"),
    getLastSettledPayment: db.prepare<[number]>(
      "SELECT * FROM payments WHERE telegram_id = ? AND status = 'settled' ORDER BY created_at DESC LIMIT 1"
    ),
    getPendingPayments: db.prepare<[number]>(
      "SELECT * FROM payments WHERE telegram_id = ? AND status = 'pending' AND created_at > datetime('now', '-24 hours') ORDER BY created_at DESC"
    ),
    expireOldPending: db.prepare(
      "UPDATE payments SET status = 'expired' WHERE status = 'pending' AND created_at <= datetime('now', '-24 hours')"
    ),
    updatePaymentStatus: db.prepare("UPDATE payments SET status = ? WHERE btcpay_invoice_id = ?"),

    // ── Customers ──
    upsertCustomer: db.prepare(`
      INSERT INTO customers (telegram_id, username, first_name)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name
    `),
    getCustomer: db.prepare<[number]>("SELECT * FROM customers WHERE telegram_id = ?"),

    // ── Customer lines ──
    createCustomerToken: db.prepare(`
      INSERT INTO customer_lines (xui_line_id, reseller_xui_user_id, token)
      VALUES (?, ?, ?)
      ON CONFLICT(xui_line_id) DO UPDATE SET
        token = excluded.token
    `),
    getCustomerLineByToken: db.prepare<[string]>("SELECT * FROM customer_lines WHERE token = ?"),
    linkCustomerToLine: db.prepare("UPDATE customer_lines SET customer_telegram_id = ? WHERE token = ?"),
    getCustomerLines: db.prepare<[number]>("SELECT * FROM customer_lines WHERE customer_telegram_id = ?"),
    getCustomerLineByLineId: db.prepare<[string]>("SELECT * FROM customer_lines WHERE xui_line_id = ?"),
    getUserByXuiId: db.prepare<[string]>("SELECT * FROM users WHERE xui_user_id = ?"),
    updateCustomerLineNotes: db.prepare("UPDATE customer_lines SET notes = ? WHERE xui_line_id = ? AND customer_telegram_id = ?"),

    // ── Support topics ──
    getSupportTopic: db.prepare<[number]>("SELECT * FROM support_topics WHERE customer_telegram_id = ?"),
    upsertSupportTopic: db.prepare(`
      INSERT INTO support_topics (customer_telegram_id, thread_id)
      VALUES (?, ?)
      ON CONFLICT(customer_telegram_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        last_activity = datetime('now')
    `),
    touchSupportTopic: db.prepare("UPDATE support_topics SET last_activity = datetime('now') WHERE customer_telegram_id = ?"),
    getStaleTopics: db.prepare(
      "SELECT * FROM support_topics WHERE last_activity <= datetime('now', '-48 hours')"
    ),
    deleteSupportTopic: db.prepare("DELETE FROM support_topics WHERE customer_telegram_id = ?"),

    // ── Customer claims (tg id ↔ xui line) ──
    claimLine: db.prepare(
      "INSERT OR IGNORE INTO customer_claims (telegram_id, xui_line_id) VALUES (?, ?)"
    ),
    unclaimLine: db.prepare(
      "DELETE FROM customer_claims WHERE telegram_id = ? AND xui_line_id = ?"
    ),
    getClaimedLineIds: db.prepare<[number]>(
      "SELECT xui_line_id FROM customer_claims WHERE telegram_id = ?"
    ),
    getAllClaimsWithCustomer: db.prepare(
      `SELECT cc.xui_line_id, cc.telegram_id, c.username, c.first_name
       FROM customer_claims cc
       LEFT JOIN customers c ON c.telegram_id = cc.telegram_id`
    ),
    getClaimsForLine: db.prepare<[string]>(
      `SELECT cc.telegram_id, c.username, c.first_name, cc.created_at
       FROM customer_claims cc
       LEFT JOIN customers c ON c.telegram_id = cc.telegram_id
       WHERE cc.xui_line_id = ?
       ORDER BY cc.created_at`
    ),
    isLineClaimedBy: db.prepare<[number, string]>(
      "SELECT 1 FROM customer_claims WHERE telegram_id = ? AND xui_line_id = ?"
    ),
    getLineClaimedByOther: db.prepare<[string, number]>(
      "SELECT telegram_id FROM customer_claims WHERE xui_line_id = ? AND telegram_id != ? LIMIT 1"
    ),
    unclaimAllForTelegram: db.prepare<[number]>(
      "DELETE FROM customer_claims WHERE telegram_id = ?"
    ),

    // ── Relayed messages (for /delete) ──
    recordRelayedMessage: db.prepare(
      "INSERT OR REPLACE INTO relayed_messages (group_msg_id, customer_telegram_id, customer_msg_id) VALUES (?, ?, ?)"
    ),
    getRelayedMessage: db.prepare<[number]>(
      "SELECT customer_telegram_id, customer_msg_id FROM relayed_messages WHERE group_msg_id = ?"
    ),
    getGroupMsgByCustomerMsg: db.prepare<[number, number]>(
      "SELECT group_msg_id FROM relayed_messages WHERE customer_telegram_id = ? AND customer_msg_id = ?"
    ),
    deleteRelayedMessage: db.prepare("DELETE FROM relayed_messages WHERE group_msg_id = ?"),
  };

  return { db, ...stmts };
}

export function generateToken(): string {
  return crypto.randomBytes(16).toString("hex");
}
