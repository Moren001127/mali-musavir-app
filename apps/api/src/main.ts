import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';

function csv(value?: string | null) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildAllowedOrigins() {
  const configured = csv(process.env.CORS_ALLOWED_ORIGINS);
  const defaults = [
    process.env.FRONTEND_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://portal.morenmusavirlik.com',
    'https://app.morenmusavirlik.com',
    'https://morenmusavirlik.com',
    'https://www.morenmusavirlik.com',
    'https://ofis.mihsap.com.tr',
    'https://app.mihsap.com', // Mihsap agent (tarayıcı uzantısı) bu origin'den komut çeker
  ].filter(Boolean) as string[];

  if (process.env.NODE_ENV !== 'production') {
    defaults.push('http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000');
  }

  return new Set([...defaults, ...configured]);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const allowedOrigins = buildAllowedOrigins();
  // Agent origin'leri (Luca/Mihsap alt alan adları) her zaman izinli — Railway env
  // değişkeni silinse bile tarayıcı tabanlı agent komut çekebilsin diye sabit eklendi.
  const allowedSuffixes = [
    ...csv(process.env.CORS_ALLOWED_SUFFIXES),
    '.luca.com.tr',
    '.luca.net.tr',
    '.mihsap.com',
  ];

  // Multipart upload'larda body-parser calismaz; buyuk ZIP/PDF'ler zaten multer ile alinir.
  // JSON'u sinirsiza yakin tutmak Railway'de ajanlar reconnect oldugunda buyuk meta/base64
  // payload'larin Node'u V8 seviyesinde dusurmesine yol acabiliyor.
  const jsonLimit = process.env.API_JSON_LIMIT || '25mb';
  app.useBodyParser('json', { limit: jsonLimit });
  app.useBodyParser('urlencoded', { limit: jsonLimit, extended: true });

  // CORS — Helmet'ten ÖNCE kuruluyor ki Access-Control-Allow-Origin her response'a çıksın
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowed =
        allowedOrigins.has(origin) ||
        allowedSuffixes.some((suffix) => origin.endsWith(suffix));

      if (allowed) return callback(null, true);
      console.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(null, false); // Error yerine false — sessiz reddet
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'X-Agent-Token', // Moren Agent extension için
    ],
    exposedHeaders: ['Content-Disposition', 'X-Moren-Render-Source'],
    maxAge: 600,
  });

  // Helmet — minimal, CORS'u bozmayan ayarlar
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Dağıtımda eski kopya SIGTERM alınca onModuleDestroy çalışsın — Baileys
  // soketi düzgün bırakılır, yeni kopyayla "conflict" yarışı önlenir
  // (2026-06-10: çakışma WhatsApp oturumunu düşürüp QR'a döndürmüştü).
  app.enableShutdownHooks();

  const port = process.env.PORT || process.env.API_PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`API is running on: http://localhost:${port}/api/v1`);
}
bootstrap();
