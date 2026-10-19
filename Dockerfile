# One image for all Node services. SERVICE decides which one runs (gateway, login, classes, ...)
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --chown=node:node common ./common
COPY --chown=node:node services ./services
ARG SERVICE
ENV SERVICE=${SERVICE}
# run as non-root user + healthcheck so docker ps shows (healthy)
USER node
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1
CMD ["sh", "-c", "node services/${SERVICE}/index.js"]
