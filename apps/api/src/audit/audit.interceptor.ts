import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Denetim günlüğü — 2026-09-25 (portal denetimi bulgu 37) YENİDEN YAZILDI.
 *
 * Eski hâlde günlük "kim, ne zaman, hangi modül" yazıyor ama **"neyi"** yazmıyordu:
 *   • `resourceId` boş kalıyordu → hangi kayda dokunulduğu bilinmiyordu
 *   • `oldData` / `newData` boş kalıyordu → kurtarma için hiçbir değeri yoktu
 *   • `action` HTTP metodundan türetiliyordu → `POST /x/:id/iptal` "CREATE" görünüyordu
 *   • `userAgent` hiç yazılmıyordu
 *   • yalnız BAŞARIDA çalışıyordu → başarısız/engellenmiş denemeler iz bırakmıyordu
 *   • hata `.catch(() => {})` ile yutuluyordu → günlük yazılamasa bile kimse duymuyordu
 *
 * Yeni hâl bunların hepsini kapatıyor. Şema zaten uygundu (`resourceId`, `oldData`,
 * `newData`, `userAgent` alanları vardı, kimse doldurmuyordu).
 *
 * GİZLİLİK: istek gövdesi olduğu gibi saklanmaz — parola/anahtar/jeton benzeri alanlar
 * maskelenir, gövde boyutu sınırlanır. Amaç "ne değişti"yi anlamak, veriyi kopyalamak değil.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  /** Gövdede asla saklanmayacak alan adları (parça eşleşme, büyük/küçük harf duyarsız). */
  private static readonly GIZLI_ALANLAR = [
    'password', 'sifre', 'şifre', 'pass', 'secret', 'token', 'apikey', 'api_key',
    'authorization', 'credential', 'pin', 'otp', 'captcha', 'base64', 'rawhtml',
  ];
  private static readonly EN_FAZLA_GOVDE = 4000; // karakter

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, user, ip } = req;

    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!isWrite || !user?.sub) return next.handle();

    const { resource, resourceId, action } = this.yolCozumle(method, url);
    const govde = this.govdeyiTemizle(req.body);
    const userAgent = String(req.headers?.['user-agent'] || '').slice(0, 300) || null;

    return next.handle().pipe(
      tap((sonuc) => {
        void this.yaz({
          tenantId: user.tenantId,
          userId: user.sub,
          action,
          resource,
          resourceId: resourceId || this.sonuctanKimlik(sonuc),
          ipAddress: ip,
          userAgent,
          newData: { istek: govde, yol: url, yontem: method, sonuc: 'BASARILI' },
        });
      }),
      catchError((err) => {
        // Bulgu 37: başarısız/engellenmiş denemeler de iz bırakmalı — asıl merak edilen
        // "kim neyi yapmaya çalıştı da olmadı" sorusudur.
        void this.yaz({
          tenantId: user.tenantId,
          userId: user.sub,
          action: `${action}_BASARISIZ`,
          resource,
          resourceId,
          ipAddress: ip,
          userAgent,
          newData: {
            istek: govde,
            yol: url,
            yontem: method,
            sonuc: 'HATA',
            hata: String(err?.message || err).slice(0, 500),
            durumKodu: Number(err?.status) || null,
          },
        });
        return throwError(() => err);
      }),
    );
  }

  private async yaz(data: any) {
    try {
      await this.prisma.auditLog.create({ data });
    } catch (e: any) {
      // Bulgu 37: eskiden sessizce yutuluyordu. Günlük yazılamıyorsa bu BAŞLI BAŞINA
      // bir bulgudur — en azından sunucu kaydına düşsün.
      this.logger.warn(`[DENETIM-GUNLUGU] yazılamadı (${data?.resource}/${data?.action}): ${e?.message || e}`);
    }
  }

  /**
   * "/api/v1/taxpayers/abc123/notes" → { resource: 'taxpayers', resourceId: 'abc123' }
   * Eylem adı yoldaki son sözcükten de zenginleşir: ".../iptal" → 'UPDATE_IPTAL'.
   */
  private yolCozumle(method: string, url: string): { resource: string; resourceId: string | null; action: string } {
    const yol = String(url || '').split('?')[0];
    const parcalar = yol.split('/').filter(Boolean);
    // /api/v1/<resource>/... → ilk iki parça sürüm öneki
    const baslangic = parcalar[0] === 'api' ? 2 : 0;
    const resource = parcalar[baslangic] || 'unknown';
    const kalan = parcalar.slice(baslangic + 1);
    const kimlik = kalan.find((p) => this.kimlikGibiMi(p)) || null;
    // Eylem eki: kimlik OLMAYAN, RAKAMSIZ son parça (ör. "iptal", "onayla", "bulk-delete").
    // Rakamsız şartı önemli: kısa/atipik kimlikler eyleme karışmasın.
    const sonEk = [...kalan].reverse().find((p) => !this.kimlikGibiMi(p) && /^[a-z][a-z-]*$/i.test(p));
    const temel = method === 'DELETE' ? 'DELETE' : method === 'POST' ? 'CREATE' : 'UPDATE';
    // Eylem KODU ASCII kalmalı: Türkçe büyütme "iptal" → "İPTAL" yapıp kod eşleşmelerini bozar.
    const ek = sonEk
      ? sonEk
          .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
          .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
          .toUpperCase()
          .replace(/-/g, '_')
      : null;
    return { resource, resourceId: kimlik, action: ek ? `${temel}_${ek}` : temel };
  }

  /** Yol parçası kayıt kimliği mi? (cuid / uuid / sayısal / rakam içeren uzun dizi) */
  private kimlikGibiMi(p: string): boolean {
    if (/^c[a-z0-9]{16,}$/i.test(p)) return true;                       // cuid
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return true; // uuid
    if (/^\d+$/.test(p)) return true;                                    // sayısal kimlik
    if (p.length >= 12 && /[0-9]/.test(p) && /^[a-z0-9_-]+$/i.test(p)) return true; // genel opak kimlik
    return false;
  }

  /** Yanıttan kayıt kimliği yakala (CREATE'te yol henüz kimlik taşımaz). */
  private sonuctanKimlik(sonuc: any): string | null {
    if (!sonuc || typeof sonuc !== 'object') return null;
    const aday = (sonuc as any).id ?? (sonuc as any).jobId ?? (sonuc as any).mizanId ?? null;
    return typeof aday === 'string' ? aday : null;
  }

  /** Gizli alanları maskeler, boyutu sınırlar. */
  private govdeyiTemizle(body: any): any {
    if (body === undefined || body === null) return null;
    const gizliMi = (anahtar: string) => {
      const a = String(anahtar).toLocaleLowerCase('tr-TR');
      return AuditInterceptor.GIZLI_ALANLAR.some((g) => a.includes(g));
    };
    const gez = (v: any, derinlik: number): any => {
      if (derinlik > 5) return '…';
      if (v === null || v === undefined) return v;
      if (Array.isArray(v)) return v.slice(0, 50).map((x) => gez(x, derinlik + 1));
      if (typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const [k, deger] of Object.entries(v)) {
          o[k] = gizliMi(k) ? '***' : gez(deger, derinlik + 1);
        }
        return o;
      }
      if (typeof v === 'string' && v.length > 500) return `${v.slice(0, 500)}…(${v.length} karakter)`;
      return v;
    };
    try {
      const temiz = gez(body, 0);
      const metin = JSON.stringify(temiz);
      if (metin.length > AuditInterceptor.EN_FAZLA_GOVDE) {
        return { _kirpildi: true, _boyut: metin.length, _onizleme: metin.slice(0, AuditInterceptor.EN_FAZLA_GOVDE) };
      }
      return temiz;
    } catch {
      return { _okunamadi: true };
    }
  }
}
