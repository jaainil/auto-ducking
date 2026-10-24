FROM rust:1.90-bookworm AS native
WORKDIR /native
COPY native/vad/Cargo.toml native/vad/Cargo.lock ./
COPY native/vad/src ./src
RUN cargo build --release --locked
WORKDIR /adaptive
COPY native/adaptive/Cargo.toml native/adaptive/Cargo.lock ./
COPY native/adaptive/src ./src
RUN rustup target add wasm32-unknown-unknown && cargo build --release --locked --target wasm32-unknown-unknown

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
COPY --from=native /native/target/release/audioduck-vad /app/native/vad/target/release/audioduck-vad
COPY --from=native /adaptive/target/wasm32-unknown-unknown/release/adaptive_ducking.wasm /app/public/wasm/adaptive_ducking.wasm
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

EXPOSE 10000

CMD ["npm", "start"]
