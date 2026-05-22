import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OfficeChatController } from './office-chat.controller';
import { OfficeChatService } from './office-chat.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [OfficeChatController],
  providers: [OfficeChatService],
  exports: [OfficeChatService],
})
export class OfficeChatModule {}
