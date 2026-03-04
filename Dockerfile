# ---- Build stage ----
FROM node:22-alpine AS build

WORKDIR /app

# Copy root package files and workspace package.json files for dependency install
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci

# Copy all source code
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY tsconfig.base.json ./

# Build all packages (shared -> server -> client)
RUN npm run build

# ---- Production stage ----
FROM node:22-alpine

# Run as non-root for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# Install production dependencies only
RUN npm ci --omit=dev && chown -R nodejs:nodejs /app

# Copy built artifacts from build stage
COPY --from=build --chown=nodejs:nodejs /app/shared/dist shared/dist
COPY --from=build --chown=nodejs:nodejs /app/server/dist server/dist
COPY --from=build --chown=nodejs:nodejs /app/client/dist client/dist

USER nodejs

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "server/dist/index.js"]
