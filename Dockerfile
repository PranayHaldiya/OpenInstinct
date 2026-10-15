# One image for Maritime: OI_ROLE=user runs one person's agent, OI_ROLE=hub
# runs the shared Telegram router and job index. Postgres runs inside the VM
# with its data on the persistent /data volume.

FROM node:24-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
# Build-time placeholders only: env validation runs while Next collects pages.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
  KERNEL_API_KEY=build \
  BETTER_AUTH_URL=http://localhost:3000 \
  BETTER_AUTH_SECRET=build-only-secret-build-only-secret-0000 \
  SECRET_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  NEXT_OUTPUT_STANDALONE=1
RUN pnpm exec eve build && pnpm exec next build
# The launcher's own dependencies, outside Next's traced output.
RUN mkdir -p /launcher && cd /launcher \
  && npm init -y >/dev/null \
  && npm install --omit=dev drizzle-orm@0.45.2 pg@8.23.0 zod@4.5.4

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/.output ./.output
COPY --from=build /app/.eve ./.eve
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /launcher/node_modules ./scripts/vm/node_modules
COPY scripts/vm/start.ts ./scripts/vm/start.ts
# Maritime re-executes CMD as one flattened string, so launch a real program.
CMD ["/usr/local/bin/node", "/app/scripts/vm/start.ts"]
