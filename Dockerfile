# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY backend/package*.json ./
COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN npm ci && npm run build

# Runtime stage
FROM node:18-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY frontend ./frontend

EXPOSE 8080

CMD ["node", "dist/server.js"]
