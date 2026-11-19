# Multi-stage: build the Vite app, then serve it with Node + Express.
# Stage 1 — build the frontend (needs dev deps: vite, tailwind, eslint).
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — runtime (prod deps only: express, pg, frontend runtime libs).
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg converts voice-note recordings to MP3 server-side
# (server/voiceNote.js) — the one format every phone plays.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY server ./server
COPY migrations ./migrations
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "server.js"]
