# Telegram Bot + Mini App — XUI.live Engine Manager

Telegram bot and mini app for managing IPTV subscriptions on an [XUI.live Engine](https://xui.live/docs/api/) panel, with BTCPay Bitcoin payments.

## Features

### Reseller Bot
- **Line management** — create, extend, enable/disable, delete lines
- **Credit system** — buy credits via BTCPay (Bitcoin), spend on lines
- **Connection upgrades** — dynamic pricing with discount/multiplier logic
- **Adult content toggle** — per-line bouquet control
- **Expiry reminders** — daily notifications for expiring lines
- **Search, filter & sort** — paginated line list with status filtering, relative expiry ("3d left"), sort by expiry/name, and a notes popup per line
- **Admin panel** — manage users, view payments, link/unlink and delete accounts, see each user's credits and panel username
- **Admin all-lines view** — admins can browse every linked reseller's lines from the dashboard, filtered by owner; other resellers' lines open read-only

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
- **Deployment**: Cloudflare Workers (D1, webhooks, Cron Trigger); Docker build kept as a self-hosted alternative

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

## Deployment

Two builds share this source tree:

- **Cloudflare Workers** — production. The bot, API, mini-apps and daily job run as one Worker on D1 + Telegram webhooks + a Cron Trigger, deployed from [`worker/`](worker/README.md) with `pnpm deploy`. That README is the runbook: first deploy, cutover, rollback, limits.
- **Docker** (`Dockerfile`, `compose.yaml`) — the same code on Node + SQLite + long polling, for anyone who wants to self-host. It is kept building but is not deployed anywhere at the moment.

### Making a change

```bash
# 1. Edit in your clone

# 2. Type-check both entrypoints — they share src/
pnpm install && pnpm build          # Node build, tsc --strict
cd worker && pnpm install && pnpm typecheck && cd ..

# 3. Commit and push
git add -A
git commit -m "feat: ..."
git push origin main

# 4. Deploy
cd worker
pnpm deploy                         # rebuilds both mini-apps, then wrangler deploy
# or, when only Worker/server code changed:
pnpm exec wrangler deploy
```

`wrangler` must be logged in to the Cloudflare account that owns the bot's zone (`pnpm exec wrangler whoami`). An exported `CLOUDFLARE_API_TOKEN` overrides that login and causes "Unable to authenticate request [code: 10001]" when it belongs to another account.

### Dependencies and pnpm

pnpm is pinned by the `packageManager` field in all three `package.json` files
and fetched by corepack at build time. The Dockerfile sets
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0` so a non-TTY build can download it without
prompting. `worker/` is its own pnpm root (`worker/pnpm-workspace.yaml`) with its
own lockfile, so installing wrangler there never touches the root lockfile.

All Docker build stages use a bare `pnpm install --frozen-lockfile`. There is
deliberately **no `|| pnpm install` fallback** — that fallback silently
re-resolved every dependency whenever the lockfile didn't match, which made
builds non-reproducible and hid the mismatch. If a frozen install fails,
the lockfile is genuinely out of date and needs regenerating:

```bash
pnpm install --lockfile-only
(cd src/xerocool-app && pnpm install --lockfile-only)
(cd src/xposed-app   && pnpm install --lockfile-only)
git add pnpm-lock.yaml src/*/pnpm-lock.yaml
```

**Bumping pnpm** means changing `packageManager` in all three files *and*
regenerating all three lockfiles with that version, in the same commit.

Build-script approval (`better-sqlite3`, `esbuild`) is currently declared three
ways — `pnpm-workspace.yaml` (`allowBuilds`, the pnpm 11 form), `.npmrc`
(`only-built-dependencies[]`) and the `pnpm` field in `package.json`. That's
redundant but harmless, and it survives pnpm changing the syntax again. Note
the root `.npmrc` is not copied into any Docker stage, so it only affects local
installs.

Note that `pnpm build` at the root only compiles the **server** — `tsconfig.json` excludes both mini-apps. The Vue apps build with plain `vite build` and are never type-checked, so TS errors in `.vue` files surface as runtime bugs rather than build failures. To check them explicitly:

```bash
cd src/xerocool-app && pnpm exec vue-tsc --noEmit
cd src/xposed-app   && pnpm exec vue-tsc --noEmit
```

### Verifying a deploy

```bash
cd worker && pnpm tail              # live request log; every line should end "Ok"
curl -s https://<xerocool-subdomain>.<domain>/health
```

Then open the mini app from Telegram. Mini apps are aggressively cached — if you don't see your change, fully close and reopen the app rather than just backing out of it.

### What survives a deploy

All state lives in the D1 database. Schema changes are numbered SQL files in `worker/migrations/`, applied with `pnpm migrate`; a code deploy never touches data. The Node build keeps the equivalent additive migration in `src/db/sqlite.ts` so the two schemas stay in step.

### Changing configuration

Non-secret settings are `[vars]` in `worker/wrangler.toml` and ship with the next deploy. Secrets are set once with `pnpm exec wrangler secret put <NAME>` and persist across deploys. `.env` is for local development only.

### Running the Docker build instead

```bash
cp .env.example .env                # fill in values
docker compose up -d --build        # bot on :3000, SQLite in /opt/telegrambot/data (see compose.yaml)
```

Polling and webhooks are mutually exclusive: before starting the Docker build against a bot token that the Worker serves, call `deleteWebhook` for that bot or Telegram answers 409.

## Configuration

See `.env.example` for all available environment variables; the Worker reads the same names from `[vars]` and secrets.

### Panel setup (XUI.live Engine)

The bot talks to the panel's [Admin and Reseller APIs](https://xui.live/docs/api/). Both are reached through *access codes*, not fixed paths:

1. In the Admin Console, **Security & Access → Access Codes → Add Code**. Create one of type **Admin API** (tick the Administrators group) and one of type **Reseller API** (tick every reseller group that will use the bot). Each answers at `https://<panel>/<code>/`. Those two URLs are `XUI_ADMIN_API_URL` and `XUI_RESELLER_API_URL`.
2. **User Profile → API Access → Regenerate** on the administrator account the bot should act as. That 32-character key is `XUI_ADMIN_API_KEY`.
3. Each reseller does the same in the Reseller Portal and gives you their key. The panel never returns keys over the API, so after `/link` an admin pastes it on the reseller's user page in the dashboard. Without it the reseller can see balances via the admin key but cannot buy, extend or edit lines.
4. If you fill in **Allowed IP Addresses** on an access code, list the address the bot calls from. Leave it empty while testing.

`XUI_ADULT_BOUQUET_IDS` are Engine bouquet ids (**Bouquets** in the console).

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
