# ======================================================
# Stage 1: Builder
# ======================================================
FROM oven/bun:1-alpine AS builder

WORKDIR /build

# Copy dependency files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Compile TypeScript to JavaScript for faster startup
RUN bun build src/index.ts --outdir ./dist --target bun --minify

# ======================================================
# Stage 2: Runner (Minimal Production Image)
# ======================================================
FROM oven/bun:1-alpine AS runner

# Install system utilities required for the app:
# - gnupg: for repository signing
# - ca-certificates: for HTTPS requests
RUN apk add --no-cache gnupg ca-certificates

WORKDIR /app

# Use the existing 'bun' user for security
USER bun

# Copy compiled code from builder
COPY --from=builder --chown=bun:bun /build/dist ./dist
COPY --from=builder --chown=bun:bun /build/package.json ./

# Create directories for configs, logs, and data
RUN mkdir -p /app/config/repos /app/logs /app/data && \
    chown -R bun:bun /app

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV CONFIG_PATH=/app/config
ENV LOG_PATH=/app/logs

# Entrypoint
CMD ["bun", "run", "dist/index.js"]
