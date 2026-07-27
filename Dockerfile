FROM node:22-alpine

RUN apk add --no-cache sops age

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY src/views/ ./src/views/
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=3000
ENV SECRETS_DIR=/app/secrets
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
