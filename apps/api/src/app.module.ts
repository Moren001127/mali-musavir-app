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
import { EarsivModule } from './earsiv/earsiv.module';
import { MorenAiModule } from './moren-ai/moren-ai.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { WhatsAppQrModule } from './whatsapp-qr/whatsapp-qr.module';
import { VendorMemoryModule } from './vendor-memory/vendor-memory.module';
import { PendingDecisionsModule } from './pending-decisions/pending-decisions.module';
import { BeyannameTakipModule } from './beyanname-takip/beyanname-takip.module';
import { BeyanKayitlariModule } from './beyan-kayitlari/beyan-kayitlari.module';
import { KdvBeyannameModule } from './kdv-beyanname/kdv-beyanname.module';
import { GaleriModule } from './galeri/galeri.module';
import { CariKasaModule } from './cari-kasa/cari-kasa.module';
import { IsletmeHesapOzetiModule } from './isletme-hesap-ozeti/isletme-hesap-ozeti.module';
import { BankaTakipModule } from './banka-takip/banka-takip.module';
import { SystemHealthModule } from './system-health/system-health.module';
import { TasksModule } from './tasks/tasks.module';
import { FaturaMuhasebelestirmeModule } from './fatura-muhasebelestirme/fatura-muhasebelestirme.module';
import { EDefterControlModule } from './edefter-control/edefter-control.module';
import { PortalAutomationModule } from './portal-automation/portal-automation.module';
import { AutomationsModule } from './automations/automations.module';
import { OfficeChatModule } from './office-chat/office-chat.module';
import { EmailModule } from './email/email.module';
import { ReminderCron } from './schedule/reminder.cron';
import { HgsCron } from './schedule/hgs.cron';

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
    EarsivModule,
    MorenAiModule,
    WhatsAppModule,
    WhatsAppQrModule,
    VendorMemoryModule,
    PendingDecisionsModule,
    BeyannameTakipModule,
    BeyanKayitlariModule,
    KdvBeyannameModule,
    GaleriModule,
    CariKasaModule,
    IsletmeHesapOzetiModule,
    BankaTakipModule,
    SystemHealthModule,
    TasksModule,
    FaturaMuhasebelestirmeModule,
    EDefterControlModule,
    PortalAutomationModule,
    AutomationsModule,
    OfficeChatModule,
    EmailModule,
  ],
  providers: [ReminderCron, HgsCron],
})
export class AppModule {}
