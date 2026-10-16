FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/admin/package.json src/admin/package.json
COPY src/pos/package.json src/pos/package.json
RUN pnpm install --filter @trading/admin... --filter @trading/pos... --frozen-lockfile
COPY src/admin/ src/admin/
COPY src/pos/ src/pos/
RUN pnpm --dir src/admin build

FROM nginx:alpine
COPY --from=builder /app/src/admin/dist /usr/share/nginx/html
COPY docker/nginx/trading.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
