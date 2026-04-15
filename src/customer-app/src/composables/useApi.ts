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
}

export const api = {
  getLines: () => request<CustomerLine[]>("/lines"),

  getLine: (id: string) => request<CustomerLine>(`/line/${id}`),

  toggleAdult: (lineId: string, enable: boolean) =>
    request<{ success: boolean; adultEnabled: boolean }>("/toggle-adult", {
      method: "POST",
      body: JSON.stringify({ lineId, enable }),
    }),
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
