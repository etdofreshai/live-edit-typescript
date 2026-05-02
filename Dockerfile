FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

COPY server ./server

FROM node:22-bookworm-slim AS runtime

RUN useradd --uid 1001 --create-home --shell /usr/sbin/nologin app \
  && mkdir -p /app/targets \
  && chown -R app:app /app

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/server ./server

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

USER app

CMD ["node", "--import", "tsx", "server/index.ts"]
