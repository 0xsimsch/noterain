FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
COPY client/package.json ./client/

RUN bun install

COPY . .

RUN bun run build

FROM oven/bun:1-slim AS production

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "dist/main.js"]
