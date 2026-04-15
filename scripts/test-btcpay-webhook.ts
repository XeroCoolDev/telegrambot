/**
 * Simulate BTCPay webhook events against a target server (local OR prod).
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/test-btcpay-webhook.ts <event> [--url <webhook-url>]
 *
 *   events: received-payment | underpay | processing | settled | expired | expired-partial | invalid | cleanup
 *
 * Defaults to http://localhost:${PORT}/webhooks/btcpay. Pass --url to target
 * prod, e.g. https://xerocool-bot.yourdomain.com/webhooks/btcpay.
 *
 * The script writes a fake 'pending' payment row (invoice id = TEST_INVOICE_…)
 * into whichever DATABASE_PATH the .env points to, then posts signed webhooks.
 * The fake invoice id won't collide with real BTCPay invoices. Run `cleanup`
 * to remove the row.
 *
 * SIDE-EFFECT WARNING:
 *  - `settled` calls xui.adjustCredits() for real → adds FAKE_CREDITS credits
 *    to the linked reseller's XUI balance. Skip this one in prod unless you
 *    want 3 free test credits.
 *  - All other events only mutate the local DB row + send you Telegram DMs.
 */
import { createHmac } from "node:crypto";
import { initDb } from "../src/db/index.js";

const FAKE_CREDITS = 3;

const args = process.argv.slice(2);
const event = args[0];
const urlIdx = args.indexOf("--url");
const customUrl = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
const invoiceIdIdx = args.indexOf("--invoice-id");
const customInvoiceId = invoiceIdIdx >= 0 ? args[invoiceIdIdx + 1] : undefined;

if (!event) {
  console.error(
    "Usage: pnpm tsx --env-file=.env scripts/test-btcpay-webhook.ts <event> [--url <webhook-url>] [--invoice-id <real-id>]\n" +
      "  events: received-payment | underpay | processing | settled | expired | expired-partial | invalid | cleanup\n" +
      "\n" +
      "Targeting prod: pass --url <prod-webhook-url> and --invoice-id <real-existing-invoice-id>.\n" +
      "Without --invoice-id the script inserts a fake row into your LOCAL DB (dev only)."
  );
  process.exit(1);
}

const secret = process.env.BTCPAY_WEBHOOK_SECRET;
const port = process.env.PORT || "3000";
const targetUrl = customUrl || `http://localhost:${port}/webhooks/btcpay`;
const invoiceId = customInvoiceId || "TEST_INVOICE_LOCAL_DEV_ONLY";
const usingRealInvoice = !!customInvoiceId;
const tgId = Number(process.env.XEROCOOL_ADMIN_TELEGRAM_IDS?.split(",")[0]?.trim());

if (!secret) {
  console.error("BTCPAY_WEBHOOK_SECRET not set in .env");
  process.exit(1);
}
if (!tgId) {
  console.error("XEROCOOL_ADMIN_TELEGRAM_IDS must contain a TG id for the notification target");
  process.exit(1);
}

// Only touch a local DB when we're using the fake invoice id.
// Real-invoice mode trusts the target server to already have the row.
if (!usingRealInvoice) {
  const db = initDb(process.env.DATABASE_PATH || "./data/bot.db");

  if (event === "cleanup") {
    const r = db.db.prepare("DELETE FROM payments WHERE btcpay_invoice_id = ?").run(invoiceId);
    console.log(`Removed ${r.changes} fake payment row(s).`);
    process.exit(0);
  }

  const user = db.getUser.get(tgId) as { xui_user_id: string | null } | undefined;
  if (!user?.xui_user_id) {
    console.error(`TG ${tgId} isn't linked — settle events will fail. Link first or skip 'settled'.`);
  }

  const existing = db.getPayment.get(invoiceId);
  if (!existing) {
    db.insertPayment.run(
      tgId,
      invoiceId,
      FAKE_CREDITS,
      "1.00",
      "GBP",
      "Test Package",
      user?.xui_user_id || "0",
      `${process.env.BTCPAY_URL}/i/${invoiceId}`
    );
    console.log(`Inserted fake payment row for invoice ${invoiceId}`);
  }
} else if (event === "cleanup") {
  console.error("cleanup is only supported for the local fake invoice; don't cleanup real rows via this script.");
  process.exit(1);
}

function buildPayload(type: string, extras: Record<string, unknown> = {}) {
  return JSON.stringify({
    deliveryId: "test-delivery",
    webhookId: "test-webhook",
    originalDeliveryId: "test-delivery",
    isRedelivery: false,
    type,
    timestamp: Math.floor(Date.now() / 1000),
    storeId: process.env.BTCPAY_STORE_ID || "test-store",
    invoiceId,
    ...extras,
  });
}

async function send(body: string) {
  const sig = "sha256=" + createHmac("sha256", secret!).update(body).digest("hex");
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "BTCPAY-SIG": sig },
    body,
  });
  console.log(`→ ${targetUrl}`);
  console.log(`← ${res.status} ${await res.text()}`);
}

async function run() {
  switch (event) {
    case "received-payment":
    case "underpay":
      // Underpayment — handler fetches payment-methods from BTCPay. For this to
      // render correctly it needs a *real* invoice with a partial payment.
      // The fake invoice call will fail the BTCPay lookup and exit silently —
      // acceptable for testing signature + routing. For real content, redeliver
      // a past underpayment event from BTCPay instead.
      await send(buildPayload("InvoiceReceivedPayment", { afterExpiration: false }));
      break;
    case "processing":
      await send(buildPayload("InvoiceProcessing"));
      break;
    case "settled":
      await send(buildPayload("InvoiceSettled", { manuallyMarked: false, overPaid: false }));
      break;
    case "expired":
      await send(buildPayload("InvoiceExpired", { partiallyPaid: false }));
      break;
    case "expired-partial":
      await send(buildPayload("InvoiceExpired", { partiallyPaid: true }));
      break;
    case "invalid":
      await send(buildPayload("InvoiceInvalid"));
      break;
    default:
      console.error(`Unknown event '${event}'`);
      process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
