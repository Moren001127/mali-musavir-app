import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { KdvControlService } from './kdv-control.service';
import { KdvControlController } from './kdv-control.controller';
import { ExcelParserService } from './excel-parser.service';
import { OcrService } from './ocr.service';
import { ReconciliationEngine } from './reconciliation.engine';

@Module({
  imports: [MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } })],
  providers: [KdvControlService, ExcelParserService, OcrService, ReconciliationEngine],
  controllers: [KdvControlController],
  exports: [KdvControlService],
})
export class KdvControlModule {}
