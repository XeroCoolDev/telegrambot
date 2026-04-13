const windows = new Map<string, { count: number; reset: number }>();

const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX || 30);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const MAX_ENTRIES = 10000;

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of windows) {
    if (now > val.reset) windows.delete(key);
  }
}, 5 * 60 * 1000);

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now > entry.reset) {
    // Prevent unbounded growth from spam
    if (windows.size >= MAX_ENTRIES) return true;
    windows.set(key, { count: 1, reset: now + WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > MAX_REQUESTS;
}
