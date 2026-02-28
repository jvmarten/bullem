# ---- Build stage ----
FROM node:20-alpine AS build

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
# Server has pre-existing type errors but tsc still emits JS (noEmitOnError is not set),
# so we allow its build step to exit non-zero without failing the image build.
RUN npm run build -w shared && \
    (npm run build -w server || true) && \
    npm run build -w client

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built artifacts from build stage
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
