import type { CreateNotificationInput } from './notifications.service';

/**
 * Bildirim politikası — TEK YER.
 *
 * Portal bildirimleri gürültü üretiyordu (günde ~73). Bazı üreticiler kilitli
 * modüllerde (kdv-control, mizan, earsiv) olduğu için kural üreticide değil,
 * NotificationsService.create() başında merkezi olarak uygulanır:
 *   atla=true dönerse bildirim HİÇ yazılmaz (kayıt açılmaz, WhatsApp'a da gitmez).
 *
 * Kural eklerken: sade tut, her kuralın "neden"ini yaz, spec'e senaryo ekle
 * (notification-policy.spec.ts).
 */
export type BildirimPolitikaKarari = { atla: boolean; neden?: string };

/** Metadata'daki değeri sayıya çevirir; yoksa/boşsa/sayı değilse null. */
function sayiVeyaNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function bildirimPolitikasi(input: CreateNotificationInput): BildirimPolitikaKarari {
  const tip = String(input?.type || '');
  const meta: Record<string, any> =
    input?.metadata && typeof input.metadata === 'object' ? input.metadata : {};

  switch (tip) {
    // KDV kontrol sonucu: inceleme/hatalı/kısmi sayıları TOPLAMI 0 ise sonuç temizdir;
    // kullanıcı sonucu KDV Kontrol ekranında zaten görüyor → bildirim gereksiz.
    // Sayılar metadata'da hiç yoksa (örn. KDV2 tevkifat listesi bildirimi) ÜRET.
    case 'KDV_RESULT': {
      const needsReview = sayiVeyaNull(meta.needsReview);
      const unmatched = sayiVeyaNull(meta.unmatched);
      const partial = sayiVeyaNull(meta.partial);
      const sayilar = [needsReview, unmatched, partial];
      if (sayilar.every((s) => s === null)) return { atla: false };
      const toplam = sayilar.reduce<number>((t, s) => t + (s ?? 0), 0);
      if (toplam === 0) {
        return { atla: true, neden: 'KDV_RESULT temiz sonuç (inceleme+hatalı+kısmi=0); ekranda zaten görünüyor' };
      }
      return { atla: false };
    }

    // MOREN AI uyarısı: KDV kontrol modülünden gelen uyarı KDV_RESULT'ın kopyası → atla.
    // İstisna: "Belge içerik denetimi" (source=kdv-content-audit) ayrı bir bulgu, kalır.
    case 'MOREN_AI_ALERT': {
      if (meta.module === 'kdv-control' && meta.source !== 'kdv-content-audit') {
        return { atla: true, neden: 'MOREN_AI_ALERT kdv-control: KDV_RESULT bildiriminin kopyası' };
      }
      return { atla: false };
    }

    // Sistem sağlığı: LUCA_JOB_FAILURE için ayrıca LUCA_SYNC_ERROR bildirimi zaten üretiliyor → kopya.
    case 'SYSTEM': {
      if (meta.healthCheckType === 'LUCA_JOB_FAILURE') {
        return { atla: true, neden: 'SYSTEM/LUCA_JOB_FAILURE: Luca aktarım hatası bildirimi (LUCA_SYNC_ERROR) zaten var' };
      }
      return { atla: false };
    }

    // Mihsap aktarım sonucu: başarı mesajı bilgi kirliliği (üretici metadata.basari işaretler);
    // hata / "oturum bekleniyor" bildirimleri aynen üretilir.
    case 'MIHSAP_RESULT': {
      if (meta.basari === true) {
        return { atla: true, neden: 'MIHSAP_RESULT başarılı aktarım; sonuç ekranda zaten görünüyor' };
      }
      return { atla: false };
    }

    default:
      return { atla: false };
  }
}
