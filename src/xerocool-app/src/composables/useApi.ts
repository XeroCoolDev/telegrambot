import { ref } from "vue";

const tg = window.Telegram.WebApp;

async function request<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(`/xerocool${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": tg.initData,
      ...opts.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// ── Typed API methods ───────────────────────────────────

export interface Permissions {
  canCreateLine: boolean;
  canDeleteLine: boolean;
  canBuyCredits: boolean;
  canToggleAdult: boolean;
}

export interface UserInfo {
  linked: boolean;
  credits?: number;
  xuiUsername?: string;
  isAdmin?: boolean;
  permissions?: Permissions;
  canShareWithCustomers?: boolean;
  config?: {
    maxConnections: number;
    extendConnLockDays: number;
  };
}

export interface Subscription {
  id: string;
  username: string;
  status: "active" | "disabled";
  expDate: number | null;
  expiresFormatted: string;
  daysLeft: number | null;
  maxConnections: string;
  adultEnabled: boolean;
  resellerNotes: string | null;
  customerUsername: string | null;
  customerTelegramId: number | null;
}

export interface XuiPackage {
  id: string;
  name: string;
  credits: number;
  duration: string;
  durationUnit: string;
  maxConnections: string;
}

export interface CreditOption {
  id: string;
  title: string;
  price: string;
}

export interface CreditOptions {
  currency: string;
  items: CreditOption[];
}

export const api = {
  getMe: () => request<UserInfo>("/me"),

  getSubscriptions: () => request<Subscription[]>("/subscriptions"),

  getLine: (id: string) => request<Subscription>(`/line/${id}`),

  getPackages: () => request<XuiPackage[]>("/packages"),

  getCreditOptions: () => request<CreditOptions>("/credit-options"),

  getPendingPayments: () =>
    request<{ invoiceId: string; credits: number; amount: string; currency: string; title: string; checkoutUrl: string; status: string; createdAt: string }[]>(
      "/pending-payments"
    ),

  buyCredits: (item: CreditOption & { credits: number }) =>
    request<{ invoiceId: string; checkoutUrl: string }>("/buy-credits", {
      method: "POST",
      body: JSON.stringify({
        itemId: item.id,
        credits: item.credits,
        price: item.price,
        itemTitle: item.title,
      }),
    }),

  updateLineInfo: (lineId: string, fields: { contact?: string; resellerNotes?: string }) =>
    request<{ success: boolean }>("/lines/update-info", {
      method: "POST",
      body: JSON.stringify({ lineId, ...fields }),
    }),

  deleteLine: (lineId: string) =>
    request<{ success: boolean }>("/lines/delete", {
      method: "POST",
      body: JSON.stringify({ lineId }),
    }),

  toggleEnabled: (lineId: string, enabled: boolean) =>
    request<{ success: boolean; enabled: boolean }>("/lines/toggle-enabled", {
      method: "POST",
      body: JSON.stringify({ lineId, enabled }),
    }),

  toggleAdult: (lineId: string, enable: boolean) =>
    request<{ success: boolean; adultEnabled: boolean }>("/lines/toggle-adult", {
      method: "POST",
      body: JSON.stringify({ lineId, enable }),
    }),

  getConnectionOptions: (lineId: string) =>
    request<{ from: number; to: number; cost: number; isDiscounted: boolean; multiplier: number }[]>(
      `/line/${lineId}/connection-options`
    ),

  addConnections: (lineId: string, targetConnections: number) =>
    request<{ success: boolean; connections: number; cost: number }>("/lines/add-connections", {
      method: "POST",
      body: JSON.stringify({ lineId, targetConnections }),
    }),

  getLineClaims: (lineId: string) =>
    request<Array<{ telegram_id: number; username: string | null; first_name: string | null; created_at: string }>>(
      `/xerocool/line-claims/${lineId}`
    ),

  unclaimCustomer: (lineId: string, telegramId: number) =>
    request<{ success: boolean }>("/xerocool/unclaim", {
      method: "POST",
      body: JSON.stringify({ lineId, telegramId }),
    }),

  extendLine: (lineId: string, packageId: string) =>
    request<{ success: boolean }>("/lines/extend", {
      method: "POST",
      body: JSON.stringify({ lineId, packageId }),
    }),

  // Admin
  adminGetUsers: () => request<any[]>("/admin/users"),
  adminGetPayments: () => request<any[]>("/admin/payments"),
  adminLink: (telegramId: number, xuiUserId: string) =>
    request<{ success: boolean; username: string }>("/admin/link", {
      method: "POST",
      body: JSON.stringify({ telegramId, xuiUserId }),
    }),
  adminUnlink: (telegramId: number) =>
    request<{ success: boolean }>("/admin/unlink", {
      method: "POST",
      body: JSON.stringify({ telegramId }),
    }),
  adminSetPermissions: (telegramId: number, permissions: Permissions) =>
    request<{ success: boolean }>("/admin/set-permissions", {
      method: "POST",
      body: JSON.stringify({ telegramId, permissions }),
    }),

  createLine: (packageId: string, resellerNotes?: string, contact?: string) =>
    request<{ success: boolean; lineId: string }>("/lines/create", {
      method: "POST",
      body: JSON.stringify({ packageId, resellerNotes, contact }),
    }),
};

// ── Reusable async state composable ─────────────────────

export function useAsync<T>(fn: () => Promise<T>) {
  const data = ref<T | null>(null) as { value: T | null };
  const error = ref<string | null>(null);
  const loading = ref(true);

  async function execute() {
    loading.value = true;
    error.value = null;
    try {
      data.value = await fn();
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  execute();

  return { data, error, loading, refresh: execute };
}
