import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * v1.36.74 Faz 1: Görevler & Hatırlatmalar modülü
 *
 * - Tek seferlik veya tekrarlı görevler
 * - Mükellef bağı opsiyonel
 * - Çok kanalı bildirim altyapısı (faz 3'te aktive edilecek)
 * - Eskalasyon mantığı (faz 4'te aktive edilecek)
 *
 * Faz 1 sadece CRUD + temel listeleme. Recurrence engine + cron jobs faz 2.
 */
@Module({
  imports: [PrismaModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
