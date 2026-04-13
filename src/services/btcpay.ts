import { createHmac } from "node:crypto";

const TIMEOUT = Number(process.env.API_TIMEOUT_MS || 10000);

// ── Types ───────────────────────────────────────────────

export interface PosAppItem {
  id: string;
  title: string;
  price: string;
  // additional fields from your POS config
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

/** Fetch POS app data (cached for 1 hour). Credit packages are defined here. */
export async function fetchPosApp(): Promise<PosApp | null> {
  if (posAppCache && Date.now() < posAppCache.expiry) {
    return posAppCache.data;
  }

  const data = await btcpayRequest<PosApp>(
    `/api/v1/apps/pos/${process.env.BTCPAY_POS_APP_ID}`
  );

  if (data) {
    posAppCache = { data, expiry: Date.now() + 3600_000 };
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
