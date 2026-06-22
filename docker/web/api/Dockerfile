FROM node:20-alpine
WORKDIR /app
COPY src/api/package*.json ./
RUN npm ci --only=production --no-audit --no-fund
COPY src/api/ ./
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
