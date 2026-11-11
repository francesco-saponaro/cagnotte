FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
ARG EXPO_PUBLIC_API_URL=http://localhost:3001
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/domain/package.json packages/domain/
COPY packages/postgres/package.json packages/postgres/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/mobile ./apps/mobile
RUN pnpm --filter @cagnotte/mobile build

FROM nginx:alpine
COPY --from=build /repo/apps/mobile/dist /usr/share/nginx/html
COPY apps/mobile/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
