/**
 * Every SQL statement the bot runs, keyed by name. Both storage adapters
 * (`sqlite.ts` for Node + better-sqlite3, `d1.ts` for Cloudflare Workers + D1)
 * prepare this same map, so routes, bots and the scheduler never see a driver.
 *
 * All statement methods are async on both runtimes: D1 is network-backed and
 * can only be awaited, so the SQLite adapter wraps its synchronous calls in
 * promises rather than keeping two call styles alive.
 */

export type SqlParam = string | number | boolean | null | undefined;

export interface Stmt {
  /** First matching row, or undefined. */
  get<T = unknown>(...params: SqlParam[]): Promise<T | undefined>;
  /** Every matching row. */
  all<T = unknown>(...params: SqlParam[]): Promise<T[]>;
  /** Execute a write; `changes` is the affected-row count. */
  run(...params: SqlParam[]): Promise<{ changes: number }>;
}

/** Drivers take string/number/null only: booleans become 1/0, undefined becomes NULL. */
export function normaliseParams(params: SqlParam[]): (string | number | null)[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p;
  });
}

export const STATEMENTS = {
  // ── Reseller users ──
  getUser: "SELECT * FROM users WHERE telegram_id = ?",
  upsertUser: `
    INSERT INTO users (telegram_id, username, first_name, last_accessed)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_accessed = datetime('now')
  `,
  refreshUserProfile: `
    UPDATE users SET
      username = ?,
      first_name = ?,
      last_auth_date = ?,
      last_accessed = datetime('now')
    WHERE telegram_id = ?
  `,
  linkXui: "UPDATE users SET xui_user_id = ?, xui_api_key = ?, xui_username = ? WHERE telegram_id = ?",
  updatePermissions: "UPDATE users SET permissions = ? WHERE telegram_id = ?",
  setResellerGroupChatId: "UPDATE users SET reseller_group_chat_id = ? WHERE telegram_id = ?",
  getAllLinkedUsers: "SELECT * FROM users WHERE xui_user_id IS NOT NULL",
  getUserByXuiId: "SELECT * FROM users WHERE xui_user_id = ? LIMIT 1",
  deleteUserPayments: "DELETE FROM payments WHERE telegram_id = ?",
  deleteUserRow: "DELETE FROM users WHERE telegram_id = ?",
  // Admin user list — every column the admin screen shows, newest first
  listUsersForAdmin: `
    SELECT telegram_id, username, first_name, xui_user_id, xui_api_key, xui_username,
           permissions, created_at, last_accessed, reseller_group_chat_id
    FROM users ORDER BY created_at DESC
  `,

  // ── Payments ──
  insertPayment: `
    INSERT INTO payments (telegram_id, btcpay_invoice_id, credits, amount, currency, item_title, xui_user_id, checkout_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `,
  getPayment: "SELECT * FROM payments WHERE btcpay_invoice_id = ?",
  getLastSettledPayment:
    "SELECT * FROM payments WHERE telegram_id = ? AND status = 'settled' ORDER BY created_at DESC LIMIT 1",
  getPendingPayments:
    "SELECT * FROM payments WHERE telegram_id = ? AND status IN ('pending', 'processing', 'settling') AND created_at > datetime('now', '-24 hours') ORDER BY created_at DESC",
  expireOldPending:
    "UPDATE payments SET status = 'expired' WHERE status = 'pending' AND created_at <= datetime('now', '-24 hours')",
  pruneTerminalPayments:
    "DELETE FROM payments WHERE status IN ('expired', 'invalid', 'failed') AND created_at <= datetime('now', '-90 days')",
  getPaymentHistory:
    "SELECT * FROM payments WHERE telegram_id = ? AND status IN ('settled', 'failed', 'expired', 'invalid') ORDER BY created_at DESC LIMIT 5",
  // Admin: one user's payment ledger, paged.
  // created_at only has second granularity, so id breaks ties — without a
  // total order LIMIT/OFFSET can skip or repeat rows across pages.
  getUserPaymentsPage: `
    SELECT btcpay_invoice_id, credits, amount, currency, item_title, status, created_at
    FROM payments
    WHERE telegram_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `,
  getUserPaymentsSummary: `
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'settled' THEN credits ELSE 0 END), 0) AS settledCredits
    FROM payments
    WHERE telegram_id = ?
  `,
  // Admin: last settled top-up per user, one grouped query instead of N lookups
  lastSettledTopUps: `
    SELECT telegram_id, credits, MAX(created_at) as created_at
    FROM payments
    WHERE status = 'settled'
    GROUP BY telegram_id
  `,
  listRecentPayments:
    "SELECT btcpay_invoice_id, telegram_id, credits, amount, currency, item_title, status, created_at FROM payments ORDER BY created_at DESC LIMIT 100",
  updatePaymentStatus: "UPDATE payments SET status = ? WHERE btcpay_invoice_id = ?",
  setPaymentStatusMessageId: "UPDATE payments SET status_message_id = ? WHERE btcpay_invoice_id = ?",
  // Atomic claim: transitions any non-terminal status → 'settling'. Only the
  // caller whose changes === 1 owns the settlement; others see 0 and bail.
  claimSettlement:
    "UPDATE payments SET status = 'settling' WHERE btcpay_invoice_id = ? AND status IN ('pending', 'processing')",

  // ── Customers ──
  upsertCustomer: `
    INSERT INTO customers (telegram_id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
  `,

  // ── Support topics ──
  getSupportTopic: "SELECT * FROM support_topics WHERE customer_telegram_id = ?",
  getCustomerByThread: "SELECT customer_telegram_id FROM support_topics WHERE thread_id = ?",
  upsertSupportTopic: `
    INSERT INTO support_topics (customer_telegram_id, thread_id)
    VALUES (?, ?)
    ON CONFLICT(customer_telegram_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      last_activity = datetime('now')
  `,
  touchSupportTopic: "UPDATE support_topics SET last_activity = datetime('now') WHERE customer_telegram_id = ?",
  deleteSupportTopic: "DELETE FROM support_topics WHERE customer_telegram_id = ?",

  // ── Customer claims (tg id ↔ xui line) ──
  claimLine: "INSERT OR IGNORE INTO customer_claims (telegram_id, xui_line_id) VALUES (?, ?)",
  unclaimLine: "DELETE FROM customer_claims WHERE telegram_id = ? AND xui_line_id = ?",
  getClaimedLineIds: "SELECT xui_line_id FROM customer_claims WHERE telegram_id = ?",
  getAllClaimsWithCustomer: `
    SELECT cc.xui_line_id, cc.telegram_id, c.username, c.first_name
    FROM customer_claims cc
    LEFT JOIN customers c ON c.telegram_id = cc.telegram_id
  `,
  getClaimsForLine: `
    SELECT cc.telegram_id, c.username, c.first_name, cc.created_at
    FROM customer_claims cc
    LEFT JOIN customers c ON c.telegram_id = cc.telegram_id
    WHERE cc.xui_line_id = ?
    ORDER BY cc.created_at
  `,
  isLineClaimedBy: "SELECT 1 FROM customer_claims WHERE telegram_id = ? AND xui_line_id = ?",
  getLineClaimedByOther:
    "SELECT telegram_id FROM customer_claims WHERE xui_line_id = ? AND telegram_id != ? LIMIT 1",
  unclaimAllForTelegram: "DELETE FROM customer_claims WHERE telegram_id = ?",

  // ── Relayed messages (for /delete) ──
  recordRelayedMessage:
    "INSERT OR REPLACE INTO relayed_messages (group_msg_id, customer_telegram_id, customer_msg_id) VALUES (?, ?, ?)",
  getRelayedMessage:
    "SELECT customer_telegram_id, customer_msg_id FROM relayed_messages WHERE group_msg_id = ?",
  getGroupMsgByCustomerMsg:
    "SELECT group_msg_id FROM relayed_messages WHERE customer_telegram_id = ? AND customer_msg_id = ?",
  deleteRelayedMessage: "DELETE FROM relayed_messages WHERE group_msg_id = ?",

  // ── Renewal requests (rate-limited) ──
  getRenewalRequest: "SELECT requested_at FROM renewal_requests WHERE telegram_id = ? AND xui_line_id = ?",
  upsertRenewalRequest: `
    INSERT INTO renewal_requests (telegram_id, xui_line_id) VALUES (?, ?)
    ON CONFLICT (telegram_id, xui_line_id) DO UPDATE SET requested_at = datetime('now')
  `,
} as const;

export type StatementName = keyof typeof STATEMENTS;

/**
 * What every consumer receives: one `Stmt` per statement name, plus the
 * multi-statement operations that need a transaction.
 */
export type AppDb = { [K in StatementName]: Stmt } & {
  /**
   * Remove a reseller from the bot's own records. Payments go first because
   * payments.telegram_id has a FK onto users.
   *
   * Deliberately scoped to this database — the user's panel account and every
   * line under it are left untouched, so the pairing can be re-created later
   * with /link. Customer-side tables (customers, customer_claims,
   * support_topics) key off customer Telegram IDs, a separate population, and
   * are not touched either.
   */
  deleteUserCascade(telegramId: number): Promise<{ payments: number; users: number }>;
};
