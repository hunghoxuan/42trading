FROM node:20-alpine
WORKDIR /app
COPY webhook/package*.json ./
RUN npm ci --only=production --no-audit --no-fund
COPY webhook/ ./
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
