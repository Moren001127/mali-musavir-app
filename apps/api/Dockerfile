FROM node:20-alpine

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

CMD ["node", "dist/main"]
