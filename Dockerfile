FROM node:22-alpine AS base
RUN corepack enable

# Build reseller mini-app
FROM base AS mini-app-build
WORKDIR /app/src/mini-app
COPY src/mini-app/package.json src/mini-app/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY src/mini-app/ ./
RUN pnpm build

# Build customer mini-app
FROM base AS customer-app-build
WORKDIR /app/src/customer-app
COPY src/customer-app/package.json src/customer-app/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY src/customer-app/ ./
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
COPY --from=mini-app-build /app/src/mini-app/dist ./dist/public
COPY --from=customer-app-build /app/src/customer-app/dist ./dist/customer

EXPOSE 3000
CMD ["node", "dist/index.js"]
