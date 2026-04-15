# Telegram Bot + Mini App — xui.one Manager

Telegram bot and mini app for managing xui.one IPTV subscriptions with BTCPay Bitcoin payments.

## Features

### Reseller Bot
- **Line management** — create, extend, enable/disable, delete lines
- **Credit system** — buy credits via BTCPay (Bitcoin), spend on lines
- **Connection upgrades** — dynamic pricing with discount/multiplier logic
- **Adult content toggle** — per-line bouquet control
- **Expiry reminders** — daily notifications for expiring lines
- **Search & filter** — paginated line list with status filtering
- **Admin panel** — manage users, view payments, link/unlink accounts

### Customer (Xposed) Bot (optional)
- **One-tap claim** — reseller pastes `/link <id>` in the customer's support topic; customer taps a callback button to bind their Telegram account
- **Customer mini app** — view credentials, expiry, connections; per-device setup guides (XCIPTV / GSE / Formuler)
- **Renewal requests** — Telegram MainButton sends a notification into the support topic
- **Adult toggle** — customers can manage their own content
- **Threaded support** — Telegram forum topics with reply threading and emoji reaction mirroring

## Stack
- **Server**: Node.js + TypeScript, grammY, Hono, better-sqlite3, node-cron
- **Mini App**: Vue 3 + Vite SPA
- **Payments**: BTCPay Server
- **Deployment**: Docker on Saltbox behind Traefik

## Local Development

### Prerequisites
- Node 22 (pinned in `.nvmrc`)
- pnpm

### Setup
```bash
pnpm install
cd src/xerocool-app && pnpm install && cd ../..
cp .env.example .env
# Fill in your values
```

### Run
```bash
pnpm dev                          # Server + bot on :3000
cd src/xerocool-app && pnpm dev       # Mini app on :5173 (separate terminal)
```

### Tunnel (for Telegram Mini App)
```bash
ngrok http 3000
```
Set the ngrok URL as `XEROCOOL_WEBAPP_URL` in `.env` and in BotFather's Menu Button.

## Deployment (Saltbox)

See [saltbox-telegrambot](https://github.com/XeroCoolDev/saltbox-telegrambot) for the Ansible role and deployment instructions.

## Configuration

See `.env.example` for all available environment variables.

## Project Structure

```
src/
├── index.ts                  # Entry: boots db, bots, api, scheduler
├── db/index.ts               # SQLite schema + prepared statements
├── bot/
│   ├── xerocool.ts           # XeroCool (reseller) bot commands
│   └── xposed.ts             # Xposed (customer) bot, support relay, claim flow
├── api/
│   ├── index.ts              # Hono app, host-based mini-app dispatch
│   ├── auth.ts               # Reseller initData middleware
│   ├── me.ts / lines.ts / credits.ts / admin.ts / xposed.ts
├── scheduler/index.ts        # Daily cron: expiry reminders, top-up reminders, payment cleanup
├── services/
│   ├── xui/                  # XUI admin + reseller API (split: client/lines/users/...)
│   ├── btcpay.ts             # BTCPay POS + invoices + webhook verification
│   ├── claim-token.ts        # HMAC-signed customer claim tokens
│   ├── invoice-message.ts    # Live-edited Telegram invoice receipt
│   ├── telegram-auth.ts      # initData HMAC-SHA256 validation
│   ├── notifications.ts      # Admin-chat payment notifications
│   └── rate-limit.ts         # In-memory rate limiter
├── xerocool-app/             # XeroCool (reseller) Vue 3 SPA
│   └── src/views/
│       ├── Dashboard.vue     # Stats, search, filtered line list
│       ├── LineDetails.vue   # Credentials, toggles, send-to-customer, delete
│       ├── ExtendLine.vue    # Package selection with downgrade warning
│       ├── CreateLine.vue    # New line form with adult toggle
│       ├── AddConnections.vue
│       ├── BuyCredits.vue    # BTCPay packages + pending payments + history
│       └── Admin.vue         # User management, payments
└── xposed-app/               # Xposed (customer) Vue 3 SPA
    └── src/views/
        ├── Dashboard.vue
        ├── LineDetails.vue   # Credentials, adult toggle, MainButton renewal
        └── setup/            # Per-device setup guides (XCIPTV / GSE / Formuler)
```
