FROM oven/bun:1 AS builder
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies and build the Next app (produces .next)
COPY package.json package-lock.json* ./
RUN bun install

# If a TypeScript Next config exists, ensure the builder has TypeScript available
RUN if [ -f next.config.ts ]; then \
      bun add typescript ; \
    fi

# Copy the rest of the source and run the Next build
COPY . .
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install only production deps in the final image
COPY package.json package-lock.json* ./
RUN bun install --production

# Copy build output and public assets from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
## copy next config if present (handle .js/.mjs/.ts via shell to avoid COPY glob issues)
RUN if [ -f /app/next.config.mjs ]; then cp /app/next.config.mjs /app/ ; fi || true
RUN if [ -f /app/next.config.js ]; then cp /app/next.config.js /app/ ; fi || true
RUN if [ -f /app/next.config.ts ]; then cp /app/next.config.ts /app/ ; fi || true

EXPOSE 54567

# Start the Next server, bind to 0.0.0.0 so containers can receive requests
CMD ["bun", "run", "start", "--", "-p", "54567", "-H", "0.0.0.0"]