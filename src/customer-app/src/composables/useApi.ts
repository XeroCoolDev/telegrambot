import { ref } from "vue";

const tg = window.Telegram.WebApp;

async function request<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(`/customer${path}`, {
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

export interface CustomerLine {
  id: string;
  username: string;
  password: string;
  status: "active" | "disabled";
  expDate: number | null;
  expiresFormatted: string;
  expiresDateTime: string;
  daysLeft: number | null;
  maxConnections: string;
  adultEnabled: boolean;
  serverUrl?: string | null;
}

// In-memory cache for /line/:id so hopping between setup guides is instant.
// Credentials don't change often; a 60-second TTL is plenty.
const lineCache = new Map<string, { at: number; data: CustomerLine }>();
const LINE_TTL_MS = 60_000;

export const api = {
  getLines: () => request<CustomerLine[]>("/lines"),

  getLine: async (id: string): Promise<CustomerLine> => {
    const cached = lineCache.get(id);
    if (cached && Date.now() - cached.at < LINE_TTL_MS) return cached.data;
    const data = await request<CustomerLine>(`/line/${id}`);
    lineCache.set(id, { at: Date.now(), data });
    return data;
  },

  invalidateLine: (id: string) => lineCache.delete(id),

  requestRenewal: (lineId: string) =>
    request<{ success: boolean }>("/request-renewal", {
      method: "POST",
      body: JSON.stringify({ lineId }),
    }),

  toggleAdult: async (lineId: string, enable: boolean) => {
    const res = await request<{ success: boolean; adultEnabled: boolean }>("/toggle-adult", {
      method: "POST",
      body: JSON.stringify({ lineId, enable }),
    });
    lineCache.delete(lineId); // state changed, drop cache
    return res;
  },
};

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
