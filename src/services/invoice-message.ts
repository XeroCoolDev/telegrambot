import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { AppDb, DbPayment } from "../db/index.js";

export type InvoiceStateName =
  | "pending"
  | "underpaid"
  | "processing"
  | "settled"
  | "expired"
  | "expired_partial"
  | "after_expired"
  | "invalid"
  | "failed";

export interface InvoiceState {
  status: InvoiceStateName;
  underpayment?: {
    totalPaid: string;
    due: string;
    destination: string;
    cryptoCode: string;
  };
  settledAt?: Date;
}

function escapeHtml(s: string | number): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusLine(state: InvoiceStateName): string {
  switch (state) {
    case "pending":
      return "⏳ Awaiting payment";
    case "underpaid":
      return "🟡 Partial payment received";
    case "processing":
      return "⏳ Awaiting confirmations";
    case "settled":
      return "✅ Settled — credits added";
    case "expired":
      return "⏰ Expired without payment";
    case "expired_partial":
      return "⏰ Expired with partial payment";
    case "after_expired":
      return "⚠️ Payment received after expiry";
    case "invalid":
      return "❌ Marked invalid";
    case "failed":
      return "⚠️ Credit adjustment failed";
  }
}

function isTerminal(state: InvoiceStateName): boolean {
  return ["settled", "expired", "expired_partial", "invalid", "failed"].includes(state);
}

/** Render the receipt body (HTML). */
export function formatInvoiceMessage(payment: DbPayment, state: InvoiceState): string {
  const headerIcon = state.status === "settled" ? " ✅" : state.status === "invalid" || state.status === "failed" ? " ❌" : "";
  const lines: string[] = [
    `🧾 <b>Credit Purchase</b>${headerIcon}`,
    ``,
    `Status: <b>${statusLine(state.status)}</b>`,
    `Package: ${escapeHtml(payment.credits)} credits · ${escapeHtml(payment.amount)} ${escapeHtml(payment.currency)}`,
  ];

  if (state.status === "underpaid" && state.underpayment) {
    lines.push(``);
    lines.push(`Received: ${escapeHtml(state.underpayment.totalPaid)} ${escapeHtml(state.underpayment.cryptoCode)}`);
    lines.push(`Still owed: <b>${escapeHtml(state.underpayment.due)} ${escapeHtml(state.underpayment.cryptoCode)}</b>`);
    lines.push(``);
    lines.push(`Send the remaining amount to:`);
    lines.push(`<code>${escapeHtml(state.underpayment.destination)}</code>`);
  }

  if (state.status === "settled" && state.settledAt) {
    const d = state.settledAt;
    const formatted = d.toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    lines.push(`Paid: ${formatted}`);
  }

  if (state.status === "expired_partial" || state.status === "after_expired") {
    lines.push(``);
    lines.push(`Please contact support with invoice ID <code>${escapeHtml(payment.btcpay_invoice_id)}</code>.`);
  }

  return lines.join("\n");
}

/**
 * Send or edit the customer's single in-chat receipt for this invoice.
 * If status_message_id is set, edit it. Else send a new one and store the id.
 * Falls back to sending a fresh message if edit fails (old message gone,
 * >48h, identical content, etc).
 */
export async function upsertInvoiceMessage(
  bot: Bot,
  db: AppDb,
  payment: DbPayment,
  state: InvoiceState
): Promise<void> {
  const body = formatInvoiceMessage(payment, state);
  const keyboard =
    !isTerminal(state.status) && payment.checkout_url
      ? new InlineKeyboard().url("🔗 Open invoice", payment.checkout_url)
      : undefined;

  const opts = { parse_mode: "HTML" as const, reply_markup: keyboard };

  if (payment.status_message_id) {
    try {
      await bot.api.editMessageText(
        payment.telegram_id,
        payment.status_message_id,
        body,
        opts
      );
      return;
    } catch (err: any) {
      const desc = err?.description || "";
      if (desc.includes("message is not modified")) return; // no-op, content identical
      // Fall through to sending a fresh message
      console.error("[invoice-message] edit failed, sending fresh:", desc);
    }
  }

  try {
    const sent = await bot.api.sendMessage(payment.telegram_id, body, opts);
    db.setPaymentStatusMessageId.run(sent.message_id, payment.btcpay_invoice_id);
  } catch (err) {
    console.error("[invoice-message] send failed:", err);
  }
}
