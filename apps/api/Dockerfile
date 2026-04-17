FROM node:20-slim

# Sistem paketleri + Chromium (Playwright headless ile Luca scraping için)
RUN apt-get update && apt-get install -y \
    openssl wget ca-certificates \
    chromium \
    fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Playwright'ın kendi Chromium'unu indirmesini engelle — sistem Chromium'u kullan
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROMIUM_PATH=/usr/bin/chromium

# Tesseract dil dosyalarını build sırasında indir (runtime indirme yok)
RUN mkdir -p /app/tessdata \
 && wget -q "https://github.com/tesseract-ocr/tessdata_fast/raw/main/tur.traineddata" \
         -O /app/tessdata/tur.traineddata \
 && wget -q "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata" \
         -O /app/tessdata/eng.traineddata \
 && echo "Dil dosyaları:" && ls -lh /app/tessdata/

WORKDIR /app

# pnpm kur
RUN npm install -g pnpm

# Monorepo root dosyalarını kopyala
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Shared package
COPY packages/shared ./packages/shared

# API package
COPY apps/api ./apps/api

# Bağımlılıkları yükle
RUN pnpm install --no-frozen-lockfile

# Prisma generate
RUN cd apps/api && pnpm exec prisma generate

# Build
RUN cd apps/api && pnpm run build

WORKDIR /app/apps/api

EXPOSE ${PORT:-3001}

CMD ["sh", "-c", "npx prisma migrate deploy && node /app/apps/api/dist/main"]
