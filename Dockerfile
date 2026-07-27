FROM node:22.14.0-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build:all

FROM dependencies AS production-dependencies
RUN pnpm prune --prod

FROM node:22.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install --no-install-recommends -y util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/uploads \
    && chown node:node /app/uploads
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod 755 /usr/local/bin/docker-entrypoint
EXPOSE 6670 8090
ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]
CMD ["node", "dist/core/gateway/index.js"]
