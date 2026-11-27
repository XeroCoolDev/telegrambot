# Cloudflare Workers build

The production build. The bot, API, mini-apps and daily job run as one
Cloudflare Worker so they keep running when the media server does not (weekly
backup stop, reboots, link trouble). The panel and BTCPay are hosted elsewhere,
so nothing in the bot needs the home network.

The Docker build (`Dockerfile`, `compose.yaml` at the repo root) is kept as a
self-hosted alternative and is not deployed anywhere. The two share `src/` and
differ only in their entrypoint and tooling:

| | Docker (`src/index.ts`) | Workers (`src/worker.ts`) |
|---|---|---|
| storage | better-sqlite3, `/opt/telegrambot/data/bot.db` (compose bind mount) | D1 binding `BOT_DB` |
| Telegram updates | long polling | webhooks at `/telegram/xerocool`, `/telegram/xposed` |
| daily job | node-cron, `REMINDER_CRON` in container TZ | Cron Trigger in `wrangler.toml`, **UTC** |
| mini-apps | served from `./dist` by Hono | assets binding, `public/app-<bot>/`, routed by host |
| config | `.env` → container env | `[vars]` in `wrangler.toml` + `wrangler secret` |
| deploy | `docker compose up -d --build` | `pnpm deploy` from this directory |

Everything under `src/` is runtime-neutral: every database call is `await`ed
through one statement map (`src/db/statements.ts`) and env is read on use, not
at import. The only runtime-specific files are the two entrypoints, the two
storage adapters (`src/db/sqlite.ts`, `src/db/d1.ts`), `src/scheduler/index.ts`
(node-cron) and `src/api/static-node.ts`.

## Prerequisites

- Node 22 and pnpm (the root `packageManager` pin), `pnpm install` run at the
  repo root — the Worker bundle resolves `grammy` and `hono` from there. The
  root lockfile is untouched by this build.
- A Cloudflare account with the bot's zone on it (`pnpm exec wrangler login`
  once, approving with that account).
- `sqlite3` on the old Docker host for the one-off data export when migrating.

## First deploy

```bash
cd worker
pnpm install                      # wrangler + types; creates worker/pnpm-lock.yaml — commit it

# 1. Database
pnpm exec wrangler d1 create telegrambot     # paste the printed id into wrangler.toml
pnpm migrate                                 # applies migrations/0001_init.sql

# 2. Config: edit [vars] and routes in wrangler.toml (same names as the Docker env), then secrets:
for s in XEROCOOL_BOT_TOKEN XPOSED_BOT_TOKEN XUI_ADMIN_API_KEY BTCPAY_API_KEY BTCPAY_WEBHOOK_SECRET; do
  pnpm exec wrangler secret put $s
done
openssl rand -hex 32 | pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET   # grammY checks it on every update
openssl rand -hex 32 | pnpm exec wrangler secret put SETUP_KEY                 # guards POST /setup/telegram

# 3. Data (on the old Docker host; stop the container first if this is the cutover)
./export-sqlite.sh /opt/telegrambot/data/bot.db > data.sql
pnpm exec wrangler d1 execute BOT_DB --remote --file=data.sql

# 4. Build + deploy
pnpm typecheck                    # tsc over src/ with Workers types
pnpm deploy                       # builds both mini-apps into public/, then wrangler deploy
```

## Cutover

Telegram delivers updates either by polling or by webhook, never both, so the
Docker bot has to stop before the Worker takes the bots over.

```bash
# on the old Docker host
docker stop telegrambot

# register webhooks + default menu buttons (idempotent, run after every deploy that changes URLs)
curl -X POST -H "X-Setup-Key: <SETUP_KEY>" https://xerocool-bot.<domain>/setup/telegram

# confirm
curl -s "https://api.telegram.org/bot<XEROCOOL_BOT_TOKEN>/getWebhookInfo"
curl -s https://xerocool-bot.<domain>/health
pnpm exec wrangler tail
```

