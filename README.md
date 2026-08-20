# Telegram Bot + Mini App — xui.one Manager

Telegram bot and mini app for managing xui.one IPTV subscriptions with BTCPay Bitcoin payments.

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

Deployed by the [saltbox-telegrambot](https://github.com/XeroCoolDev/saltbox-telegrambot) Ansible role, installed as a `saltbox_mod`. See that repo for first-time setup (bootstrapping the role, registering it in the playbook, inventory config).

Once installed, one command deploys:

```bash
sb install mod-telegrambot
```

That command, in order:

1. Creates/updates the Cloudflare DNS records for both subdomains
2. Removes the running `telegrambot` container
3. **Clones or force-resets `/opt/telegrambot/repo` to `origin/main`**
4. Builds the Docker image from that checkout
5. Recreates the container behind Traefik

### Push before you deploy

Step 3 runs Ansible's `git` module with `force: true` and `version: main`. It hard-resets the working tree to `origin/main`, so **anything that hasn't reached GitHub is destroyed** — uncommitted edits *and* local commits that only exist on the server.

`/opt/telegrambot/repo` is a real git clone, so editing in place is fine. Just never deploy before pushing.

Deploys always track `main`. A feature branch won't ship unless you override `telegrambot_docker_build_branch` in the inventory.

### Making a change

```bash
cd /opt/telegrambot/repo

# 1. Edit

# 2. Typecheck (optional, needs Node 22 + pnpm on the host).
#    The server is compiled with `tsc --strict`, so a type error here
#    becomes a failed image build halfway through the deploy.
pnpm install && pnpm build

# 3. Commit and push — REQUIRED before deploying, see above
git add -A src
git commit -m "feat: ..."
git push origin main

# 4. Deploy
sb install mod-telegrambot
```

Note that `pnpm build` at the root only compiles the **server** — `tsconfig.json` excludes both mini-apps. The Vue apps build with plain `vite build` and are never type-checked, so TS errors in `.vue` files surface as runtime bugs rather than build failures. To check them explicitly:

```bash
cd src/xerocool-app && pnpm exec vue-tsc --noEmit
cd src/xposed-app   && pnpm exec vue-tsc --noEmit
```

### Verifying a deploy

```bash
docker logs -f telegrambot          # expect: [db], [bot], [api], [scheduler] lines
curl -s https://<xerocool-subdomain>.<domain>/health
```

Then open the mini app from Telegram. Mini apps are aggressively cached — if you don't see your change, fully close and reopen the app rather than just backing out of it.

### What survives a rebuild

The SQLite database at `/opt/telegrambot/data/bot.db` is bind-mounted and untouched by rebuilds. Schema changes are applied on boot by the migration block in `src/db/index.ts`, which is additive (`ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info` check) — so a redeploy never drops data.

### Changing configuration

Environment variables come from the Saltbox inventory, not from `.env` (that file is for local dev only):

```bash
sb edit inventory
```

Edit `telegrambot_docker_envs_custom`, then re-run `sb install mod-telegrambot`.

### Updating the Ansible role

```bash
cd /opt/saltbox_mod/roles/telegrambot && sudo git pull
```

## Configuration

See `.env.example` for all available environment variables, and the [role README](https://github.com/XeroCoolDev/saltbox-telegrambot) for the inventory equivalents and their defaults.

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
