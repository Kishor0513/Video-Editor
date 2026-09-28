# CutForge render worker: Node API + ffmpeg on one image.
# Build: docker build -t cutforge-server ./server
# Run:   docker run -p 8787:8787 --env-file ./server/.env cutforge-server
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/index.ts"]
