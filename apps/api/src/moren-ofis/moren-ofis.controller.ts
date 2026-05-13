import { Controller, Get, Post, Delete, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MorenOfisService } from './moren-ofis.service';
import { MorenOfisMemoryService } from './memory.service';
import { PERSONAS } from './agents/personas';

@Controller('moren-ofis')
@UseGuards(AuthGuard('jwt'))
export class MorenOfisController {
  constructor(
    private readonly service: MorenOfisService,
    private readonly memory: MorenOfisMemoryService,
  ) {}

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

  // === HAFIZA YÖNETİMİ ===

  /** Tüm gerçekleri listele — UI'da "ekibin neyi bildiği"ni göstermek için */
  @Get('memory/facts')
  listFacts(@Req() req: any, @Query('subject') subject?: string, @Query('limit') limit?: string) {
    return this.memory.listFacts(req.user.tenantId, {
      subject,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  /** Manuel gerçek ekle/güncelle (ör. "Patron WhatsApp ile iletişimi tercih eder") */
  @Post('memory/facts')
  upsertFact(@Req() req: any, @Body() body: { subject: string; predicate: string; object: string; importance?: number }) {
    if (!body.subject || !body.predicate || !body.object) {
      throw new BadRequestException('subject, predicate, object zorunlu');
    }
    return this.memory.upsertFact({
      tenantId: req.user.tenantId,
      subject: body.subject,
      predicate: body.predicate,
      object: body.object,
      importance: body.importance,
    });
  }

  /** Gerçeği sil — "bunu unut" */
  @Delete('memory/facts/:id')
  deleteFact(@Req() req: any, @Param('id') id: string) {
    return this.memory.deleteFact(req.user.tenantId, id);
  }
}
