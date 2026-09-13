/**
 * Push uçları iki tarafa da açık: müşavir/personel ('jwt') ve mükellef portalı ('taxpayer-jwt').
 * Passport'un dizi-strateji desteği burada işe yaramaz: bir strateji validate() içinde fırlatınca
 * zincir durur (fail değil error). O yüzden belirteç gövdesine (doğrulamadan) bakıp doğru strateji
 * seçilir; imza doğrulaması yine ilgili Passport stratejisinde yapılır.
 *  - payload.type === 'taxpayer' → taxpayer-jwt (req.user = { taxpayerId, tenantId, type:'taxpayer' })
 *  - aksi halde → jwt (req.user = { sub, userId, tenantId, roles... })
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { jwtGovdesi } from './expo-push';
import type { PushKimlik } from './push.service';

@Injectable()
export class PushKimlikGuard implements CanActivate {
  private readonly musavir = new (AuthGuard('jwt'))();
  private readonly mukellef = new (AuthGuard('taxpayer-jwt'))();

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const govde = jwtGovdesi(req?.headers?.authorization);
    const guard = govde?.type === 'taxpayer' ? this.mukellef : this.musavir;
    return guard.canActivate(context);
  }
}

/** req.user → PushKimlik (hangi strateji geçtiyse ona göre). */
export function kimlikCikar(user: any): PushKimlik {
  if (!user || !user.tenantId) throw new Error('Kimlik yok');
  if (user.type === 'taxpayer' && user.taxpayerId) return { tenantId: user.tenantId, taxpayerId: user.taxpayerId };
  const userId = user.sub || user.userId;
  if (!userId) throw new Error('Kimlik yok');
  return { tenantId: user.tenantId, userId };
}
