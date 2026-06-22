FROM node:20-alpine AS builder
WORKDIR /app
COPY src/admin/package*.json ./
RUN npm ci --no-audit --no-fund
COPY src/admin/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx/trading.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
