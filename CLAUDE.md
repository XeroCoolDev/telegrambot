# Telegram Bot + Mini App — xui.one Manager

## Stack
- Server: Node.js + TypeScript, grammY (bot), Hono (API), better-sqlite3, node-cron
- Mini App: Vue 3 + Vite SPA (src/mini-app/)
- Deployment: Docker on Saltbox behind Traefik

## Commands
- `pnpm dev` — run server with tsx watch
- `cd src/mini-app && pnpm dev` — run mini app dev server
- `pnpm build` — compile server TypeScript
- `docker compose up -d --build` — deploy on Saltbox

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