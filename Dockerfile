# ─────────────────────────────────────────────
# Opportunity Hunter — Production Dockerfile
# Optimized for Nosana decentralized GPU network
# ─────────────────────────────────────────────

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# No native build tools needed — node-sqlite3-wasm is pure WASM
RUN apk add --no-cache git

COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDeps for build)
RUN npm ci

COPY src/ ./src/
COPY config/ ./config/

# Compile TypeScript
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app


COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config

# Copy dashboard static files
COPY public/ ./public/

# Create data directory for SQLite + logs
RUN mkdir -p /app/data/logs && chmod 777 /app/data

# ─────────────────────────────────────────────
# Environment defaults
# ─────────────────────────────────────────────
ENV NODE_ENV=production
ENV INFERENCE_PROVIDER=nosana
ENV MODEL_NAME=Qwen/Qwen3.5-27B-Instruct-AWQ
ENV PIPELINE_INTERVAL_MINUTES=30
ENV SCORE_THRESHOLD=60
ENV DASHBOARD_PORT=3000
ENV DATA_DIR=/app/data
ENV LOG_LEVEL=info

# ─────────────────────────────────────────────
# Ports & Health
# ─────────────────────────────────────────────
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/stats || exit 1

# Start main process
CMD ["node", "dist/index.js"]
