# Control Hub — production image (Next.js)
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js expects `public/`; repo may ship only static assets later — dir must exist for runner COPY.
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
# Dummy env vars so module-level code (pg pool, JWT secret) doesn't throw during
# Next.js static analysis at build time. Real values come from docker-compose at runtime.
ENV JWT_ACCESS_SECRET=build-time-placeholder
ENV JWT_REFRESH_SECRET=build-time-placeholder
ENV DATABASE_URL=postgresql://build:build@localhost/build
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Runtime tools for scripts/application/ch-deploy.sh (same entrypoint as POST /api/update).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    gosu \
    iproute2 \
    psmisc \
    socat \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app/scripts

# Run as root so entrypoint can chown mounted volumes, then drops to nextjs via gosu
EXPOSE 42069
ENV HOSTNAME=0.0.0.0
ENV PORT=42069
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||42069),(r)=>process.exit(r.statusCode&&r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start:network"]
