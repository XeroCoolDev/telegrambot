import type { Hono } from "hono";
import type { Bot } from "grammy";
import type { AppDb, DbPayment } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import * as btcpay from "../services/btcpay.js";
import { notifyAdminPaymentSettled } from "../services/notifications.js";
import { upsertInvoiceMessage } from "../services/invoice-message.js";
import { requirePerm, type AuthEnv } from "./auth.js";

export function registerCreditRoutes(api: Hono<AuthEnv>, db: AppDb, bot: Bot) {
  // GET /credit-options — items from BTCPay POS app
  api.get("/credit-options", async (c) => {
    const posApp = await btcpay.fetchPosApp();
    if (!posApp?.items?.length) {
      return c.json({ error: "No credit options available" }, 404);
    }
    return c.json({
      currency: posApp.currency,
      items: posApp.items.map((item) => ({
        id: item.id,
        title: item.title,
        price: item.price,
      })),
    });
  });

  // GET /pending-payments — list pending invoices for the current user
  api.get("/pending-payments", async (c) => {
    const tgId = c.get("telegramId");
    const payments = db.getPendingPayments.all(tgId) as DbPayment[];
    return c.json(
      payments.map((p) => ({
        invoiceId: p.btcpay_invoice_id,
        credits: p.credits,
        amount: p.amount,
        currency: p.currency,
        title: p.item_title,
        checkoutUrl: p.checkout_url,
        status: p.status,
        createdAt: p.created_at,
      }))
    );
  });

  // POST /buy-credits — create BTCPay invoice for a POS item
  api.post("/buy-credits", async (c) => {
    const permErr = requirePerm(c, "canBuyCredits");
    if (permErr) return permErr;

    const tgId = c.get("telegramId");
    const xuiUserId = c.get("xuiUserId");
    if (!xuiUserId) return c.json({ error: "Account not linked" }, 400);

    const { itemId, credits, price, itemTitle } = await c.req.json<{
      itemId: string;
      credits: number;
      price: string;
      itemTitle: string;
    }>();

    const posApp = await btcpay.fetchPosApp();
    if (!posApp) return c.json({ error: "Payment system unavailable" }, 502);

    const invoice = await btcpay.createInvoice({
      price,
      currency: posApp.currency,
      metadata: {
        xuiUserId,
        credits,
        itemDesc: itemTitle,
        itemCode: itemId,
      },
    });

    if (!invoice) return c.json({ error: "Failed to create invoice" }, 502);

    db.insertPayment.run(
      tgId,
      invoice.id,
      credits,
      price,
      posApp.currency,
      itemTitle,
      xuiUserId,
      invoice.checkoutLink
    );

    // Send the initial "Awaiting payment" receipt; edited in place as status changes
    const payment = db.getPayment.get(invoice.id) as DbPayment | undefined;
    if (payment) {
      await upsertInvoiceMessage(bot, db, payment, { status: "pending" });
    }

    return c.json({
      invoiceId: invoice.id,
      checkoutUrl: invoice.checkoutLink,
    });
  });
}

/** Shared settlement logic — used by webhook and manual /settle command */
export async function settlePayment(bot: Bot, db: AppDb, invoiceId: string): Promise<boolean> {
  const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
  if (!payment) return false;
  if (payment.status === "settled") return true;

  // Atomic claim — only one caller can transition pending/processing → settling.
  // If another concurrent webhook already claimed it, bail without crediting again.
  const claim = db.claimSettlement.run(invoiceId);
  if (claim.changes === 0) {
    // Either already settled, or another handler is mid-flight (status 'settling'/'failed'/'invalid').
    const fresh = db.getPayment.get(invoiceId) as DbPayment | undefined;
    return fresh?.status === "settled";
  }

  const success = await xui.adjustCredits(
    payment.xui_user_id,
    payment.credits,
    `BTCPay invoice ${invoiceId}`
  );

  db.updatePaymentStatus.run(success ? "settled" : "failed", invoiceId);

  const fresh = db.getPayment.get(invoiceId) as DbPayment | undefined;
  if (fresh) {
    if (success) {
      await upsertInvoiceMessage(bot, db, fresh, { status: "settled", settledAt: new Date() });
      await notifyAdminPaymentSettled(bot, db, payment, invoiceId);
    } else {
      await upsertInvoiceMessage(bot, db, fresh, { status: "failed" });
    }
  }

  return success;
}

/** Register BTCPay webhook on the unauthenticated app */
export function registerBtcpayWebhook(app: Hono, db: AppDb, bot: Bot) {
  app.post("/webhooks/btcpay", async (c) => {
    const rawBody = await c.req.text();
    const sig = c.req.header("BTCPAY-SIG") || "";

    if (!btcpay.verifyWebhookSignature(rawBody, sig)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(rawBody);
    const { invoiceId, type } = event;

    switch (type) {
      case "InvoiceReceivedPayment": {
        const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
        if (!payment || payment.status !== "pending") break;

        const methods = await btcpay.getInvoicePaymentMethods(invoiceId);
        const method = methods?.find((m) => parseFloat(m.totalPaid) > 0);
        if (!method) break;

        const due = parseFloat(method.due);
        if (due <= 0) break; // fully paid — InvoiceProcessing/Settled will handle it

        const afterExpired = (event as any).afterExpiration === true;
        if (afterExpired) {
          await upsertInvoiceMessage(bot, db, payment, { status: "after_expired" });
        } else {
          await upsertInvoiceMessage(bot, db, payment, {
            status: "underpaid",
            underpayment: {
              totalPaid: method.totalPaid,
              due: method.due,
              destination: method.destination,
              cryptoCode: method.cryptoCode,
            },
          });
        }
        break;
      }
      case "InvoiceProcessing": {
        const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
        if (payment && payment.status === "pending") {
          db.updatePaymentStatus.run("processing", invoiceId);
          const fresh = db.getPayment.get(invoiceId) as DbPayment | undefined;
          if (fresh) await upsertInvoiceMessage(bot, db, fresh, { status: "processing" });
        }
        break;
      }
      case "InvoiceSettled": {
        const manual = (event as any).manuallyMarked === true;
        const overpaid = (event as any).overPaid === true;
        if (manual || overpaid) {
          console.log(`[webhook] InvoiceSettled ${invoiceId} manual=${manual} overpaid=${overpaid}`);
        }
        await settlePayment(bot, db, invoiceId);
        break;
      }
      case "InvoiceExpired": {
        const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
        if (payment && payment.status === "pending") {
          db.updatePaymentStatus.run("expired", invoiceId);
          const partiallyPaid = (event as any).partiallyPaid === true;
          const fresh = db.getPayment.get(invoiceId) as DbPayment | undefined;
          if (fresh) {
            await upsertInvoiceMessage(bot, db, fresh, {
              status: partiallyPaid ? "expired_partial" : "expired",
            });
          }
        }
        break;
      }
      case "InvoiceInvalid": {
        const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
        if (payment && payment.status !== "settled") {
          db.updatePaymentStatus.run("invalid", invoiceId);
          const fresh = db.getPayment.get(invoiceId) as DbPayment | undefined;
          if (fresh) await upsertInvoiceMessage(bot, db, fresh, { status: "invalid" });
        }
        break;
      }
    }

    return c.json({ ok: true });
  });
}
