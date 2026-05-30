import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { hostname } from 'os';
import { PrismaModule } from '../prisma/prisma.module';
import { PortalAutomationModule } from './portal-automation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    PortalAutomationModule,
  ],
})
class PortalAutomationLocalWorkerModule {}

function defaultDeviceId() {
  return `office-${hostname().replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
}

async function bootstrap() {
  process.env.PORTAL_AUTOMATION_RUNNER_KIND ||= 'local';
  process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_ENABLED ||= 'true';
  process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_JOB_TYPES ||= 'EBEYANNAME_DAILY_DOWNLOAD';
  process.env.PORTAL_AUTOMATION_RAILWAY_DEVICE_ID ||= defaultDeviceId();
  process.env.PORTAL_AUTOMATION_DISABLE_NIGHTLY ||= 'true';

  const logger = new Logger('PortalAutomationLocalWorker');
  const app = await NestFactory.createApplicationContext(PortalAutomationLocalWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  logger.log(`Yerel portal worker basladi: device=${process.env.PORTAL_AUTOMATION_RAILWAY_DEVICE_ID}`);
  logger.log('Bu process HTTP server acmaz; sadece portal-automation-job kuyrugunu isler.');

  const shutdown = async (signal: string) => {
    logger.warn(`${signal} alindi, worker kapatiliyor...`);
    await app.close().catch((err) => logger.warn(`worker kapatma hatasi: ${err?.message || err}`));
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[PortalAutomationLocalWorker] baslatilamadi:', err?.message || err);
  process.exit(1);
});
