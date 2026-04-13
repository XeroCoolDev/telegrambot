# API & Architecture Reference

## Bot Commands (grammY)

| Command | Access | Description |
|---------|--------|-------------|
| `/start` | All | Upserts user in DB; shows dashboard button if linked, else shows Telegram ID |
| `/credits` | Linked | Fetches live credit balance from XUI, shows "Buy Credits" button |
| `/status` | Linked | Shows "View Subscriptions" button to dashboard |
| `/link <tg_id> <xui_id>` | Admin | Links a Telegram user to an XUI account (verifies XUI user exists first) |

---

## Hono API Endpoints (port 3000)

### Authentication
All `/api/*` routes require header `X-Telegram-Init-Data` validated via HMAC-SHA256 chain against `BOT_TOKEN`. Returns 401 if missing/invalid, 403 if user not in DB. Sets `telegramId` and `xuiUserId` in context.

### Authenticated Routes

| Method | Path | Body | Returns | Description |
|--------|------|------|---------|-------------|
| GET | `/api/me` | — | `{ linked, credits?, xuiUsername? }` | Current user info from XUI |
| GET | `/api/subscriptions` | — | `Subscription[]` | User's lines: id, username, status, expDate, daysLeft, maxConnections |
| GET | `/api/packages` | — | `XuiPackage[]` | Available packages: id, name, credits, duration, durationUnit, maxConnections |
| GET | `/api/credit-options` | — | `{ currency, items[] }` | BTCPay POS credit packages (cached 1hr) |
| POST | `/api/buy-credits` | `{ itemId, credits, price, itemTitle }` | `{ invoiceId, checkoutUrl }` | Creates BTCPay invoice, tracks payment in DB |
| POST | `/api/lines/extend` | `{ lineId, packageId }` | `{ success }` | Hybrid flow: reseller applies package, admin sets expiry |
| POST | `/api/lines/create` | `{ packageId, resellerNotes?, contact? }` | `{ success, lineId }` | Creates new line via reseller API |

### Unauthenticated Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks/btcpay` | `BTCPAY-SIG` HMAC header | Handles InvoiceSettled (adds credits, notifies user) and InvoiceExpired |
| GET | `/*` | None | Serves Vue SPA from `/dist/public`, fallback to `index.html` |

---

## XUI API Calls (src/services/xui.ts)

**Format:** All XUI APIs use query-string `?action=X`, NOT REST paths.
**Response:** `{ status: "STATUS_SUCCESS", data: {...} }` (get_packages returns raw array)

### Admin API (api.php)

| Function | Action | Query Params |
|----------|--------|-------------|
| `getUser(id)` | `get_user` | `api_key, action, id` |
| `getLine(id)` | `get_line` | `api_key, action, id` |
| `getUserLines(id)` | `get_lines` | `api_key, action, id` |
| `getPackages()` | `get_packages` | `api_key, action` |
| `adjustCredits(id, credits, reason)` | `adjust_credits` | `api_key, action, id, credits, reason` |
| `editLine(id, options)` | `edit_line` | `api_key, action, id, exp_date?, max_connections?` |

### Reseller API (api-reseller.php)

| Function | Action | Query Params |
|----------|--------|-------------|
| `createNewLine(userApiKey, packageId, ...)` | `create_line` | `api_key (user's), action, package, reseller_notes?, contact?` |
| `extendLineHybrid()` step 1 | `edit_line` | `api_key (user's), action, id, package` |

### Helper Functions
- `formatApiDate(timestamp)` → `YYYY-MM-DD` (for XUI API)
- `formatExpiry(expDate)` → `DD Mon YYYY` (for display)
- `daysUntilExpiry(expDate)` → `number | null`
- `timedFetch(url, opts)` → fetch with AbortController timeout

---

## BTCPay API Calls (src/services/btcpay.ts)

**Auth:** `Authorization: token {BTCPAY_API_KEY}`

