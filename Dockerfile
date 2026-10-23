FROM node:22-bookworm-slim

# Media processing requires FFmpeg/ffprobe on PATH.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

EXPOSE 10000

CMD ["npm", "start"]
