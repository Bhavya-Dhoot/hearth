# Simulated Alexa+ host (Next.js 15). Build context is the REPO ROOT:
#   docker build -f apps/host-sim/Dockerfile -t hearth-host .
FROM node:22-slim

ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
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
RUN pnpm install --frozen-lockfile --filter @hearth/host-sim...

COPY packages packages
COPY apps/host-sim apps/host-sim
# @hearth/design-tokens/tokens.css is generated (dist/), so build it first; next build then compiles the workspace TS packages.
RUN pnpm --filter @hearth/design-tokens build
RUN NODE_ENV=production pnpm --filter @hearth/host-sim build

RUN chown -R node:node /app
USER node
WORKDIR /app/apps/host-sim

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