| Function | Method | BTCPay Endpoint | Description |
|----------|--------|----------------|-------------|
| `fetchPosApp()` | GET | `/api/v1/apps/pos/{POS_APP_ID}` | Credit packages (cached 1hr) |
| `createInvoice(params)` | POST | `/api/v1/stores/{STORE_ID}/invoices` | Creates checkout invoice |
| `verifyWebhookSignature(body, sig)` | — | — | HMAC-SHA256 validation |

---

## Database Schema (SQLite)

### users
| Column | Type | Notes |
|--------|------|-------|
| telegram_id | INTEGER | PK |
| username | TEXT | |
| first_name | TEXT | |
| xui_user_id | TEXT | NULL until admin links |
| created_at | TEXT | datetime('now') |

### payments
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | PK AUTOINCREMENT |
| telegram_id | INTEGER | FK → users |
| btcpay_invoice_id | TEXT | UNIQUE |
| credits | INTEGER | |
| amount | TEXT | |
| currency | TEXT | |
| item_title | TEXT | |
| xui_user_id | TEXT | |
| status | TEXT | pending → settled/expired |
| created_at | TEXT | datetime('now') |

### Prepared Statements
- `getUser(telegramId)` — lookup by telegram_id
- `upsertUser(telegramId, username, firstName)` — insert or update
- `linkXui(xuiUserId, telegramId)` — set xui_user_id
- `getAllLinkedUsers()` — all users with xui_user_id
- `insertPayment(...)` — new payment record
- `getPayment(invoiceId)` — lookup by btcpay_invoice_id
- `updatePaymentStatus(status, invoiceId)` — mark settled/expired

---

## Scheduler (src/scheduler/index.ts)

**Daily Expiry Reminder** — cron expression from `REMINDER_CRON` (default `0 9 * * *`)
- Checks all linked users' lines against `REMINDER_DAYS_BEFORE` (default 7,3,1)
- Sends Telegram message with severity emoji (📅 / ⚠️ / 🚨)
- In-memory dedup prevents duplicate reminders same day

---

## Mini App Routes (Vue 3 SPA)

| Route | View | Purpose |
|-------|------|---------|
| `/` | Dashboard | Credits, action buttons, active lines list |
| `/buy` | BuyCredits | BTCPay POS items, create invoice, open checkout |
| `/line/:id` | LineDetails | Line info, expiry, extend button |
| `/extend/:lineId` | ExtendLine | Package selection, credit spend, apply |
| `/create` | CreateLine | Package selection, create new line |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token |
| `WEBAPP_URL` | Mini app URL (e.g. `https://telegrambot.domain.tld`) |
| `XUI_ADMIN_API_URL` | XUI admin API (`api.php`) |
| `XUI_ADMIN_API_KEY` | XUI admin API key |
| `XUI_RESELLER_API_URL` | XUI reseller API (`api-reseller.php`) |
| `BTCPAY_URL` | BTCPay server URL |
| `BTCPAY_API_KEY` | BTCPay API key |
| `BTCPAY_STORE_ID` | BTCPay store ID |
| `BTCPAY_POS_APP_ID` | BTCPay POS app ID (credit packages) |
| `BTCPAY_WEBHOOK_SECRET` | BTCPay webhook HMAC secret |
| `DATABASE_PATH` | SQLite DB path (default `/app/data/bot.db`) |
| `API_TIMEOUT_MS` | Fetch timeout (default `10000`) |
| `REMINDER_CRON` | Cron expression (default `0 9 * * *`) |
| `REMINDER_DAYS_BEFORE` | Reminder trigger days (default `7,3,1`) |

---

## Key Flows

**Credit Purchase:** User selects package → BTCPay invoice created → User pays in BTC → Webhook fires `InvoiceSettled` → `adjustCredits()` on XUI → Bot notifies user

**Line Extension (Hybrid):** Reseller API applies package (deducts credits) → Admin API sets new expiry + max_connections

**User Linking:** User sends `/start` (recorded with null xui_user_id) → Admin sends `/link <tg_id> <xui_id>` → DB updated → User can access mini app
