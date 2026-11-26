#!/usr/bin/env sh
# Export the Docker build's SQLite data as INSERT statements for D1.
#
#   ./export-sqlite.sh /opt/telegrambot/data/bot.db > data.sql
#   wrangler d1 execute BOT_DB --remote --file=data.sql
#
# Columns are listed explicitly, in the order migrations/0001_init.sql
# declares them: the live bot.db gained columns through ALTER TABLE over
# time, so its physical column order differs from a fresh schema and a
# plain `.dump` would misalign them. Payments whose user row is gone are
# skipped — D1 enforces the foreign key.
set -eu
DB=${1:?usage: export-sqlite.sh <path to bot.db>}

q() { sqlite3 "$DB" ".mode insert $1" "$2"; }

q users "SELECT telegram_id, username, first_name, xui_user_id, xui_api_key, xui_username,
                permissions, created_at, last_accessed, last_auth_date, reseller_group_chat_id
         FROM users"
q payments "SELECT p.id, p.telegram_id, p.btcpay_invoice_id, p.credits, p.amount, p.currency,
                   p.item_title, p.xui_user_id, p.checkout_url, p.status, p.status_message_id, p.created_at
            FROM payments p JOIN users u ON u.telegram_id = p.telegram_id"
q customers "SELECT telegram_id, username, first_name, created_at FROM customers"
q support_topics "SELECT customer_telegram_id, thread_id, last_activity FROM support_topics"
q relayed_messages "SELECT group_msg_id, customer_telegram_id, customer_msg_id, created_at FROM relayed_messages"
q customer_claims "SELECT telegram_id, xui_line_id, created_at FROM customer_claims"
q renewal_requests "SELECT telegram_id, xui_line_id, requested_at FROM renewal_requests"
