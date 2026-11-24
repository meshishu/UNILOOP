FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-4000}/healthz || exit 1
# Node >= 22.18 runs TypeScript directly (type stripping); there is no build step.
CMD ["node", "src/server.ts"]
