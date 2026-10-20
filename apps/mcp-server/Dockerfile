# Hearth MCP server. Build context is the REPO ROOT:
#   docker build -f apps/mcp-server/Dockerfile -t hearth-mcp .
# Runs TypeScript directly with tsx (same as `pnpm --filter @hearth/mcp-server start`).
FROM node:22-slim

ENV CI=true \
    NODE_ENV=production \
    PORT=4200
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# 1. Workspace manifests + lockfile only, so the install layer is cached until a dependency changes.
#    pnpm needs every workspace manifest to validate the lockfile; add new packages here.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/mcp-server/package.json apps/mcp-server/package.json
COPY apps/auth-server/package.json apps/auth-server/package.json
COPY apps/host-sim/package.json apps/host-sim/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/home-graph/package.json packages/home-graph/package.json
COPY packages/host-sim-core/package.json packages/host-sim-core/package.json
COPY packages/parts-catalog/package.json packages/parts-catalog/package.json
COPY packages/playbooks/package.json packages/playbooks/package.json
COPY packages/widgets/package.json packages/widgets/package.json
COPY infra/cdk/package.json infra/cdk/package.json
# NODE_ENV=production must not skip devDependencies: tsx (runtime) and vite (widgets build) are dev deps.
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter @hearth/mcp-server...

# 2. Sources, then build the MCP Apps widgets (dist/ui/*.html, served as ui:// resources).
COPY packages packages
COPY apps/mcp-server apps/mcp-server
COPY docs docs
RUN pnpm --filter @hearth/widgets build

# 3. Non-root; the repo falls back to a JSON file under .data when HEARTH_DDB_TABLE is unset.
RUN mkdir -p apps/mcp-server/.data apps/mcp-server/.outbox && chown -R node:node /app
USER node
WORKDIR /app/apps/mcp-server

EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4200)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
