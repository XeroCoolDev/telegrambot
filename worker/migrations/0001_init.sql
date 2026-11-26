-- Schema as src/db/sqlite.ts leaves it after every migration, in one step.
-- Column order matters: export-sqlite.sh emits positional INSERTs in this order.
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  xui_user_id TEXT,
  xui_api_key TEXT,
  xui_username TEXT,
  permissions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT,
  last_auth_date INTEGER,
  reseller_group_chat_id INTEGER
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
  status_message_id INTEGER,
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
CREATE INDEX IF NOT EXISTS idx_support_topics_thread ON support_topics(thread_id);

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
