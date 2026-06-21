import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageTemplatesService } from './message-templates.service';
import { MessageTemplatesController } from './message-templates.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, WhatsAppModule, EmailModule],
  providers: [MessageTemplatesService],
  controllers: [MessageTemplatesController],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