Then in BTCPay: Store → Webhooks → add `https://xerocool-bot.<domain>/webhooks/btcpay`
with the same `BTCPAY_WEBHOOK_SECRET`, events as before. The old webhook can
stay until the Docker build is retired.

Also update the two mini-app URLs in BotFather (`/setmenubutton`, web app
URLs) only if the hostnames changed; with the same custom domains they don't.

### Rolling back

```bash
curl -s "https://api.telegram.org/bot<XEROCOOL_BOT_TOKEN>/deleteWebhook"
curl -s "https://api.telegram.org/bot<XPOSED_BOT_TOKEN>/deleteWebhook"
docker start telegrambot          # polling resumes
```

Rows written to D1 after the cutover (new payments, claims, support threads)
are not in `bot.db`; there is no reverse export yet, so roll back quickly or
copy them by hand.

### Trying it without cutting over

Create two test bots in BotFather, give the Worker their tokens, point
`XEROCOOL_WEBAPP_URL` at the `workers.dev` URL (the Xposed app is picked by
hostname, so it needs a second hostname — a custom domain — to be reachable) and
use a throwaway D1. Never give both builds the same bot token at once.

## Everyday changes

```bash
pnpm typecheck && pnpm deploy     # code
pnpm exec wrangler secret put X   # secrets
# vars: edit wrangler.toml, then pnpm deploy
```

## Limits and behaviour differences

- **Free plan:** 100k requests/day, 10 ms CPU per invocation, 50 outbound
  requests per invocation. The daily job is shaped for that cap: two panel
  calls fetch every expiring line on the panel (`status: "expiring"`, the
  Engine's own 14-day filter, plus one page of the newest expired), then one
  Telegram message per reseller who has something due and one admin summary.
  `DAILY_MESSAGE_BUDGET` (default 40) stops the run before the cap and the
  admin summary names how many resellers were skipped, so overflow is visible
  rather than silent. Below ~40 resellers with reminders due on the same day
  nothing is skipped; past that, raise the budget on the $5/month plan (1000
  requests, 30 s CPU). Line lists are paged by the panel (20 per page, `meta.total` for the
  pager and tiles), so a 4,000-line reseller costs the same per request as a
  40-line one; the full-list version of that screen exceeded the 10 ms CPU cap. D1 free tier (5 GB, 5M
  row reads/day) is far beyond this bot's needs.
- **Cron is UTC.** `0 9 * * *` is 09:00 GMT / 10:00 BST. Dates in reminders and
  `daysUntilExpiry`'s midnight boundary are UTC too; the Docker build used
  Europe/London.
- **Rate limiting is per isolate**, so it is a brake rather than a strict quota.
- **"Already reminded today"** dedupe is gone: it was an in-memory map that never
  survived a restart. One cron run per day sends each reminder once.
- **The admin digest is sent every run**, even when nothing is due, so a missing
  digest at 09:00 UTC means the cron did not fire. It lists every reseller with a
  line in the panel's 14-day "expiring" window, who was reminded, who is overdue
  for a top-up and whether the message budget was hit. `/digest` in the bot (admins
  only) runs the same job as a dry run and replies with the digest: nothing is
  sent to resellers and no invoices are expired or pruned.
- **Admins never get the top-up reminder** (`XEROCOOL_ADMIN_TELEGRAM_IDS`); they
  still get expiry reminders for lines on their own account.
- **Workers Logs** are on (`[observability]`), so past invocations — a BTCPay
  webhook delivery, a cron run — are searchable in the dashboard under
  Workers → telegrambot → Logs for three days.
- **Reserved paths:** `/telegram/*`, `/setup/*`, `/webhooks/*`, `/health`,
  `/xerocool/*`, `/xposed/*` never serve mini-app assets.
- **Logs** are in `wrangler tail` or the dashboard, not `docker logs`.
