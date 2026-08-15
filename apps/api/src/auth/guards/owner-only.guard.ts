import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';

/**
 * Yalnız ofis sahibinin (tek kişi) erişebildiği modüller için kilit.
 *
 * Kişisel Bütçe modülü ADMIN rolüyle bile açılmamalı — başka bir ADMIN kullanıcı
 * eklendiğinde kişisel gelir/gider/borç verisi görünmesin diye erişim doğrudan
 * e-posta ile sınırlanır.
 *
 * Yetkisiz istekte bilerek 404 döner (403 değil): modülün varlığı bile sızmasın.
 *
 * Yapılandırma: MOREN_BUTCE_OWNER_EMAIL (yoksa MOREN_OWNER_EMAIL).
 * Hiçbiri tanımlı değilse modül KAPALI kabul edilir (güvenli varsayılan).
 */
@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  static ownerEmail(): string {
    return String(
      process.env.MOREN_BUTCE_OWNER_EMAIL || process.env.MOREN_OWNER_EMAIL || '',
    )
      .trim()
      .toLowerCase();
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const owner = OwnerOnlyGuard.ownerEmail();
    const email = String(req?.user?.email || '').trim().toLowerCase();
    if (!owner || !email || email !== owner) {
      throw new NotFoundException('Cannot GET ' + String(req?.url || ''));
    }
    return true;
  }
}
