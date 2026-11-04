# syntax=docker/dockerfile:1.7
# One image runs the web server, the background workers, migrations and backups.
# Build: docker build -t stardust-itinerary .   Run modes: see deploy/container/entrypoint.sh
ARG NODE_IMAGE=node:24.19.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.19.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build \
  && node scripts/prepare-standalone.mjs \
  && rm -rf .next/cache

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE} AS runtime
# tini reaps provider SDK subprocesses; age and the PostgreSQL 17 client serve backups and restores.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl tini age; \
  install -d /usr/share/postgresql-common/pgdg; \
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends postgresql-client-17; \
  rm -rf /var/lib/apt/lists/*; \
  groupadd --system --gid 10001 stardust; \
  useradd --system --uid 10001 --gid stardust --home-dir /home/stardust --create-home stardust

WORKDIR /app
ARG STARDUST_BUILD_VERSION=
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  HOME=/home/stardust \
  STARDUST_BUILD_VERSION=${STARDUST_BUILD_VERSION}

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json tsconfig.json next.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY database ./database
COPY --chmod=0755 deploy/container ./deploy/container

USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/container/entrypoint.sh"]
CMD ["web"]
