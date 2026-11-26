/**
 * Cloudflare Workers storage adapter over a D1 binding. D1 is SQLite
 * underneath, so the statements in `statements.ts` run unchanged; the schema
 * is created by `worker/migrations/*.sql` (`wrangler d1 migrations apply`)
 * rather than on boot, because a Worker has no boot.
 *
 * Typed against a minimal local interface instead of @cloudflare/workers-types
 * so the Node build compiles this file without that dependency.
 */
import { STATEMENTS, normaliseParams, type AppDb, type SqlParam, type Stmt } from "./statements.js";

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedLike;
  /** Runs every statement in one implicit transaction. */
  batch(statements: D1PreparedLike[]): Promise<{ meta?: { changes?: number } }[]>;
}

export function createD1Db(source: D1Like | (() => D1Like)): AppDb {
  const d1 = () => (typeof source === "function" ? source() : source);

  const prepared = Object.fromEntries(
    Object.entries(STATEMENTS).map(([name, sql]) => {
      const wrapped: Stmt = {
        async get<T>(...params: SqlParam[]) {
          const row = await d1().prepare(sql).bind(...normaliseParams(params)).first<T>();
          return row ?? undefined;
        },
        async all<T>(...params: SqlParam[]) {
          const res = await d1().prepare(sql).bind(...normaliseParams(params)).all<T>();
          return res.results ?? [];
        },
        async run(...params: SqlParam[]) {
          const res = await d1().prepare(sql).bind(...normaliseParams(params)).run();
          return { changes: res.meta?.changes ?? 0 };
        },
      };
      return [name, wrapped];
    })
  ) as { [K in keyof typeof STATEMENTS]: Stmt };

  return {
    ...prepared,
    async deleteUserCascade(telegramId: number) {
      const [payments, users] = await d1().batch([
        d1().prepare(STATEMENTS.deleteUserPayments).bind(telegramId),
        d1().prepare(STATEMENTS.deleteUserRow).bind(telegramId),
      ]);
      return {
        payments: payments?.meta?.changes ?? 0,
        users: users?.meta?.changes ?? 0,
      };
    },
  };
}
