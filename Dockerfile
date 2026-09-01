FROM node:22-alpine AS build

RUN npm install -g pnpm@11

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/cli/package.json ./packages/cli/
COPY packages/contracts/package.json ./packages/contracts/
RUN pnpm install --frozen-lockfile

COPY packages/contracts/ ./packages/contracts/
COPY packages/server/ ./packages/server/
RUN pnpm --filter @agent-land/contracts build
RUN pnpm --filter @agent-land/server build

FROM node:22-alpine

RUN apk add --no-cache sops age docker
RUN npm install -g pnpm@11

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/cli/package.json ./packages/cli/
COPY packages/contracts/package.json ./packages/contracts/
RUN pnpm install --frozen-lockfile --prod --filter "@agent-land/server..."

COPY --from=build /app/packages/server/dist/ ./packages/server/dist/
COPY --from=build /app/packages/contracts/dist/ ./packages/contracts/dist/
COPY agent-image/ /agent-image/

ENV NODE_ENV=production
ENV PORT=3000
ENV SECRETS_DIR=/app/secrets
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "packages/server/dist/server.js"]
