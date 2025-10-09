FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies using bun
COPY package.json package-lock.json* ./
RUN bun install --production

# If a TypeScript Next config exists, ensure the runtime has TypeScript available
RUN if [ -f next.config.ts ]; then \
      bun add typescript ; \
    fi

# Copy build output and public assets
COPY .next ./.next
COPY public ./public

# If you have Next config or other runtime files, copy them too
COPY next.config.* ./

EXPOSE 54567

# Start the Next server, bind to 0.0.0.0 so containers can receive requests
CMD ["bun", "run", "start", "--", "-p", "54567", "-H", "0.0.0.0"]