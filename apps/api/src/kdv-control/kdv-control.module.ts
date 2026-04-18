import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { KdvControlService } from './kdv-control.service';
import { KdvControlController } from './kdv-control.controller';
import { ExcelParserService } from './excel-parser.service';
import { OcrService } from './ocr.service';
import { ReconciliationEngine } from './reconciliation.engine';
import { LucaModule } from '../luca/luca.module';
import { AgentEventsModule } from '../agent-events/agent-events.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } }),
    forwardRef(() => LucaModule),
    AgentEventsModule, // KDV işlemleri "Canlı Sistem Akışı"na (gösterge paneli) düşsün diye
  ],
  providers: [KdvControlService, ExcelParserService, OcrService, ReconciliationEngine],
  controllers: [KdvControlController],
  exports: [KdvControlService, OcrService, ExcelParserService],
})
export class KdvControlModule {}
