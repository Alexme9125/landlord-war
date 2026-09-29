FROM node:24-bookworm-slim

WORKDIR /app

# The lockfile is committed with the project so builds install reproducibly.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && mkdir -p /app/data \
    && chown node:node /app/data

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    ORIGIN=https://example.com \
    COOKIE_SECURE=true

USER node

EXPOSE 3001

CMD ["npm", "start"]
