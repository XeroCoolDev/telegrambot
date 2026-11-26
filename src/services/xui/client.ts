/**
 * HTTP client for the XUI.live Engine Admin and Reseller APIs.
 *
 * Both APIs share one request format and one response envelope
 * (https://xui.live/docs/api/):
 *
 *   POST https://<server>/<access-code>/      {"action": "<resource>.<verb>", ...params}
 *   headers: X-API-Key: <key>
 *
 *   200 → {"status": "ok",    "data": ..., "meta": {"total": n}}   (meta on list actions)
 *   4xx → {"status": "error", "error": {"code", "message", "field"}}
 *
 * XUI_ADMIN_API_URL / XUI_RESELLER_API_URL are the access-code addresses
 * (no api.php). Admin calls use XUI_ADMIN_API_KEY; reseller calls use the
 * key each reseller generated in their own Reseller Portal profile.
 */

const timeoutMs = () => Number(process.env.API_TIMEOUT_MS || 10000);

/** Up to 1000 rows per page on every list action. */
const PAGE_SIZE = 1000;

export type EngineParams = Record<string, unknown>;

interface EngineEnvelope<T> {
  status: "ok" | "error";
  data?: T;
  meta?: { total?: number };
  error?: { code?: string; message?: string; field?: string };
}

/** An error envelope from the Engine, or a non-JSON body: "<action>: <status> <code> (<field>) — <message>" */
function engineError(
  action: string,
  httpStatus: number,
  code: string,
  message: string,
  field?: string
): Error {
  return new Error(`${action}: ${httpStatus} ${code}${field ? ` (${field})` : ""} — ${message}`);
}

/** Fetch with AbortController-based timeout */
export async function timedFetch(
  url: string,
  opts: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** `/<code>` and `/<code>/` are the same address; normalise to one form. */
function endpoint(base: string | undefined): string {
  const trimmed = (base || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("XUI API URL is not configured");
  return `${trimmed}/`;
}

/**
 * One Engine API call. Resolves to the full envelope on `status: "ok"`;
 * throws otherwise (error envelope, non-JSON body, HTTP error).
 * Transport failures (timeout, DNS) throw the underlying fetch error.
 */
async function engineRequest<T>(
  base: string | undefined,
  apiKey: string,
  action: string,
  params: EngineParams = {}
): Promise<EngineEnvelope<T>> {
  const res = await timedFetch(endpoint(base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ action, ...params }),
  });

  let body: EngineEnvelope<T> | null = null;
  try {
    body = (await res.json()) as EngineEnvelope<T>;
  } catch {
    body = null;
  }

  if (!res.ok || !body || body.status !== "ok") {
    const err: NonNullable<EngineEnvelope<T>["error"]> = body?.error ?? {};
    throw engineError(
      action,
      res.status,
      err.code || (body ? "UNKNOWN" : "NO_JSON"),
      err.message || res.statusText || "no JSON answer",
      err.field
    );
  }
  return body;
}

/** One call, returning `data`. */
export async function engineCall<T>(
  base: string | undefined,
  apiKey: string,
  action: string,
  params: EngineParams = {}
): Promise<T> {
  const body = await engineRequest<T>(base, apiKey, action, params);
  return body.data as T;
}

/**
 * One page of a `*.list` action together with `meta.total`, the count of
 * every row matching the filters — what a paged UI needs to draw its pager
 * and its counters without ever fetching the whole set.
 */
export async function adminCallWithTotal<T>(
  action: string,
  params: EngineParams = {}
): Promise<{ data: T; total: number | null }> {
  const body = await engineRequest<T>(
    process.env.XUI_ADMIN_API_URL,
    process.env.XUI_ADMIN_API_KEY || "",
    action,
    params
  );
  const total = Number(body.meta?.total);
  return { data: body.data as T, total: Number.isFinite(total) ? total : null };
}

/**
 * A `*.list` action, walking every page. `meta.total` counts every matching
 * row, so we raise `start` by the page size until we have them all.
 */
export async function engineList<T>(
  base: string | undefined,
  apiKey: string,
  action: string,
  params: EngineParams = {}
): Promise<T[]> {
  const rows: T[] = [];
  let start = 0;
  for (;;) {
    const body = await engineRequest<T[]>(base, apiKey, action, {
      ...params,
      start,
      limit: PAGE_SIZE,
    });
    const page = Array.isArray(body.data) ? body.data : [];
    rows.push(...page);
    const total = Number(body.meta?.total);
    start += page.length;
    if (page.length === 0 || page.length < PAGE_SIZE) break;
    if (Number.isFinite(total) && start >= total) break;
  }
  return rows;
}

/** Admin API — uses XUI_ADMIN_API_URL + XUI_ADMIN_API_KEY */
export function adminCall<T>(action: string, params: EngineParams = {}): Promise<T> {
  return engineCall<T>(process.env.XUI_ADMIN_API_URL, process.env.XUI_ADMIN_API_KEY || "", action, params);
}

export function adminList<T>(action: string, params: EngineParams = {}): Promise<T[]> {
  return engineList<T>(process.env.XUI_ADMIN_API_URL, process.env.XUI_ADMIN_API_KEY || "", action, params);
}

/** Reseller API — uses XUI_RESELLER_API_URL + the reseller's own key */
export function resellerCall<T>(
  resellerApiKey: string,
  action: string,
  params: EngineParams = {}
): Promise<T> {
  return engineCall<T>(process.env.XUI_RESELLER_API_URL, resellerApiKey, action, params);
}

/** Parse a positive integer id from the strings the DB and routes carry. */
export function toId(value: string | number): number | null {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Uniform failure log: "[xui] <fn> failed: <action>: 400 INVALID_X (field) — message" */
export function logFailure(fn: string, e: unknown): void {
  const detail = e instanceof Error ? e.message : String(e);
  console.error(`[xui] ${fn} failed: ${detail}`);
}
