# =============================================================================
# API image. Build context = the monorepo root:
#   docker build -f apps/api/Dockerfile --target production -t erp-api .
#
# npm workspaces hoist every dependency into the ROOT node_modules, so there is
# no apps/api/node_modules to copy. The @erp/* packages are consumed through
# their compiled `dist/` (their package.json `main`), and `dist/` is excluded by
# .dockerignore, so they have to be built inside the image.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 – Install dependencies (also the base of the `dev` target)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/validators/package.json ./packages/validators/
COPY packages/constants/package.json ./packages/constants/

RUN npm ci --workspace=apps/api --include-workspace-root

# -----------------------------------------------------------------------------
# Stage 2 – Build packages, Prisma client and the Nest app
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig*.json ./
COPY package.json ./
COPY packages ./packages

# The packages do not depend on each other (validators only needs zod).
RUN npm run build -w @erp/shared-types -w @erp/constants -w @erp/validators

COPY apps/api ./apps/api

RUN npx prisma generate --schema=apps/api/src/database/prisma/schema.prisma
RUN npm run build -w @erp/api

# -----------------------------------------------------------------------------
# Stage 3 – Dev target. docker-compose selects it with `target: dev`.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS dev

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate --schema=apps/api/src/database/prisma/schema.prisma

WORKDIR /app/apps/api

EXPOSE 3000

CMD ["npm", "run", "dev"]

# -----------------------------------------------------------------------------
# Stage 4 – Production image (LAST on purpose: a plain `docker build`, which is
# what Coolify runs unless told a target, must produce this one, not `dev`)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

RUN apk add --no-cache libc6-compat openssl dumb-init

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

# Same layout as in the build stage, so the node_modules/@erp/* symlinks
# (→ ../../packages/*) and the Prisma schema path keep resolving.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/src/database/prisma ./apps/api/src/database/prisma
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh

RUN chmod +x ./apps/api/docker-entrypoint.sh && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs && \
    chown -R nestjs:nodejs /app/apps/api
USER nestjs

WORKDIR /app/apps/api

EXPOSE 3001

# The health route lives under the global prefix. Shell form, so $PORT expands.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/api/v1/health" || exit 1

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
