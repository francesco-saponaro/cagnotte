FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/handlers/package.json packages/handlers/
COPY packages/postgres/package.json packages/postgres/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @cagnotte/domain --filter @cagnotte/contracts --filter @cagnotte/handlers --filter @cagnotte/postgres --filter @cagnotte/api build

FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo ./
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
