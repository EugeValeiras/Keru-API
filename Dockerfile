# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY apps ./apps
COPY libs ./libs
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3000
# El output del monorepo queda anidado (dist/apps/keru-api/apps/keru-api/src/main.js).
CMD ["node", "dist/apps/keru-api/apps/keru-api/src/main.js"]
