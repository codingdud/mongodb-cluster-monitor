# Optimized Multi-stage Dockerfile for Mongo Cluster Monitor

# --- Stage 1: Build Frontend ---
FROM node:20-slim AS builder

WORKDIR /app/client

# Copy package files for client
COPY client/package*.json ./

# Install client dependencies
RUN npm install

# Copy client source code
COPY client/ ./

# Build client (outputs to ../public -> /app/public per vite.config.js)
RUN npm run build

# --- Stage 2: Production Environment ---
FROM node:20-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=4000
ENV POLL_MS=5000
ENV PROFILER_MS=15000
ENV SLOW_MS=100
ENV ALERT_LAG_MS=10000
ENV ALERT_OPS_LIMIT=2000

# Copy package files for backend
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy backend source and libraries
COPY server.js ./
COPY lib/ ./lib/

# Copy built frontend assets from builder stage
# (Vite builds to /app/public per vite.config.js since WORKDIR is /app/client)
COPY --from=builder /app/public ./public

# Expose the application port
EXPOSE 4000

# Start the application
CMD ["node", "server.js"]
