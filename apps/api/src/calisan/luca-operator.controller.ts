import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LucaOperatorService } from './luca-operator.service';

@Controller('luca-operator')
@UseGuards(AuthGuard('jwt'))
export class LucaOperatorController {
  constructor(private readonly operator: LucaOperatorService) {}

  /**
   * Max + araçlı AKIŞLI sohbet (SSE). history: önceki turlar [{role,content}].
   * Olaylar: {type:'text',delta} | {type:'tool',name} | {type:'done',...} | {type:'error',error}
   */
  @Post('chat')
  async chat(
    @Req() req: any,
    @Body() body: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> },
    @Res() res: any,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (e: any) => {
      try {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        /* client koptu */
      }
    };

    try {
      await this.operator.chatStream(
        {
          tenantId: req.user?.tenantId,
          userId: req.user?.sub,
          message: body?.message || '',
          history: body?.history,
        },
        send,
      );
    } catch (e: any) {
      send({ type: 'error', error: e?.message || 'Beklenmeyen hata.' });
    } finally {
      res.end();
    }
  }
}
