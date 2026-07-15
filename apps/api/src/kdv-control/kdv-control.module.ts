import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { KdvControlService } from './kdv-control.service';
import { KdvControlController } from './kdv-control.controller';
import { KdvAgentController } from './kdv-agent.controller';
import { ExcelParserService } from './excel-parser.service';
import { OcrService } from './ocr';
import { ReconciliationEngine } from './reconciliation';
import { LucaModule } from '../luca/luca.module';
import { AgentEventsModule } from '../agent-events/agent-events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DriveModule } from '../drive/drive.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } }),
    forwardRef(() => LucaModule),
    AgentEventsModule,
    NotificationsModule,
    DriveModule,
  ],
  providers: [KdvControlService, ExcelParserService, OcrService, ReconciliationEngine],
  controllers: [KdvControlController, KdvAgentController],
  exports: [KdvControlService, OcrService, ExcelParserService],
})
export class KdvControlModule {}
