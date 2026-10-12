FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY common ./common
COPY services ./services
ARG SERVICE
ENV SERVICE=${SERVICE}
USER node
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1
CMD ["sh", "-c", "node services/${SERVICE}/index.js"]
