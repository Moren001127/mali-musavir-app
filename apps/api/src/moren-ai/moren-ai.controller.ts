import {
  Controller, Get, Post, Delete, Patch,
  Body, Param, Query, Req, Res,
  UseGuards, UseInterceptors, UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { MorenAiService } from './moren-ai.service';
import { VoiceService } from './voice.service';
import { ToolExecutorService } from './tool-executor.service';

@Controller('moren-ai')
@UseGuards(AuthGuard('jwt'))
export class MorenAiController {
  constructor(
    private readonly service: MorenAiService,
    private readonly voice: VoiceService,
    private readonly tools: ToolExecutorService,
  ) {}

  // -------- KONUŞMA YÖNETİMİ --------
  @Get('conversations')
  async listConversations(@Req() req: any, @Query('limit') limit?: string) {
    return this.service.listConversations(req.user.tenantId, limit ? parseInt(limit) : 30);
  }

  @Get('conversations/:id')
  async getConversation(@Req() req: any, @Param('id') id: string) {
    return this.service.getConversation(id, req.user.tenantId);
  }

  @Delete('conversations/:id')
  async deleteConversation(@Req() req: any, @Param('id') id: string) {
    return this.service.deleteConversation(id, req.user.tenantId);
  }

  @Patch('conversations/:id')
  async renameConversation(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { title: string },
  ) {
    if (!body?.title?.trim()) throw new BadRequestException('title zorunlu');
    return this.service.renameConversation(id, req.user.tenantId, body.title.trim());
  }

  // -------- CHAT --------
  @Post('chat')
  async chat(@Req() req: any, @Body() body: any) {
    return this.service.chat(req.user.tenantId, req.user.sub, body);
  }

  // -------- v1.36.81 SABAH BRİFİNGİ --------
  // Dashboard üst kartında gösterilir. 4 saat in-memory cache.
  // ?force=true ile cache'i bypass edip yenisini üretir.
  @Get('brifing')
  async brifing(@Req() req: any, @Query('force') force?: string) {
    return this.service.getBrifing(req.user.tenantId, req.user.sub, force === 'true' || force === '1');
  }

  @Get('office-brain')
  async officeBrain(@Req() req: any, @Query('period') period?: string) {
    const briefing = await this.tools.execute('get_operation_briefing', { period }, {
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
    return {
      briefing,
      agentCatalog: [
        {
          id: 'moren-ai',
          ad: 'MOREN AI',
          durum: 'aktif',
          isler: [
            'portal verisinin tamamini okuma',
            'mali tablo uretme ve yorumlama',
            'vergi, SGK ve beyan sureci analizi',
            'WhatsApp evrak/tahsilat otomasyonu',
            'Luca ve Mihsap komutlarini onayli yurutme',
          ],
        },
      ],
      modelPolicy: {
        default: 'tek MOREN AI / kisa mesleki cevap',
        analysis: 'portal verisiyle mali musavir analizi',
        safety: 'kritik islemde iki adim onay',
      },
    };
  }

  @Get('memories')
  async memories(@Req() req: any, @Query('query') query?: string, @Query('taxpayerId') taxpayerId?: string, @Query('scope') scope?: string) {
    return this.tools.execute('search_ai_memory', { query, taxpayerId, scope }, {
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }

  @Post('memories')
  async saveMemory(@Req() req: any, @Body() body: any) {
    return this.tools.execute('save_ai_memory', body || {}, {
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }

  @Post('agent-command/preview')
  async previewAgentCommand(@Req() req: any, @Body() body: any) {
    return this.tools.execute('preview_agent_command', body || {}, {
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }

  @Post('agent-command/confirm')
  async confirmAgentCommand(@Req() req: any, @Body() body: any) {
    return this.tools.execute('create_confirmed_agent_command', body || {}, {
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }

  // -------- SESLİ GİRİŞ (Whisper STT) --------
  @Post('voice/transcribe')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async transcribe(@UploadedFile() file: any, @Body() body: { language?: string }) {
    if (!file) throw new BadRequestException('audio dosyası eksik');
    return this.voice.transcribe(file.buffer, file.mimetype, body?.language || 'tr');
  }

  // -------- SESLİ ÇIKIŞ (OpenAI TTS) --------
  @Post('voice/speak')
  async speak(@Body() body: { text: string; voice?: string; instructions?: string }, @Res() res: any) {
    if (!body?.text?.trim()) throw new BadRequestException('text zorunlu');
    const result = await this.voice.synthesize(body.text.trim(), body.voice, body.instructions);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.audio.length.toString());
    res.setHeader('X-TTS-DurationMs', String(result.durationMs));
    res.send(result.audio);
  }

  // -------- KISA YOL: ses dosyası → chat → ses (tek uç) --------
  @Post('voice/chat')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async voiceChat(
    @Req() req: any,
    @UploadedFile() file: any,
    @Body() body: { conversationId?: string; taxpayerId?: string; speakResponse?: string },
    @Res() res: any,
  ) {
    if (!file) throw new BadRequestException('audio dosyası eksik');

    // 1) STT
    const stt = await this.voice.transcribe(file.buffer, file.mimetype, 'tr');

    // 2) Chat (voiceMode=true → kısa cevap)
    const chatResult = await this.service.chat(req.user.tenantId, req.user.sub, {
      conversationId: body.conversationId,
      message: stt.text,
      taxpayerId: body.taxpayerId,
      voiceMode: true,
    });

    // 3) TTS istenirse
    if (body.speakResponse === 'true' || body.speakResponse === '1') {
      const tts = await this.voice.synthesize(chatResult.assistantMessage);
      res.setHeader('Content-Type', tts.contentType);
      res.setHeader('X-Conversation-Id', chatResult.conversationId);
      res.setHeader('X-Transcript', encodeURIComponent(stt.text));
      res.setHeader('X-Assistant-Message', encodeURIComponent(chatResult.assistantMessage.slice(0, 2000)));
      res.send(tts.audio);
      return;
    }

    res.json({
      transcript: stt.text,
      ...chatResult,
    });
  }
}
