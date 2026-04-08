import { Module } from '@nestjs/common';
import { SmsTemplatesService } from './sms-templates.service';
import { SmsTemplatesController } from './sms-templates.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SmsTemplatesService],
  controllers: [SmsTemplatesController],
  exports: [SmsTemplatesService],
})
export class SmsTemplatesModule {}
