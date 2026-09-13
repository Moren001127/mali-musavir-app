/**
 * PushKimlikGuard — tek uç, iki JWT stratejisi. Gerçek passport + passport-jwt ile (DB yok):
 *  - müşavir belirteci → 'jwt' stratejisi → req.user.sub
 *  - mükellef belirteci (payload.type='taxpayer') → 'taxpayer-jwt' → req.user.taxpayerId
 *  - belirteç yok / imza bozuk → UnauthorizedException
 * Gerçek stratejiler validate() içinde fırlatır (fail değil error) → dizi-strateji zinciri kopardı; guard bu yüzden var.
 */
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
// passport'un tip paketi kurulu değil (@types/passport yok) → require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const passport: any = require('passport');
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { PushKimlikGuard, kimlikCikar } from './push-kimlik.guard';

const GIZLI = 'test-gizli-anahtar-en-az-otuz-iki-karakter-uzun';
const jwt = new JwtService({ secret: GIZLI });

function baglam(authorization?: string) {
  const req: any = { headers: authorization ? { authorization } : {} };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
  return { req, context };
}

beforeAll(() => {
  const ayar = { jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: GIZLI };
  // Gerçek JwtStrategy gibi: mükellef belirtecini users tablosunda bulamaz → FIRLATIR (error, fail değil)
  passport.use('jwt', new JwtStrategy(ayar, (payload: any, done: any) => {
    if (payload.type === 'taxpayer') return done(new UnauthorizedException(), false);
    done(null, { sub: payload.sub, userId: payload.sub, tenantId: payload.tenantId, roles: ['OWNER'] });
  }));
  // Gerçek TaxpayerJwtStrategy gibi: type !== 'taxpayer' → FIRLATIR
  passport.use('taxpayer-jwt', new JwtStrategy(ayar, (payload: any, done: any) => {
    if (payload.type !== 'taxpayer') return done(new UnauthorizedException(), false);
    done(null, { taxpayerId: payload.sub, tenantId: payload.tenantId, type: 'taxpayer' });
  }));
});

afterAll(() => {
  passport.unuse('jwt');
  passport.unuse('taxpayer-jwt');
});

describe('PushKimlikGuard', () => {
  const guard = new PushKimlikGuard();

  it('müşavir belirteci → jwt stratejisi, kimlik userId', async () => {
    const token = jwt.sign({ sub: 'u1', tenantId: 't1', email: 'a@b.c' });
    const { req, context } = baglam(`Bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user.sub).toBe('u1');
    expect(kimlikCikar(req.user)).toEqual({ tenantId: 't1', userId: 'u1' });
  });

  it('mükellef belirteci → taxpayer-jwt stratejisi, kimlik taxpayerId', async () => {
    const token = jwt.sign({ sub: 'tp1', tenantId: 't1', type: 'taxpayer' });
    const { req, context } = baglam(`Bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user.taxpayerId).toBe('tp1');
    expect(kimlikCikar(req.user)).toEqual({ tenantId: 't1', taxpayerId: 'tp1' });
  });

  it('belirteç yok / imza bozuk / süresi dolmuş → 401', async () => {
    await expect(guard.canActivate(baglam().context)).rejects.toBeInstanceOf(UnauthorizedException);
    const baska = new JwtService({ secret: 'baska-gizli-anahtar-en-az-otuz-iki-karakter' });
    await expect(guard.canActivate(baglam(`Bearer ${baska.sign({ sub: 'u1', tenantId: 't1' })}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(baglam(`Bearer ${baska.sign({ sub: 'tp1', tenantId: 't1', type: 'taxpayer' })}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
    const dolmus = jwt.sign({ sub: 'u1', tenantId: 't1' }, { expiresIn: -10 });
    await expect(guard.canActivate(baglam(`Bearer ${dolmus}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
