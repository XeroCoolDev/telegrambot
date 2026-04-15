/**
 * One-off: wipe all customer_claims rows for a given Telegram ID.
 * Usage: pnpm tsx --env-file=.env scripts/reset-customer-links.ts <telegramId>
 */
import { initDb } from "../src/db/index.js";

const tgId = process.argv[2];
if (!tgId || !/^\d+$/.test(tgId)) {
  console.error("Usage: pnpm tsx --env-file=.env scripts/reset-customer-links.ts <telegramId>");
  process.exit(1);
}

const db = initDb(process.env.DATABASE_PATH || "./data/bot.db");
const before = db.getClaimedLineIds.all(Number(tgId)) as { xui_line_id: string }[];

if (before.length === 0) {
  console.log(`No claims found for Telegram ID ${tgId}.`);
  process.exit(0);
}

console.log(`Wiping ${before.length} claim(s) for Telegram ID ${tgId}:`);
for (const row of before) console.log(`  line ${row.xui_line_id}`);

db.unclaimAllForTelegram.run(Number(tgId));
console.log("Done.");
