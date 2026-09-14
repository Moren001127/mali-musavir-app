import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EkipModule } from '../ekip/ekip.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { GorevMotoruService } from './gorev-motoru.service';

/**
 * v1.36.74 Faz 1: Görevler & Hatırlatmalar modülü
 *
 * - Tek seferlik veya tekrarlı görevler
 * - Mükellef bağı opsiyonel
 * - Çok kanalı bildirim altyapısı (faz 3'te aktive edilecek)
 * - Eskalasyon mantığı (faz 4'te aktive edilecek)
 *
 * Faz 1 sadece CRUD + temel listeleme. Recurrence engine + cron jobs faz 2.
 *
 * 2026-09-14 Görevler & Notlar: ajanda (görev + not + ekip "sizden istenen" + vergi takvimi), toplu işlem,
 * takvimden görev, "Ekibe ver" (EkipModule → EkipRunnerService; runner tasks servisini import ETMEZ — döngü yok,
 * koşu sonu notunu Prisma ile yazar).
 * Faz 2: GorevMotoruService — tekrar üretimi (gece 00:15) + hatırlatma (10 dk'da bir, 07–21) → portal bildirimi + push + WhatsApp.
 * Eski 07:00 e-posta cron'u (schedule/task-reminder.cron.ts) kaldırıldı; e-posta artık motorun içinde (notifyEmail).
 */
@Module({
  imports: [PrismaModule, EkipModule, NotificationsModule, EmailModule],
  controllers: [TasksController],
  providers: [TasksService, GorevMotoruService],
  exports: [TasksService],
})
export class TasksModule {}
