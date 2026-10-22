FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run typecheck && bun run build

FROM oven/bun:1.4.3 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./
RUN mkdir -p /app/.keys && chown bun:bun /app/.keys && chmod 700 /app/.keys
USER bun
EXPOSE 54567
CMD ["bun", "dist/server.js"]
