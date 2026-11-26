# ── build the web UI ──────────────────────────────────────────────────────────
FROM node:26-bookworm-slim AS web
WORKDIR /app
RUN npm install -g pnpm@11 --no-fund --no-audit
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY web ./web
COPY shared ./shared
RUN pnpm --filter @argus/web build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:26-bookworm-slim

# argus drives a system browser rather than downloading one, so Chromium is the
# only heavy dependency. The fonts matter more than they look: without them
# screenshots render tofu boxes for anything outside Latin-1.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation fonts-noto fonts-noto-color-emoji \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install -g pnpm@11 --no-fund --no-audit
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --prod --frozen-lockfile --filter @argus/server

COPY server ./server
COPY shared ./shared
COPY --from=web /app/web/dist ./web/dist

ENV NODE_ENV=production \
    ARGUS_CHROME=/usr/bin/chromium \
    ARGUS_DATA=/data \
    ARGUS_HOST=0.0.0.0 \
    ARGUS_PORT=8797

# Watch definitions, change history and snapshots all live here.
VOLUME /data
EXPOSE 8797

# Node 26 runs the TypeScript sources directly — there is no server build step.
CMD ["node", "server/src/index.ts"]
