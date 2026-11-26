# Telegram Bot + Mini App — XUI.live Engine Manager

## Stack
- Server: Node.js + TypeScript, grammY (bot), Hono (API), better-sqlite3, node-cron
- Mini Apps: Vue 3 + Vite SPAs — `src/xerocool-app/` (reseller) and `src/xposed-app/` (customer)
- Deployment: Docker on Saltbox behind Traefik
- Alternative build: Cloudflare Workers (D1 + webhooks + Cron Trigger) from `worker/` — see `worker/README.md`

## Commands
- `pnpm dev` — run server with tsx watch
- `cd src/xerocool-app && pnpm dev` — run XeroCool (reseller) mini-app dev server
- `cd src/xposed-app && pnpm dev` — run Xposed (customer) mini-app dev server
- `pnpm build` — compile server TypeScript (`tsc --strict`; excludes both mini-apps)
- `sb install mod-telegrambot` — deploy on Saltbox
- `cd worker && pnpm typecheck && pnpm deploy` — type-check against Workers types and deploy the Workers build

## Deployment
- Deploys run from `/opt/telegrambot/repo`, which the Ansible role **hard-resets to `origin/main`** (`git` module, `force: true`). Always `git push origin main` before deploying — unpushed commits and uncommitted edits are destroyed.
- Only `main` ships; a feature branch needs `telegrambot_docker_build_branch` overridden in the inventory.
- Mini-apps build with plain `vite build` and are **not** type-checked. Use `pnpm exec vue-tsc --noEmit` inside `src/xerocool-app` / `src/xposed-app` to check them.
- The role deletes the running container **before** building the image, so a failed build takes the bot down. Pre-flight with `docker build -t telegrambot:preflight .` before deploying.
- pnpm is pinned via `packageManager` in all three `package.json` files. Bumping it means changing all three *and* regenerating all three lockfiles (`pnpm install --lockfile-only`) in the same commit.
- Build stages use a bare `pnpm install --frozen-lockfile` with no fallback. A failure there means the lockfile is stale — regenerate it, don't work around it.
- Env vars come from the Saltbox inventory (`telegrambot_docker_envs_custom`), not `.env` — that's local dev only.
- `/opt/telegrambot/data/bot.db` is bind-mounted and survives rebuilds; schema changes must stay additive and guarded, as in `src/db/index.ts`.

## Architecture
- Line lists are paged BY THE PANEL: `/subscriptions` and `/admin/user/:id/lines` pass `status`, `q`, `sort`, `page`, `perPage` (≤100) to `lines.list` and return one page plus `meta.total` (`api/lines.ts` buildLinesPage). Never fetch a reseller's whole line list in one request — Workers meter CPU per request and a 4,000-line reseller blew the free plan's 10 ms
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