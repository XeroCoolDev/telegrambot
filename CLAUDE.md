# Telegram Bot + Mini App — XUI.live Engine Manager

## Stack
- Server: Node.js + TypeScript, grammY (bot), Hono (API), better-sqlite3, node-cron
- Mini Apps: Vue 3 + Vite SPAs — `src/xerocool-app/` (reseller) and `src/xposed-app/` (customer)
- Deployment: Cloudflare Workers (D1 + webhooks + Cron Trigger), deployed from `worker/` — see `worker/README.md`
- Alternative build: Docker (Node + SQLite + long polling) via `Dockerfile`/`compose.yaml`; kept building, not deployed anywhere

## Commands
- `pnpm dev` — run server with tsx watch
- `cd src/xerocool-app && pnpm dev` — run XeroCool (reseller) mini-app dev server
- `cd src/xposed-app && pnpm dev` — run Xposed (customer) mini-app dev server
- `pnpm build` — compile server TypeScript (`tsc --strict`; excludes both mini-apps)
- `cd worker && pnpm exec wrangler deploy` — redeploy Worker code only, when no mini-app changed
- `cd worker && pnpm typecheck && pnpm deploy` — type-check against Workers types, rebuild both mini-apps and deploy (production)

## Deployment
- Production is the Worker `telegrambot` on Cloudflare (free plan: 10 ms CPU and 50 subrequests per invocation, 100k requests/day). Deploys run from the developer's clone with `wrangler` logged in to the account that owns the bot's zone; nothing deploys from the server any more.
- Secrets (`*_TOKEN`, `*_API_KEY`, `*_SECRET`, `SETUP_KEY`) go through `wrangler secret put`, never into `[vars]` in `wrangler.toml`.
- After a deploy that changed the webhook URL or menu buttons, `POST /setup/telegram` with header `X-Setup-Key` re-registers them; an ordinary code deploy needs nothing.
- Mini-apps build with plain `vite build` and are **not** type-checked. Use `pnpm exec vue-tsc --noEmit` inside `src/xerocool-app` / `src/xposed-app` to check them (124 pre-existing errors from `useAsync` typing; new errors are the ones to care about).
- `pnpm build` at the root type-checks the Node entrypoint; `cd worker && pnpm typecheck` checks the Worker one. Run both before pushing — they share `src/`.
- pnpm is pinned via `packageManager` in all three `package.json` files. Bumping it means changing all three *and* regenerating all three lockfiles (`pnpm install --lockfile-only`) in the same commit. `worker/` is its own pnpm root (`worker/pnpm-workspace.yaml`) with its own lockfile.
- Docker build stages use a bare `pnpm install --frozen-lockfile` with no fallback. A failure there means the lockfile is stale — regenerate it, don't work around it.
- D1 schema changes are numbered files in `worker/migrations/` applied with `pnpm migrate`; the Node build applies the same change additively in `src/db/sqlite.ts`. Keep both.
- `*.sql` is git-ignored except `worker/migrations/`: a data export (`worker/export-sqlite.sh`) contains reseller API keys and must never be committed.

## Architecture
- Line lists are paged BY THE PANEL: `/subscriptions` and `/admin/user/:id/lines` pass `status`, `q`, `sort`, `page`, `perPage` (≤100) to `lines.list` and return one page plus `meta.total` (`api/lines.ts` buildLinesPage). Never fetch a reseller's whole line list in one request — Workers meter CPU per request and a 4,000-line reseller blew the free plan's 10 ms
- Daily job (`src/scheduler/daily.ts`): two panel calls + one grouped D1 query, one message per reseller with something due, admins skip the top-up nag, and an admin digest EVERY run (lists all resellers with lines in the 14-day window). `/digest` bot command = dry run for admins. Any change here must keep the Worker under 50 subrequests per run
- Runtime-neutral core: every DB call is `await`ed through `src/db/statements.ts` (adapters: `db/sqlite.ts` for Node, `db/d1.ts` for Workers); env is read on use, never at module scope, because a Worker isolate has no env at import time; bots make no Telegram calls when constructed (`bot/setup.ts` does that once)
- Entry points: `src/index.ts` (Node: polling, node-cron, static from ./dist) and `src/worker.ts` (Workers: webhooks at `/telegram/*`, Cron Trigger, assets binding). Keep new code in neither — put it in the shared modules
- Panel is XUI.live Engine (https://xui.live/docs/api/): POST JSON `{"action": "<resource>.<verb>", …}` with `X-API-Key` to an access-code URL (`https://panel/<code>/`), NOT REST paths and NOT xui.one's `api.php?action=`
- Two panel APIs, one format: Admin (`XUI_ADMIN_API_URL`, an **Admin API** access code + admin key) and Reseller (`XUI_RESELLER_API_URL`, a **Reseller API** access code + each reseller's own key)
- `src/services/xui/engine.ts` maps Engine objects onto the bot's older string-typed XuiLine/XuiUser/XuiPackage shapes; routes, bots and the scheduler never see Engine objects
- The Engine never returns API keys: a reseller generates theirs in the Reseller Portal and an admin pastes it on the user page (`/admin/set-api-key`)
- BTCPay credit packages come from a POS app, not XUI
- User linking is admin-managed via /link command
- All credits/packages/lines live in the panel — SQLite only tracks tg↔panel-account mapping + invoices
- Line extension uses hybrid flow: reseller `lines.update` with `package_id` charges and applies the package, admin `lines.update` sets the calculated expiry + connections
- Adult-bouquet toggles are made with the admin key: the Reseller API only accepts bouquets inside the line's package

## Code Style
- ESM ("type": "module" in package.json)
- Functional style, no classes
- Vue 3 Composition API with <script setup>
