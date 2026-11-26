/**
 * Node storage adapter: better-sqlite3 over a local file. Creates the schema
 * on first open and applies the additive migrations older databases need.
 * Only `src/index.ts` imports this module — it must never reach the Worker
 * bundle, which has no filesystem or native modules.
 */
import Database from "better-sqlite3";
import { STATEMENTS, normaliseParams, type AppDb, type SqlParam, type Stmt } from "./statements.js";

export function initDb(path: string): AppDb {
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
    CREATE TABLE IF NOT EXISTS renewal_requests (
      telegram_id INTEGER NOT NULL,
      xui_line_id TEXT NOT NULL,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (telegram_id, xui_line_id)
    );
  `);

  // Migrations for existing databases
  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "xui_api_key")) {
    db.exec("ALTER TABLE users ADD COLUMN xui_api_key TEXT");
  }
  if (!userCols.some((c) => c.name === "permissions")) {
    db.exec("ALTER TABLE users ADD COLUMN permissions TEXT");
  }

  // Drop obsolete customer_lines table if it exists (replaced by customer_claims)
  db.exec("DROP TABLE IF EXISTS customer_lines");

  const userColNames = userCols.map((c) => c.name);
  if (!userColNames.includes("last_accessed")) {
    db.exec("ALTER TABLE users ADD COLUMN last_accessed TEXT");
  }
  if (!userColNames.includes("xui_username")) {
    db.exec("ALTER TABLE users ADD COLUMN xui_username TEXT");
  }
  if (!userColNames.includes("last_auth_date")) {
    db.exec("ALTER TABLE users ADD COLUMN last_auth_date INTEGER");
  }
  if (!userColNames.includes("reseller_group_chat_id")) {
    db.exec("ALTER TABLE users ADD COLUMN reseller_group_chat_id INTEGER");
  }

  const paymentCols = db.prepare("PRAGMA table_info(payments)").all() as { name: string }[];
  if (!paymentCols.some((c) => c.name === "checkout_url")) {
    db.exec("ALTER TABLE payments ADD COLUMN checkout_url TEXT");
  }
  if (!paymentCols.some((c) => c.name === "status_message_id")) {
    db.exec("ALTER TABLE payments ADD COLUMN status_message_id INTEGER");
  }

  // Thread → customer lookups used to come from an in-memory map; both runtimes
  // now read the table, so give it an index.
  db.exec("CREATE INDEX IF NOT EXISTS idx_support_topics_thread ON support_topics(thread_id)");

  const prepared = Object.fromEntries(
    Object.entries(STATEMENTS).map(([name, sql]) => {
      const stmt = db.prepare(sql);
      const wrapped: Stmt = {
        async get<T>(...params: SqlParam[]) {
          return stmt.get(...normaliseParams(params)) as T | undefined;
        },
        async all<T>(...params: SqlParam[]) {
          return stmt.all(...normaliseParams(params)) as T[];
        },
        async run(...params: SqlParam[]) {
          return { changes: stmt.run(...normaliseParams(params)).changes };
        },
      };
      return [name, wrapped];
    })
  ) as { [K in keyof typeof STATEMENTS]: Stmt };

  const deleteUserCascadeTx = db.transaction((telegramId: number) => ({
    payments: db.prepare(STATEMENTS.deleteUserPayments).run(telegramId).changes,
    users: db.prepare(STATEMENTS.deleteUserRow).run(telegramId).changes,
  }));

  return {
    ...prepared,
    async deleteUserCascade(telegramId: number) {
      return deleteUserCascadeTx(telegramId);
    },
  };
}
