import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LucaOperatorService } from './luca-operator.service';

@Controller('luca-operator')
@UseGuards(AuthGuard('jwt'))
export class LucaOperatorController {
  constructor(private readonly operator: LucaOperatorService) {}

  /** Max + araçlı sohbet (ücretsiz). history: önceki turlar [{role,content}]. */
  @Post('chat')
  chat(
    @Req() req: any,
    @Body() body: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> },
  ) {
    return this.operator.chat({
      tenantId: req.user?.tenantId,
      userId: req.user?.sub,
      message: body?.message || '',
      history: body?.history,
    });
  }
}
