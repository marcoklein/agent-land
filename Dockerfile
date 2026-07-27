FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc

FROM node:22-alpine

RUN apk add --no-cache sops age

WORKDIR /app

COPY --from=build /app/dist/ ./dist/
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/views/ ./dist/views/
COPY public/ ./public/
COPY agent-image/ /agent-image/

ENV NODE_ENV=production
ENV PORT=3000
ENV SECRETS_DIR=/app/secrets
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
