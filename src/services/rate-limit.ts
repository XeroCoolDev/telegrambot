/**
 * Fixed-window rate limiter held in memory.
 *
 * On Node this is process-wide. On Cloudflare Workers it is per isolate, so a
 * burst spread across isolates sees a looser limit than configured — a
 * best-effort brake on abuse rather than an exact quota. Workers also forbid
 * timers at module scope, so stale entries are swept on the way through
 * instead of by setInterval.
 */
const windows = new Map<string, { count: number; reset: number }>();

const MAX_ENTRIES = 10000;
const SWEEP_EVERY_MS = 5 * 60 * 1000;
let nextSweep = 0;

function sweep(now: number) {
  for (const [key, val] of windows) {
    if (now > val.reset) windows.delete(key);
  }
  nextSweep = now + SWEEP_EVERY_MS;
}

export function isRateLimited(key: string): boolean {
  const maxRequests = Number(process.env.RATE_LIMIT_MAX || 30);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
  const now = Date.now();
  if (now > nextSweep) sweep(now);

  const entry = windows.get(key);

  if (!entry || now > entry.reset) {
    // Prevent unbounded growth from spam
    if (windows.size >= MAX_ENTRIES) return true;
    windows.set(key, { count: 1, reset: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > maxRequests;
}
