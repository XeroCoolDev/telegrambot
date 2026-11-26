import type { XuiLine, XuiUser, XuiPackage } from "./types.js";
import type { EngineLine } from "./engine.js";
import { toXuiLine } from "./engine.js";
import { adminCall, adminCallWithTotal, adminList, resellerCall, toId, logFailure, type EngineParams } from "./client.js";
import { normaliseExpDate } from "./format.js";

/** Admin API — get any line by id */
export async function getLine(lineId: string): Promise<XuiLine | null> {
  const id = toId(lineId);
  if (!id) return null;
  try {
    return toXuiLine(await adminCall<EngineLine>("lines.get", { id }));
  } catch (e) {
    logFailure("getLine", e);
    return null;
  }
}

/**
 * Reseller API — get a single line. The Engine scopes every id to the
 * reseller's own tree and answers 404 outside it, so a null here means
 * "not yours or not there".
 */
export async function getLineAsReseller(
  resellerApiKey: string,
  lineId: string
): Promise<XuiLine | null> {
  const id = toId(lineId);
  if (!id || !resellerApiKey) return null;
  try {
    return toXuiLine(await resellerCall<EngineLine>(resellerApiKey, "lines.get", { id }));
  } catch (e) {
    logFailure("getLineAsReseller", e);
    return null;
  }
}

// password is included so the lines list can offer copy-to-clipboard without
// a second round trip per line — the same caller can already read it from
// /line/:id, so this exposes nothing new, just sooner.
const LINE_LIST_FIELDS =
  "id,username,password,owner_id,expires_at,max_connections,enabled,banned,status,is_trial,bouquet_ids,notes";

/**
 * Fetch every line owned by the given account ids: one paged
 * `lines.list` per owner, filtered server-side with `owner_id`, rather
 * than walking the whole panel (12k+ lines). Any owner failing fails the
 * whole call, as a partial list would silently hide lines.
 */
export async function getLinesForMembers(
  memberIds: (string | number)[]
): Promise<XuiLine[] | null> {
  const ids = [...new Set(memberIds.map(toId).filter((n): n is number => n !== null))];
  if (ids.length === 0) return [];

  try {
    const perOwner = await Promise.all(
      ids.map((owner_id) =>
        adminList<EngineLine>("lines.list", { owner_id, fields: LINE_LIST_FIELDS })
      )
    );
    // Belt and braces: never show a reseller a line that is not theirs, even
    // if the server-side owner filter were ever ignored. Logged so it is seen.
    const wanted = new Set(ids);
    const rows = perOwner.flat();
    const own = rows.filter((l) => wanted.has(Number(l.owner_id)));
    if (own.length !== rows.length) {
      console.error(`[xui] getLinesForMembers: dropped ${rows.length - own.length} line(s) whose owner_id was not in [${ids.join(",")}]`);
    }
    return own.map(toXuiLine).sort((a, b) => Number(b.id) - Number(a.id));
  } catch (e) {
    logFailure("getLinesForMembers", e);
    return null;
  }
}

/** Fetch all lines owned by a single account. */
export async function getUserLines(xuiUserId: string): Promise<XuiLine[] | null> {
  const id = toId(xuiUserId);
  if (!id) return null;
  return getLinesForMembers([id]);
}

/**
 * Admin API — change only the given fields on a line (`lines.update`
 * leaves everything else as it is). Field names are the Engine's:
 * `expires_at` (unix seconds, null = never), `max_connections`, `notes`…
 */
export async function editLine(
  lineId: string,
  fields: EngineParams
): Promise<boolean> {
  const id = toId(lineId);
  if (!id) return false;
  try {
    await adminCall<EngineLine>("lines.update", { id, ...fields });
    return true;
  } catch (e) {
    logFailure("editLine", e);
    return false;
  }
}

/** Reseller API — buy a new line with a package; its price is taken from the reseller's balance */
export async function createNewLine(
  resellerApiKey: string,
  packageId: string,
  resellerNotes = "",
  contact = ""
): Promise<XuiLine | null> {
  const package_id = toId(packageId);
  if (!package_id || !resellerApiKey) return null;
  try {
    const line = await resellerCall<EngineLine>(resellerApiKey, "lines.create", {
      package_id,
      notes: resellerNotes,
      contact,
    });
    return toXuiLine(line);
  } catch (e) {
    logFailure("createNewLine", e);
    return null;
  }
}

