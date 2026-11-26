import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { API_PREFIXES, xposedHost } from "./index.js";

/**
 * Node-only static hosting of the two mini-apps from ./dist, per hostname:
 *   XPOSED host    → ./dist/xposed at /
 *   anything else  → ./dist/public at /
 * The Worker build serves the same bundles from its assets binding instead.
 */
export function mountStaticApps(app: Hono) {
  const xposed = xposedHost();

  app.use("/*", async (c, next) => {
    if (API_PREFIXES.some((p) => c.req.path.startsWith(p))) return next();
    const host = (c.req.header("host") || "").toLowerCase();
    const isXposed = !!xposed && host === xposed;
    const root = isXposed ? "./dist/xposed" : "./dist/public";
    const handler = serveStatic({
      root,
      rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
    });
    return handler(c, next);
  });
  app.get("/*", async (c, next) => {
    if (API_PREFIXES.some((p) => c.req.path.startsWith(p))) return next();
    const host = (c.req.header("host") || "").toLowerCase();
    const isXposed = !!xposed && host === xposed;
    const root = isXposed ? "./dist/xposed" : "./dist/public";
    const handler = serveStatic({ root, path: "index.html" });
    return handler(c, next);
  });
}
