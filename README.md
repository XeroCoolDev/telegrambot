# Telegram Bot + Mini App — xui.one Manager

Telegram bot with an embedded Vue 3 mini app for managing xui.one subscriptions and purchasing credits via BTCPay. Runs on Saltbox behind Traefik.

## Architecture

```
┌─ Docker container (telegrambot) ─────────────────────────┐
│                                                           │
│  Bot (grammY)          API (Hono :3000)                   │
│  ├─ /start             ├─ GET  /api/me                    │
│  ├─ /credits           ├─ GET  /api/subscriptions         │
│  ├─ /status            ├─ GET  /api/packages              │
│  ├─ /link (admin)      ├─ GET  /api/credit-options        │
│  └─ daily reminders    ├─ POST /api/buy-credits           │
│     (node-cron)        ├─ POST /api/lines/extend          │
│                        ├─ POST /api/lines/create          │
│                        ├─ POST /webhooks/btcpay           │
│                        └─ /*   → Vue SPA (mini app)       │
│                                                           │
│  SQLite (better-sqlite3)                                  │
│  ├─ users: telegram_id ↔ xui_user_id mapping              │
│  └─ payments: BTCPay invoice tracking                     │
│                                                           │
└──── Traefik → telegrambot.yourdomain.tld ─────────────────┘
         │                    │
    XUI Admin API        BTCPay Server
    XUI Reseller API     (POS app for credit packages)
```

## User Flow

1. User sends `/start` → gets their Telegram ID → admin links via `/link <tg_id> <xui_id>`
2. Linked user sends `/start` → sees "Open Dashboard" WebApp button
3. Mini app opens → authenticated via Telegram `initData` (HMAC-SHA256)
4. **Dashboard** shows live credit balance + active lines from xui.one
5. **Buy Credits** → selects from BTCPay POS items → invoice created → pays
6. BTCPay webhook fires `InvoiceSettled` → `adjustCredits` on xui.one → bot confirms
7. **Extend/Create Line** → spends credits via xui.one reseller+admin hybrid API
8. **Daily reminders** → scheduler queries xui.one for expiring lines → sends at 7, 3, 1 days

## Mini App Views

| Route | View | Purpose |
|---|---|---|
| `/` | Dashboard | Credit balance, active lines list |
| `/buy` | BuyCredits | BTCPay POS items → create invoice |
| `/line/:id` | LineDetails | Line info, expiry, connections |
| `/extend/:lineId` | ExtendLine | Select package to extend |
| `/create` | CreateLine | Select package to create new line |

## XUI API

Uses query-string `action` params, not REST paths:

| Action | API | Endpoint |
|---|---|---|
| `get_user` | Admin | `?api_key=X&action=get_user&id=Y` |
| `get_line` | Admin | `?api_key=X&action=get_line&id=Y` |
| `get_lines` | Admin | `?api_key=X&action=get_lines&id=Y` |
| `get_packages` | Admin | `?api_key=X&action=get_packages` |
| `adjust_credits` | Admin | `?api_key=X&action=adjust_credits&id=Y&credits=N&reason=...` |
| `edit_line` | Admin | `?api_key=X&action=edit_line&id=Y&...` |
| `create_line` | Reseller | `?api_key=USER_KEY&action=create_line&package=Z` |
| `edit_line` | Reseller | `?api_key=USER_KEY&action=edit_line&id=Y&package=Z` |

**Line extension uses a hybrid flow**: reseller API applies the package (deducts credits), then admin API sets the actual expiry and max_connections.

Response format: `{ status: "STATUS_SUCCESS", data: {...} }` (except `get_packages` which returns a raw array).

## BTCPay

Credit packages come from a **POS app**, not xui.one:

- `GET /api/v1/apps/pos/{POS_APP_ID}` → items with title/price + currency
- `POST /api/v1/stores/{STORE_ID}/invoices` → creates invoice with metadata `{ xuiUserId, credits }`
- Webhook `InvoiceSettled` → extracts credits from payment record → calls `adjustCredits`

Create a webhook in BTCPay pointing to:
```
https://telegrambot.yourdomain.tld/webhooks/btcpay
```
Events: `InvoiceSettled`, `InvoiceExpired`

## Setup on Saltbox

```bash
# 1. Create app directory
mkdir -p /opt/telegrambot/data

# 2. Copy project files
cp -r . /opt/telegrambot/

# 3. Configure
cp .env.example /opt/telegrambot/.env
nano /opt/telegrambot/.env

# 4. Update compose.yaml — replace yourdomain.tld with your actual domain

# 5. Create DNS record
# telegrambot.yourdomain.tld → server IP (or use Cloudflare wildcard)

# 6. Deploy
cd /opt/telegrambot
docker compose up -d --build

# 7. Check logs
docker logs -f telegrambot
```

## Admin Commands

| Command | Description |
|---|---|
| `/link <telegram_id> <xui_user_id>` | Link a Telegram user to their xui.one account |

## Development

```bash
# Server (watches src/)
pnpm dev

# Mini app (separate terminal)
cd src/mini-app
pnpm dev
```

The mini app dev server proxies `/api/*` to `localhost:3000` via Vite config.

## Project Structure

```
telegrambot/
├── compose.yaml              # Saltbox/Traefik docker compose
├── Dockerfile                 # Multi-stage: mini-app build → server build → prod
├── package.json               # Server dependencies
├── tsconfig.json              # Server TypeScript config
├── .env.example
├── src/
│   ├── index.ts               # Entry: boots db, bot, api, scheduler
│   ├── db/index.ts            # SQLite schema + prepared statements
│   ├── bot/index.ts           # grammY bot commands
│   ├── api/index.ts           # Hono API routes + BTCPay webhook
│   ├── scheduler/index.ts     # Daily expiry reminder cron
│   ├── services/
│   │   ├── xui.ts             # XUI admin + reseller API client
│   │   ├── btcpay.ts          # BTCPay POS + invoice + webhook verification
│   │   └── telegram-auth.ts   # initData HMAC-SHA256 validation
│   └── mini-app/              # Vue 3 SPA (Vite)
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.ts
│           ├── App.vue         # Shell: Telegram theme vars, back button, transitions
│           ├── router.ts
│           ├── composables/
│           │   └── useApi.ts   # API client (sends initData header) + useAsync
│           └── views/
│               ├── Dashboard.vue
│               ├── BuyCredits.vue
│               ├── LineDetails.vue
│               ├── ExtendLine.vue
│               └── CreateLine.vue
```
