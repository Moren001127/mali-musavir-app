import { CanActivate, ExecutionContext, Injectable, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ButcePinService } from './butce-pin.service';

/** PIN istemeyen uçlar (erişim kontrolü, PIN kurma/açma) bu işaretle geçilir. */
export const PIN_SERBEST = 'butce_pin_serbest';
export const PinSerbest = () => SetMetadata(PIN_SERBEST, true);

/**
 * Modül verilerine erişim için geçerli PIN bileti (X-Butce-Pin) şartı.
 * Bilet yoksa/süresi dolmuşsa 403 + BUTCE_PIN_GEREKLI döner; arayüz PIN ekranını gösterir.
 *
 * Doğrulama artık asenkron: biletteki PIN sürümü, kayıttaki güncel PIN özetinden
 * yeniden hesaplanıp karşılaştırılıyor. Bunun bedeli istek başına tek bir küçük
 * ayar okuması; kazancı, PIN değişir değişmez eski biletlerin düşmesi.
 */
@Injectable()
export class ButcePinGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private pin: ButcePinService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const serbest = this.reflector.get<boolean>(PIN_SERBEST, context.getHandler());
    if (serbest) return true;
    const req = context.switchToHttp().getRequest();
    const bilet = String(req.headers['x-butce-pin'] || '');
    const kimlik = {
      tenantId: String(req?.user?.tenantId || ''),
      userId: String(req?.user?.sub || ''),
    };
    if (!(await this.pin.biletGecerliMi(kimlik, bilet))) {
      // Bilerek 403: 401 verilseydi istemcinin oturum yenileme akışı tetiklenir,
      // PIN eksikliği oturum sorunuyla karışırdı.
      throw new ForbiddenException('BUTCE_PIN_GEREKLI');
    }
    return true;
  }
}
