FROM oven/bun:1.1 AS base

# System deps for FFmpeg + native modules (opus, sodium)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (leverages layer cache)
COPY package.json bun.lockb tsconfig.json ./
RUN bun install --frozen-lockfile

# Copy source (songs can be mounted as a volume; see VOLUME below)
COPY src ./src
COPY README.md ./
COPY songs ./songs

# Mark songs as a volume so you can mount your host folder easily
VOLUME ["/app/songs"]

ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]
