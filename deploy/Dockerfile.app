# syntax=docker/dockerfile:1
# testRex app image: API server + built web app.

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@testrex/api..." --filter "@testrex/web..."
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
ENV APP_VERSION=${APP_VERSION} GIT_COMMIT=${GIT_COMMIT}
RUN pnpm turbo run build --filter=@testrex/api --filter=@testrex/web

FROM node:22-slim
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="testrex-app" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.licenses="MIT OR Apache-2.0"
ENV NODE_ENV=production PORT=8080 STORAGE_DIR=/data/storage
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
COPY --from=build /repo/packages/db/migrations ./migrations
# Attachment storage (the compose "storage" volume). A fresh named volume copies this
# directory's owner and mode. Group-writable with setgid: the worker runs as another user in
# group 1000 and removes abandoned uploads.
RUN mkdir -p /data/storage && chown node:node /data/storage && chmod 2775 /data/storage
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["serve"]
