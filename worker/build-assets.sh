#!/usr/bin/env sh
# Build both mini-apps and lay them out for the Worker's assets binding:
#   public/app-xerocool/  ← src/xerocool-app/dist
#   public/app-xposed/    ← src/xposed-app/dist
# Same Vite builds the Dockerfile runs; nothing app-specific changes.
set -eu
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)

for app in xerocool-app xposed-app; do
  echo "==> building $app"
  (cd "$ROOT/src/$app" && pnpm install --frozen-lockfile && pnpm build)
done

rm -rf public
mkdir -p public
cp -R "$ROOT/src/xerocool-app/dist" public/app-xerocool
cp -R "$ROOT/src/xposed-app/dist" public/app-xposed
echo "==> assets ready in worker/public"
