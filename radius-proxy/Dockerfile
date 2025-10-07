FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies (use npm ci when a lockfile exists, otherwise fall back to npm install)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
      npm ci --omit=dev --no-audit --no-fund ; \
    else \
      npm install --omit=dev --no-audit --no-fund ; \
    fi

# If a TypeScript Next config exists, ensure the runtime has TypeScript available
RUN if [ -f next.config.ts ]; then \
      npm install --no-audit --no-fund typescript ; \
    fi

# Copy build output and public assets
COPY .next ./.next
COPY public ./public

# If you have Next config or other runtime files, copy them too
COPY next.config.* ./

EXPOSE 3000

# Start the Next server, bind to 0.0.0.0 so containers can receive requests
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]