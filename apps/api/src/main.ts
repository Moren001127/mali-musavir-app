import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });
  // Helmet — CORS-friendly: cross-origin resource policy gevşetildi
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: (origin, callback) => {
      // Origin'siz istekler (server-to-server, curl) — izin ver
      if (!origin) return callback(null, true);

      const allowedExact = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://portal.morenmusavirlik.com',
        'https://mali-musavir-app-web.vercel.app',
        'https://app.mihsap.com',
        'https://ofis.mihsap.com.tr',
        'https://luca.com.tr',
        'https://luca.net.tr',
      ];
      const allowedRegex = [
        /\.mihsap\.com$/,
        /\.mihsap\.com\.tr$/,
        /\.vercel\.app$/,
        /\.luca\.com\.tr$/,
        /\.luca\.net\.tr$/,
        /\.morenmusavirlik\.com$/,
      ];

      if (allowedExact.includes(origin)) return callback(null, true);
      if (allowedRegex.some((r) => r.test(origin))) return callback(null, true);

      console.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(new Error(`CORS: Origin ${origin} not allowed`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  console.log(`API is running on: http://localhost:${port}/api/v1`);
}
bootstrap();
