# Telegram Bot + Mini App — xui.one Manager

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
- Env vars come from the Saltbox inventory (`telegrambot_docker_envs_custom`), not `.env` — that's local dev only.
- `/opt/telegrambot/data/bot.db` is bind-mounted and survives rebuilds; schema changes must stay additive and guarded, as in `src/db/index.ts`.

## Architecture
- XUI API uses query-string `?action=X` format, NOT REST paths
- Two XUI APIs: Admin (api.php) + Reseller (api-reseller.php)
- BTCPay credit packages come from a POS app, not XUI
- User linking is admin-managed via /link command
- All credits/packages/lines live in xui.one — SQLite only tracks tg↔xui mapping + invoices
- Line extension uses hybrid flow: reseller API applies package, admin API sets expiry

## Code Style
- ESM ("type": "module" in package.json)
- Functional style, no classes
- Vue 3 Composition API with <script setup>