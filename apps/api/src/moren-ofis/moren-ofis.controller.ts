import { Controller, Get, Post, Body, Param, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MorenOfisService } from './moren-ofis.service';
import { PERSONAS } from './agents/personas';

@Controller('moren-ofis')
@UseGuards(AuthGuard('jwt'))
export class MorenOfisController {
  constructor(private readonly service: MorenOfisService) {}

  @Get('team')
  team() {
    return Object.values(PERSONAS).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      fullName: p.fullName,
      age: p.age,
      role: p.role,
      expertise: p.expertise,
      accentColor: p.accentColor,
      model: p.model,
      personality: p.personality,
    }));
  }

  @Get('conversations')
  list(@Req() req: any) {
    return this.service.listConversations(req.user.tenantId);
  }

  @Get('conversations/:id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.service.getConversation(req.user.tenantId, id);
  }

  @Post('chat')
  chat(@Req() req: any, @Body() body: { conversationId?: string; text: string }) {
    if (!body?.text?.trim()) throw new BadRequestException('text gerekli');
    return this.service.sendMessage({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      conversationId: body.conversationId,
      text: body.text.trim(),
    });
  }
}
