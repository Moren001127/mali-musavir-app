import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageTemplatesService } from './message-templates.service';
import { MessageTemplatesController } from './message-templates.controller';

@Module({
  imports: [PrismaModule],
  providers: [MessageTemplatesService],
  controllers: [MessageTemplatesController],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
