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

  // Limit yüksek — multipart upload'larda body-parser çalışmaz ama Luca runner
  // bazı endpoint'lerde JSON gönderiyor. Büyük e-fatura ZIP'leri için 200mb.
  app.useBodyParser('json', { limit: '200mb' });
  app.useBodyParser('urlencoded', { limit: '200mb', extended: true });

  // CORS — Helmet'ten ÖNCE kuruluyor ki Access-Control-Allow-Origin her response'a çıksın
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowed =
        /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /\.mihsap\.com$/.test(origin) ||
        /\.mihsap\.com\.tr$/.test(origin) ||
        /\.morenmusavirlik\.com$/.test(origin) ||
        /\.vercel\.app$/.test(origin) ||
        /\.luca\.com\.tr$/.test(origin) ||
        /\.luca\.net\.tr$/.test(origin) ||
        [
          'https://app.mihsap.com',
          'https://ofis.mihsap.com.tr',
          'https://luca.com.tr',
          'https://luca.net.tr',
        ].includes(origin);

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
    exposedHeaders: ['Content-Disposition'],
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

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  console.log(`API is running on: http://localhost:${port}/api/v1`);
}
bootstrap();
