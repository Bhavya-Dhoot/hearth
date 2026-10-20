# Hearth OAuth 2.1 authorization server. Build context is the REPO ROOT:
#   docker build -f apps/auth-server/Dockerfile -t hearth-auth .
FROM node:22-slim

ENV CI=true \
    NODE_ENV=production \
    PORT=4100
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# pnpm needs every workspace manifest to validate the lockfile; add new packages here.
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
# NODE_ENV=production must not skip devDependencies: tsx is a dev dependency and is the runtime.
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter @hearth/auth-server...

COPY packages packages
COPY apps/auth-server apps/auth-server

# Non-root. HEARTH_AUTH_PRIVATE_JWK (Secrets Manager) supplies the signing key in the cloud;
# locally the server writes .keys/ on first boot.
RUN mkdir -p apps/auth-server/.keys && chown -R node:node /app
USER node
WORKDIR /app/apps/auth-server

EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/.well-known/oauth-authorization-server').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
