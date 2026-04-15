FROM node:22-alpine AS base
RUN corepack enable

# Build xerocool (reseller) mini-app
FROM base AS xerocool-app-build
WORKDIR /app/src/xerocool-app
COPY src/xerocool-app/package.json src/xerocool-app/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY src/xerocool-app/ ./
RUN pnpm build

# Build xposed (customer) mini-app
FROM base AS xposed-app-build
WORKDIR /app/src/xposed-app
COPY src/xposed-app/package.json src/xposed-app/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY src/xposed-app/ ./
RUN pnpm build

# Build server
FROM base AS server-build
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm build

# Production
FROM base AS production
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
COPY --from=server-build /app/dist ./dist
COPY --from=xerocool-app-build /app/src/xerocool-app/dist ./dist/public
COPY --from=xposed-app-build /app/src/xposed-app/dist ./dist/xposed

EXPOSE 3000
CMD ["node", "--no-deprecation", "dist/index.js"]
