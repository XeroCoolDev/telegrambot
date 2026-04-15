import type { Hono } from "hono";
import type { Bot } from "grammy";
import type { AppDb, DbPayment } from "../db/index.js";
import * as xui from "../services/xui/index.js";
import * as btcpay from "../services/btcpay.js";
import { notifyPaymentSettled } from "../services/notifications.js";
import { requirePerm, type AuthEnv } from "./auth.js";

export function registerCreditRoutes(api: Hono<AuthEnv>, db: AppDb) {
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

  if (success) {
    await notifyPaymentSettled(bot, db, payment, invoiceId);
  } else {
    try {
      await bot.api.sendMessage(
        payment.telegram_id,
        `⚠️ Payment received but credits could not be applied. Please contact support.\nInvoice: \`${invoiceId}\``,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("[webhook] Failed to notify user:", err);
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

        // Check if this payment covers the invoice or only partially
        const methods = await btcpay.getInvoicePaymentMethods(invoiceId);
        const method = methods?.find((m) => parseFloat(m.totalPaid) > 0);
        if (!method) break;

        const due = parseFloat(method.due);
        if (due <= 0) break; // fully paid — InvoiceProcessing/Settled will handle it

        const afterExpired = (event as any).afterExpiration === true;
        const checkoutUrl = `${process.env.BTCPAY_URL}/i/${invoiceId}`;

        try {
          if (afterExpired) {
            await bot.api.sendMessage(
              payment.telegram_id,
              `⚠️ Your payment arrived after the invoice expired. Please contact support with invoice ID \`${invoiceId}\` for a manual review.`,
              { parse_mode: "Markdown" }
            );
          } else {
            await bot.api.sendMessage(
              payment.telegram_id,
              `🟡 Received *${method.totalPaid} ${method.cryptoCode}* — still *${method.due} ${method.cryptoCode}* short.\n\n` +
                `Send the remaining amount to:\n\`${method.destination}\`\n\n` +
                `Or open the invoice: ${checkoutUrl}`,
              { parse_mode: "Markdown" }
            );
          }
        } catch (err) {
          console.error("[webhook] Failed to send received-payment notification:", err);
        }
        break;
      }
      case "InvoiceProcessing": {
        const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
        if (payment && payment.status === "pending") {
          db.updatePaymentStatus.run("processing", invoiceId);
          try {
            await bot.api.sendMessage(
              payment.telegram_id,
              `⏳ Payment received for ${payment.credits} credits — awaiting confirmations. You'll be notified once it's settled.`
            );
          } catch (err) {
            console.error("[webhook] Failed to send processing notification:", err);
          }
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
          try {
            if (partiallyPaid) {
              await bot.api.sendMessage(
                payment.telegram_id,
                `⏰ Your invoice for ${payment.credits} credits has expired with a partial payment. Please contact support with invoice ID \`${invoiceId}\`.`,
                { parse_mode: "Markdown" }
              );
            } else {
              await bot.api.sendMessage(
                payment.telegram_id,
                `⏰ Your invoice for ${payment.credits} credits has expired without payment. If you still want to buy credits, please create a new invoice.`
              );
            }
          } catch (err) {
            console.error("[webhook] Failed to send expired notification:", err);
          }
        }
        break;
      }
      case "InvoiceInvalid": {
        const payment = db.getPayment.get(invoiceId) as DbPayment | undefined;
        if (payment && payment.status !== "settled") {
          db.updatePaymentStatus.run("invalid", invoiceId);
          try {
            await bot.api.sendMessage(
              payment.telegram_id,
              `❌ Your payment for ${payment.credits} credits has been marked invalid by the payment provider. If you believe this is a mistake, please contact support.`
            );
          } catch (err) {
            console.error("[webhook] Failed to send invalid notification:", err);
          }
        }
        break;
      }
    }

    return c.json({ ok: true });
  });
}
