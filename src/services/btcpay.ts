import { createHmac } from "node:crypto";

const TIMEOUT = Number(process.env.API_TIMEOUT_MS || 10000);

// ── Types ───────────────────────────────────────────────

export interface PosAppItem {
  id: string;
  title: string;
  /** Nullable in BTCPay — Topup/Minimum price types carry no fixed price */
  price: string | null;
  priceType?: string;
  /** Remaining stock; null/absent means unlimited */
  inventory?: number | null;
  /** BTCPay: "If true, the item does not appear in the list by default" */
  disabled?: boolean;
}

/**
 * BTCPay returns disabled and out-of-stock items in the app payload — the
 * `disabled` flag is documented as "the item does not appear in the list by
 * default", so filtering them out is the consumer's job, not the API's.
 *
 * Used for both listing and purchase validation, so a package disabled in
 * BTCPay can't be listed *or* bought.
 */
export function isItemAvailable(item: PosAppItem): boolean {
  if (item.disabled) return false;
  if (typeof item.inventory === "number" && item.inventory <= 0) return false;
  // A credit package needs a fixed price to charge against
  if (item.price === null || item.price === undefined || String(item.price).trim() === "") {
    return false;
  }
  return true;
}

/** Credit count is the first number in the item title — "100 Credits" → 100. */
export function creditsForItem(item: PosAppItem): number {
  const match = String(item.title || "").match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export interface PosApp {
  id: string;
  name: string;
  currency: string;
  items: PosAppItem[];
}

export interface BtcPayInvoice {
  id: string;
  checkoutLink: string;
  expirationTime: number;
  status: string;
  amount: string;
  currency: string;
}

// ── Helpers ─────────────────────────────────────────────

async function btcpayRequest<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${process.env.BTCPAY_URL}${path}`, {
      ...opts,
      signal: controller.signal,
      headers: {
        Authorization: `token ${process.env.BTCPAY_API_KEY}`,
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`BTCPay ${res.status}: ${await res.text()}`);
    return res.json();
  } catch (e) {
    console.error("[btcpay] Request failed:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── POS App (credit packages) ───────────────────────────

let posAppCache: { data: PosApp; expiry: number } | null = null;

// Short TTL: this payload gates both what's listed and what can be bought, so
// enabling or disabling a package in BTCPay should take effect promptly rather
// than after an hour. Only fetched when someone opens the buy screen.
const POS_CACHE_TTL_MS = 5 * 60_000;

/** Fetch POS app data (briefly cached). Credit packages are defined here. */
export async function fetchPosApp(): Promise<PosApp | null> {
  if (posAppCache && Date.now() < posAppCache.expiry) {
    return posAppCache.data;
  }

  const data = await btcpayRequest<PosApp>(
    `/api/v1/apps/pos/${process.env.BTCPAY_POS_APP_ID}`
  );

  if (data) {
    posAppCache = { data, expiry: Date.now() + POS_CACHE_TTL_MS };
  }
  return data;
}

// ── Invoice ─────────────────────────────────────────────

export async function createInvoice(params: {
  price: string;
  currency: string;
  metadata: Record<string, unknown>;
}): Promise<BtcPayInvoice | null> {
  return btcpayRequest<BtcPayInvoice>(
    `/api/v1/stores/${process.env.BTCPAY_STORE_ID}/invoices`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: params.price,
        currency: params.currency,
        metadata: params.metadata,
        checkout: { speedPolicy: "HighSpeed" },
      }),
    }
  );
}

export interface BtcPayPaymentMethod {
  paymentMethod: string;
  cryptoCode: string;
  destination: string;
  amount: string;
  totalPaid: string;
  due: string;
  payments?: Array<{
    id: string;
    value: string;
    status: string;
    receivedDate?: number;
    destination?: string;
  }>;
}

/** Fetch per-payment-method status for an invoice (amounts paid, amount due, address). */
export async function getInvoicePaymentMethods(
  invoiceId: string
): Promise<BtcPayPaymentMethod[] | null> {
  return btcpayRequest<BtcPayPaymentMethod[]>(
    `/api/v1/stores/${process.env.BTCPAY_STORE_ID}/invoices/${invoiceId}/payment-methods`
  );
}

// ── Webhook verification ────────────────────────────────

export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const secret = process.env.BTCPAY_WEBHOOK_SECRET!;
  const expected = signature.replace("sha256=", "");
  const computed = createHmac("sha256", secret).update(body).digest("hex");
  return computed === expected;
}
