FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 REPORT_DATA_DIR=/data/reports
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/reports && chown -R node:node /data
USER node
EXPOSE 8787
VOLUME ["/data/reports"]
CMD ["node", "scripts/server.mjs"]