/** Add a package duration to a date (months and years follow the calendar). */
function addDuration(from: Date, duration: number, unit: string): Date {
  const d = new Date(from.getTime());
  if (unit === "years") d.setFullYear(d.getFullYear() + duration);
  else if (unit === "months") d.setMonth(d.getMonth() + duration);
  else if (unit === "days") d.setDate(d.getDate() + duration);
  else if (unit === "hours") d.setHours(d.getHours() + duration);
  return d;
}

/**
 * Extend a line via hybrid flow — the reseller's own `lines.update` with a
 * `package_id` applies the package and charges the reseller's balance
 * (the reseller can't set expiry or connections directly), then the admin
 * API sets the expiry the bot calculated and the package's connections.
 */
export async function extendLineHybrid(
  userData: XuiUser,
  lineData: XuiLine,
  selectedPackage: XuiPackage
): Promise<boolean> {
  // Unlimited lines (exp_date null/0) cannot be meaningfully extended — adding
  // a package duration to "now" would downgrade them to a finite expiry.
  if (normaliseExpDate(lineData.exp_date) === null) {
    console.error(`[xui] extendLineHybrid refused: line ${lineData.id} has no expiry`);
    return false;
  }
  const id = toId(lineData.id);
  const package_id = toId(selectedPackage.id);
  if (!id || !package_id || !userData.api_key) return false;

  try {
    await resellerCall<EngineLine>(userData.api_key, "lines.update", { id, package_id });
  } catch (e) {
    logFailure("extendLineHybrid (reseller lines.update)", e);
    return false;
  }

  // If the line is still valid, extend from its current expiry (customer
  // keeps unused time). If it's already expired, extend from now.
  const expTs = normaliseExpDate(lineData.exp_date);
  const now = Date.now();
  const base = new Date(expTs && expTs * 1000 > now ? expTs * 1000 : now);
  const duration = parseInt(selectedPackage.official_duration, 10);
  const newExpiry = addDuration(base, duration, selectedPackage.official_duration_in);

  return editLine(lineData.id, {
    expires_at: Math.floor(newExpiry.getTime() / 1000),
    max_connections: parseInt(selectedPackage.max_connections, 10),
  });
}

/** Admin API — delete a line */
export async function deleteLine(lineId: string): Promise<boolean> {
  const id = toId(lineId);
  if (!id) return false;
  try {
    await adminCall<null>("lines.delete", { id });
    return true;
  } catch (e) {
    logFailure("deleteLine", e);
    return false;
  }
}

/** Admin API — flip the line's own switch (not the administrator's ban) */
export async function toggleLineEnabled(
  lineId: string,
  enabled: boolean
): Promise<boolean> {
  const id = toId(lineId);
  if (!id) return false;
  const action = enabled ? "lines.enable" : "lines.disable";
  try {
    await adminCall<EngineLine>(action, { id });
    return true;
  } catch (e) {
    logFailure(action, e);
    return false;
  }
}

/**
 * Reseller API — update contact and/or notes on a line. `lines.update`
 * without a package changes only what is sent and costs nothing.
 */
export async function updateLineInfo(
  resellerApiKey: string,
  lineId: string,
  fields: { contact?: string; reseller_notes?: string }
): Promise<boolean> {
  const id = toId(lineId);
  if (!id || !resellerApiKey) return false;

  const params: EngineParams = { id };
  if (fields.contact !== undefined) params.contact = fields.contact;
  if (fields.reseller_notes !== undefined) params.notes = fields.reseller_notes;
  if (Object.keys(params).length === 1) return true;

  try {
    await resellerCall<EngineLine>(resellerApiKey, "lines.update", params);
    return true;
  } catch (e) {
    logFailure("updateLineInfo", e);
    return false;
  }
}

/**
 * Admin API — every line on the panel that is about to expire, for the daily
 * reminders. Two calls for the whole panel instead of one per reseller:
 *
 *  - `status: "expiring"` is the Engine's own filter: expires within the next
 *    14 days, which covers every reminder window the bot uses (REMINDER_DAYS).
 *  - a single newest-first page of `status: "expired"`, kept only where the
 *    expiry is less than a day old, so a line that lapsed at 03:00 is still
 *    reported as "expiring today" when the job runs at 09:00 — the behaviour
 *    the per-reseller listing had.
 *
 * Null on failure so the caller can tell "nothing expiring" from "panel down".
 */
