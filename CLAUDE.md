# Telegram Bot + Mini App — XUI.live Engine Manager

## Stack
- Server: Node.js + TypeScript, grammY (bot), Hono (API), better-sqlite3, node-cron
- Mini Apps: Vue 3 + Vite SPAs — `src/xerocool-app/` (reseller) and `src/xposed-app/` (customer)
- Deployment: Docker on Saltbox behind Traefik

## Commands
- `pnpm dev` — run server with tsx watch
- `cd src/xerocool-app && pnpm dev` — run XeroCool (reseller) mini-app dev server
- `cd src/xposed-app && pnpm dev` — run Xposed (customer) mini-app dev server
- `pnpm build` — compile server TypeScript (`tsc --strict`; excludes both mini-apps)
- `sb install mod-telegrambot` — deploy on Saltbox

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