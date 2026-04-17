import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TaxpayersModule } from './taxpayers/taxpayers.module';
import { DocumentsModule } from './documents/documents.module';
import { KdvControlModule } from './kdv-control/kdv-control.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FisYazdirmaModule } from './fis-yazdirma/fis-yazdirma.module';
import { SmsTemplatesModule } from './sms-templates/sms-templates.module';
import { AgentEventsModule } from './agent-events/agent-events.module';
import { MihsapModule } from './mihsap/mihsap.module';
import { LucaModule } from './luca/luca.module';
import { MizanModule } from './mizan/mizan.module';
import { MorenAiModule } from './moren-ai/moren-ai.module';
import { ReminderCron } from './schedule/reminder.cron';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    TaxpayersModule,
    DocumentsModule,
    KdvControlModule,
    AuditModule,
    NotificationsModule,
    FisYazdirmaModule,
    SmsTemplatesModule,
    AgentEventsModule,
    MihsapModule,
    LucaModule,
    MizanModule,
    MorenAiModule,
  ],
  providers: [ReminderCron],
})
export class AppModule {}
