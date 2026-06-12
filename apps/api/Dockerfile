# Single-service image: builds the React frontend (apps/web) and bakes it into
# the Fastify API image, which serves BOTH the SPA and /api/v1 from one Cloud
# Run service. Built from the monorepo root (COPY paths are repo-root-relative).

# --- Stage 1: build the web frontend -> apps/web/dist ---
FROM node:20-alpine AS webbuild
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
# Full workspace install (incl. dev deps) so Vite can build.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/
COPY project.config.js ./
# Public, build-time Vite env (safe to embed; the client key is public-safe and
# the transaction key never reaches the bundle). Passed as build args from
# Cloud Build; absent values just disable in-browser card tokenization.
ARG VITE_AUTHORIZE_NET_API_LOGIN=""
ARG VITE_AUTHORIZE_NET_CLIENT_KEY=""
ENV VITE_AUTHORIZE_NET_API_LOGIN=$VITE_AUTHORIZE_NET_API_LOGIN
ENV VITE_AUTHORIZE_NET_CLIENT_KEY=$VITE_AUTHORIZE_NET_CLIENT_KEY
RUN pnpm --filter @my-app/web build

# --- Stage 2: API runtime (prod deps only) + baked-in frontend ---
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Install API production dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --prod

# Copy API source
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/
COPY project.config.js ./

# Bring in the built frontend so the server can serve it at apps/web/dist
COPY --from=webbuild /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
CMD ["node", "apps/api/src/index.js"]