export async function getExpiringLines(): Promise<XuiLine[] | null> {
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  try {
    const [expiring, recentlyExpired] = await Promise.all([
      adminList<EngineLine>("lines.list", { status: "expiring", fields: LINE_LIST_FIELDS }),
      adminCall<EngineLine[]>("lines.list", {
        status: "expired",
        sort: "expires_at",
        order: "desc",
        start: 0,
        limit: 200,
        fields: LINE_LIST_FIELDS,
      }),
    ]);
    const seen = new Set<number>();
    const rows: XuiLine[] = [];
    for (const l of [...expiring, ...(Array.isArray(recentlyExpired) ? recentlyExpired : [])]) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const line = toXuiLine(l);
      const ts = normaliseExpDate(line.exp_date);
      if (ts !== null && ts < dayAgo) continue; // older expiries from the "expired" page
      rows.push(line);
    }
    return rows;
  } catch (e) {
    logFailure("getExpiringLines", e);
    return null;
  }
}

/** The Engine's own `status` filter values for `lines.list`. */
export const LINE_LIST_STATUSES = ["active", "expiring", "expired", "disabled"] as const;
export type LineListStatus = (typeof LINE_LIST_STATUSES)[number];

export interface OwnerLinesPageQuery {
  ownerId: string | number;
  /** Engine filter: `expiring` means within the next 14 days. */
  status?: LineListStatus | null;
  /** Engine `search`: username, password, expiry date, connections, notes. */
  search?: string;
  sort?: "id" | "username" | "expires_at";
  order?: "asc" | "desc";
  start: number;
  limit: number;
}

/**
 * Admin API — ONE page of one owner's lines, filtered, searched and sorted
 * by the panel. This is what the dashboards use: a reseller with 4,000 lines
 * costs the same as one with 40, because the Worker only ever parses and
 * returns `limit` rows. `total` counts every matching row, for the pager.
 *
 * If the panel rejects the sort (an unknown key), the page is fetched again
 * unsorted rather than failing: a list in the wrong order beats no list.
 */
export async function listOwnerLinesPage(
  q: OwnerLinesPageQuery
): Promise<{ lines: XuiLine[]; total: number } | null> {
  const owner_id = toId(q.ownerId);
  if (!owner_id) return null;

  const params: EngineParams = {
    owner_id,
    start: Math.max(0, q.start),
    limit: Math.min(1000, Math.max(1, q.limit)),
    fields: LINE_LIST_FIELDS,
  };
  if (q.status) params.status = q.status;
  if (q.search) params.search = q.search;
  if (q.sort) {
    params.sort = q.sort;
    params.order = q.order ?? "asc";
  }

  try {
    let res: { data: EngineLine[]; total: number | null };
    try {
      res = await adminCallWithTotal<EngineLine[]>("lines.list", params);
    } catch (e) {
      if (!q.sort) throw e;
      logFailure("listOwnerLinesPage (sorted; retrying unsorted)", e);
      const { sort: _s, order: _o, ...unsorted } = params;
      res = await adminCallWithTotal<EngineLine[]>("lines.list", unsorted);
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    // Belt and braces, as in getLinesForMembers: never hand out a line that
    // is not this owner's even if the server-side filter were ever ignored.
    const own = rows.filter((l) => Number(l.owner_id) === owner_id);
    if (own.length !== rows.length) {
      console.error(`[xui] listOwnerLinesPage: dropped ${rows.length - own.length} line(s) not owned by ${owner_id}`);
    }
    return { lines: own.map(toXuiLine), total: res.total ?? own.length };
  } catch (e) {
    logFailure("listOwnerLinesPage", e);
    return null;
  }
}

/** How many of an owner's lines match a status — one call, one row, `meta.total`. */
export async function countOwnerLines(
  ownerId: string | number,
  status: LineListStatus
): Promise<number | null> {
  const page = await listOwnerLinesPage({ ownerId, status, start: 0, limit: 1 });
  return page ? page.total : null;
}
