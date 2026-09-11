FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg python3 py3-pip \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]"
ENV YT_DLP_BIN=/opt/yt-dlp/bin/yt-dlp
COPY src/api/package*.json ./
RUN npm ci --only=production --no-audit --no-fund
COPY src/api/ ./
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
