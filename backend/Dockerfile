# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy source code
COPY src ./src

# Install dependencies and build
RUN npm ci && npm run build

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built app from builder
COPY --from=builder /app/dist ./dist

# Copy frontend files to serve (from repo root)
COPY frontend ./frontend

# Expose port
EXPOSE 8080

# Start app
CMD ["node", "dist/server.js"]
