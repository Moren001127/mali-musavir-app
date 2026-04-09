FROM node:20-slim

RUN apt-get update && apt-get install -y openssl wget ca-certificates && rm -rf /var/lib/apt/lists/*

# Tesseract dil dosyalarını build sırasında indir (runtime indirme yok)
RUN mkdir -p /app/tessdata \
 && wget -q "https://github.com/tesseract-ocr/tessdata_fast/raw/main/tur.traineddata" \
         -O /app/tessdata/tur.traineddata \
 && wget -q "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata" \
         -O /app/tessdata/eng.traineddata \
 && echo "Dil dosyaları indirildi:" \
 && ls -lh /app/tessdata/

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
