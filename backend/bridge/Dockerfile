# so101-bridge: MCP server (/mcp) + tab relay (/tab) for printedrobotics.cz
# Build context: backend/bridge.  docker build -t so101-bridge .
# Runs the TypeScript sources directly with Node's built-in type stripping (no build step, no dev deps).
# Pin the base image by digest in CI (node:24-alpine@sha256:…).
FROM node:24-alpine

# Runtime env (set by backend/deploy/compose.yml): APP_VERSION, TRUST_PROXY=1, ALLOWED_ORIGINS. See docs/mcp.md.
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "src/main.ts"]
