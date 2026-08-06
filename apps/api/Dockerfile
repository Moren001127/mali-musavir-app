FROM node:20-slim

# Sistem paketleri + Chromium (Playwright headless ile Luca scraping için)
# git: @whiskeysockets/baileys'in git+ transitif bağımlılıkları için gerekli
RUN apt-get update && apt-get install -y \
    openssl wget ca-certificates git \
    qpdf \
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
# NOT: @whiskeysockets/baileys -> libsignal-node git tarball'ı codeload.github.com'dan
# çekiliyor; --no-frozen-lockfile her build'de ref'i yeniden çözdüğü için (getRepoRefs)
# GitHub yavaş/rate-limit olunca install flaky şekilde patlıyordu (deploy yazı-tura).
# Çözüm: install'ı 5 denemeye kadar 15s backoff'la tekrarla — resolution mantığı değişmez.
RUN n=0; until pnpm install --no-frozen-lockfile; do \
      n=$((n+1)); \
      if [ "$n" -ge 5 ]; then echo ">> pnpm install 5 denemede basarisiz oldu"; exit 1; fi; \
      echo ">> pnpm install basarisiz (codeload/git flaky olabilir); ${n}. tekrar 15s sonra..."; \
      sleep 15; \
    done

# Railway Linux build'lerinde pnpm optional native paketleri bazen sharp'in libvips
# binary'sini eksik birakabiliyor. Runtime'a gecmeden linux-x64 sharp kurulumunu
# npm ile garanti et ve build asamasinda require ederek dogrula.
RUN mkdir -p /tmp/sharp-linux \
 && npm install --prefix /tmp/sharp-linux --include=optional --os=linux --cpu=x64 sharp@0.34.5 \
 && rm -rf /app/apps/api/node_modules/sharp /app/apps/api/node_modules/@img /app/apps/api/node_modules/detect-libc /app/apps/api/node_modules/semver \
 && cp -R /tmp/sharp-linux/node_modules/. /app/apps/api/node_modules/ \
 && cd /app/apps/api \
 && node -e "const sharp=require('sharp'); console.log('>> sharp ok, libvips=' + sharp.versions.vips)"

# Fallback: playwright-core kesin olarak yüklensin (lockfile/cache sorunlarına karşı)
# Hem root hem apps/api altında node_modules/playwright-core kontrolü
RUN cd /app/apps/api \
 && if [ ! -d node_modules/playwright-core ] && [ ! -d /app/node_modules/playwright-core ]; then \
      echo ">> playwright-core bulunamadı, npm ile ekleniyor..."; \
      npm install --no-save --prefix /app/apps/api playwright-core@^1.47.2; \
    fi \
 && echo ">> playwright-core durumu:" \
 && ls -la /app/apps/api/node_modules/playwright-core/package.json 2>/dev/null \
    || ls -la /app/node_modules/playwright-core/package.json 2>/dev/null \
    || (echo "HATA: playwright-core hâlâ yok!" && exit 1)

# Prisma generate
RUN cd apps/api && pnpm exec prisma generate

# Build
RUN cd apps/api && pnpm run build

WORKDIR /app/apps/api

EXPOSE ${PORT:-3001}

CMD ["sh", "-c", "node /app/apps/api/scripts/cleanup-failed-migrations.js && npx prisma migrate deploy && node /app/apps/api/dist/main"]
