# printedrobotics api: Node 24 runs the TypeScript sources directly (type stripping), so the
# runtime image has no node_modules at all. Typecheck + tests run in CI before the build.
FROM node:24-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    PORT=8081 \
    DB_PATH=/data/events.db \
    TRUST_PROXY=1
WORKDIR /app
COPY package.json ./
COPY src ./src
# /data is the SQLite volume, /jobs the forge job volume (shared with forge-worker, uid 1002, through gid 1000);
# a fresh named volume inherits this ownership.
RUN mkdir -p /data /jobs && chown node:node /data /jobs && chmod 2770 /jobs
USER node
EXPOSE 8081
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
LABEL org.opencontainers.image.source="https://github.com/artigrib/prlanding" \
      org.opencontainers.image.description="printedrobotics.cz api (event counter, health)" \
      org.opencontainers.image.licenses="NOASSERTION"
