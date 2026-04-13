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

### Customer Bot (optional)
- **Deep-link sharing** — resellers generate links for customers
- **Customer mini app** — view connection details, server DNS, credentials
- **Customer notes** — per-line notes for multi-device customers
- **Adult toggle** — customers can manage their own content
- **Forum support** — threaded support via Telegram forum topics

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
cd src/mini-app && pnpm install && cd ../..
cp .env.example .env
# Fill in your values
```

### Run
```bash
pnpm dev                          # Server + bot on :3000
cd src/mini-app && pnpm dev       # Mini app on :5173 (separate terminal)
```

### Tunnel (for Telegram Mini App)
```bash
ngrok http 3000
```
Set the ngrok URL as `WEBAPP_URL` in `.env` and in BotFather's Menu Button.

## Deployment (Saltbox)

See [saltbox-telegrambot](https://github.com/XeroCoolDev/saltbox-telegrambot) for the Ansible role and deployment instructions.

## Configuration

See `.env.example` for all available environment variables.

## Project Structure

```
src/
├── index.ts                 # Entry: boots db, bot, api, scheduler
├── db/index.ts              # SQLite schema + prepared statements
├── bot/
│   ├── index.ts             # Reseller bot commands
│   └── customer.ts          # Customer bot commands + support
├── api/index.ts             # Hono API routes + webhooks + admin
├── scheduler/index.ts       # Cron: expiry reminders, top-up reminders
├── services/
│   ├── xui.ts               # XUI admin + reseller API client
│   ├── btcpay.ts            # BTCPay POS + invoices + webhook verification
│   ├── telegram-auth.ts     # initData HMAC-SHA256 validation
│   ├── notifications.ts     # Payment notifications (user + admin)
│   └── rate-limit.ts        # In-memory rate limiter
├── mini-app/                # Reseller Vue 3 SPA
│   └── src/views/
│       ├── Dashboard.vue    # Stats, search, filtered line list
│       ├── LineDetails.vue  # Credentials, toggles, share, delete
│       ├── ExtendLine.vue   # Package selection with downgrade warning
│       ├── CreateLine.vue   # New line form with adult toggle
│       ├── AddConnections.vue # Connection upgrade pricing
│       ├── BuyCredits.vue   # BTCPay credit packages + pending invoices
│       └── Admin.vue        # User management, payments, customers
└── customer-app/            # Customer Vue 3 SPA
    └── src/views/
        ├── Dashboard.vue    # Line list with search + status filter
        └── LineDetails.vue  # Connection details, notes, adult toggle
```
