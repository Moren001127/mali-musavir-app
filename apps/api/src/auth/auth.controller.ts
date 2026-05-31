import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterSchema } from '@mali-musavir/shared';

const REFRESH_COOKIE = 'moren_refresh_token';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private envFlag(value?: string | null) {
    return ['1', 'true', 'yes', 'on', 'evet'].includes(String(value || '').trim().toLowerCase());
  }

  private registrationEnabled() {
    const raw = process.env.AUTH_REGISTRATION_ENABLED;
    if (raw != null) return this.envFlag(raw);
    return process.env.NODE_ENV !== 'production';
  }

  private refreshCookieOptions() {
    const secure = process.env.AUTH_COOKIE_SECURE
      ? this.envFlag(process.env.AUTH_COOKIE_SECURE)
      : process.env.NODE_ENV === 'production';
    const sameSiteRaw = String(process.env.AUTH_COOKIE_SAMESITE || (secure ? 'none' : 'lax')).toLowerCase();
    let sameSite = (['lax', 'strict', 'none'].includes(sameSiteRaw) ? sameSiteRaw : 'lax') as
      | 'lax'
      | 'strict'
      | 'none';
    if (sameSite === 'none' && !secure) sameSite = 'lax';
    const domain = process.env.AUTH_COOKIE_DOMAIN || undefined;

    return {
      httpOnly: true,
      secure,
      sameSite,
      domain,
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    } as const;
  }

  private setRefreshCookie(res: any, token: string) {
    res.cookie(REFRESH_COOKIE, token, this.refreshCookieOptions());
  }

  private clearRefreshCookie(res: any) {
    res.clearCookie(REFRESH_COOKIE, {
      ...this.refreshCookieOptions(),
      maxAge: undefined,
    });
  }

  @Post('register')
  async register(@Body() body: any) {
    if (!this.registrationEnabled()) {
      throw new ForbiddenException('Registration is disabled');
    }
    const dto = RegisterSchema.parse(body);
    return this.authService.register(dto);
  }

  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    const result = await this.authService.login(req.user, ip);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...publicResult } = result;
    return publicResult;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
    @Body('refreshToken') refreshToken?: string,
  ) {
    const token = refreshToken || req.cookies?.[REFRESH_COOKIE];
    const result = await this.authService.refreshTokens(token);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _refreshToken, ...publicResult } = result;
    return publicResult;
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.authService.logout(req.user.sub);
    this.clearRefreshCookie(res);
    return { message: 'Cikis basarili' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getMe(@Req() req: any) {
    return req.user;
  }
}
