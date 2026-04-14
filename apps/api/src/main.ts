import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'https://portal.morenmusavirlik.com',
      'https://mali-musavir-app-web.vercel.app',
      'https://app.mihsap.com',
      'https://ofis.mihsap.com.tr',
      /\.mihsap\.com$/,
      /\.mihsap\.com\.tr$/,
      /\.vercel\.app$/,
    ],
    credentials: true,
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
