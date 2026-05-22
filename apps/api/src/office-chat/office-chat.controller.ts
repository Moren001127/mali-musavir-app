import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OfficeChatService } from './office-chat.service';

@Controller('office-chat')
@UseGuards(AuthGuard('jwt'))
export class OfficeChatController {
  constructor(private readonly officeChat: OfficeChatService) {}

  @Get('users')
  users(@Req() req: any) {
    return this.officeChat.listUsers(req.user.tenantId, req.user.sub);
  }

  @Get('threads')
  threads(@Req() req: any) {
    return this.officeChat.listThreads(req.user.tenantId, req.user.sub);
  }

  @Post('direct/:targetUserId')
  direct(@Req() req: any, @Param('targetUserId') targetUserId: string) {
    return this.officeChat.openDirectThread(req.user.tenantId, req.user.sub, targetUserId);
  }

  @Get('threads/:id')
  thread(@Req() req: any, @Param('id') id: string) {
    return this.officeChat.getThread(req.user.tenantId, req.user.sub, id);
  }

  @Post('threads/:id/messages')
  message(@Req() req: any, @Param('id') id: string, @Body() body: { content?: string }) {
    return this.officeChat.sendMessage(req.user.tenantId, req.user.sub, id, body?.content || '');
  }

  @Post('threads/:id/read')
  read(@Req() req: any, @Param('id') id: string) {
    return this.officeChat.markRead(req.user.tenantId, req.user.sub, id);
  }
}
