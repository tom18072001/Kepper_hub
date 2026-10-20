# ---- WorkHub app (Node + Express + Prisma) ----
# Build context = thư mục gốc repo. Giữ cấu trúc app/server + app/web như khi chạy cục bộ.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY app/server/package.json app/server/package-lock.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY app/server/ ./
RUN npx prisma generate
COPY app/web/ /app/web/

# Chạy bằng tài khoản không phải root; thư mục tệp đính kèm là volume.
RUN mkdir -p /data/uploads && chown -R node:node /data /app/server/node_modules/.prisma && chmod +x docker-entrypoint.sh
USER node
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads WEB_DIR=/app/web
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
