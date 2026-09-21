import { Injectable, Logger } from '@nestjs/common';

/**
 * EKİP KOTA BEKÇİSİ (PLAN/20 §D, 2026-09-22) — Max aboneliğinin haftalık / 5 saatlik kotası dolunca ekip DURAKLAR.
 *
 * Süreç içi (DB'siz) durum: bir koşu "weekly limit / usage limit / rate limit / hit your … limit" ile bittiğinde
 * `hatadanIsaretle` doldu işaretini koyar ve mesajdaki "resets Sep 21, 9am (Europe/Istanbul)" biçiminden sıfırlanma zamanını
 * çözer (çözülemezse +6 saat). Sıfırlanma geçince `acikMi()` işareti kendiliğinden temizler → kuyruk ve rutinler sürer.
 *
 * Kimler bakar: EkipKuyrukService (öğe başlamadan), EkipRutinService (tik), KoordinatorService (sabah özeti cron'u),
 * /ekip/durum (`kota` alanı → ekranda kırmızı şerit). Runner koşu hatasında `hatadanIsaretle`, Agent SDK'nın
 * yapısal `rate_limit_event`'inde `isaretle` çağırır.
 *
 * Tek API süreci varsayımı (runner ile aynı): başka süreçte dolan kota burada görünmez; o süreç kendi koşusunda öğrenir.
 */

export interface KotaDurumu {
  doldu: boolean;
  sifirlanma: Date | null;
  /** true: sıfırlanma mesajdan/SDK'dan çözüldü; false: +6 saat tahmini */
  kesin: boolean;
  sonHata: string | null;
  isaretlendi: Date | null;
}

/** Kota mesajı kalıbı — runner hata metni, SDK sonuç hatası, kuyruk öğe hatası aynı kalıpla tanınır. */
export const KOTA_KALIBI = /weekly limit|usage limit|rate limit|rate_limit|hit your .*limit|kota/i;

/** Sıfırlanma zamanı mesajdan çözülemezse bu kadar sonra yeniden denenir. */
export const KOTA_VARSAYILAN_BEKLEME_MS = 6 * 60 * 60 * 1000;

const AYLAR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  oca: 1, şub: 2, sub: 2, mart: 3, nis: 4, haz: 6, tem: 7, ağu: 8, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
};

/** Istanbul yerel takvim parçaları (Türkiye 2016'dan beri sabit UTC+3, yaz saati yok → sabit kaydırma yeterli). */
export function istanbulParcalari(t: Date): { yil: number; ay: number; gun: number; saat: number; dakika: number; haftaGunu: number } {
  const y = new Date(t.getTime() + 3 * 60 * 60 * 1000);
  const g = y.getUTCDay(); // 0 = Pazar
  return { yil: y.getUTCFullYear(), ay: y.getUTCMonth() + 1, gun: y.getUTCDate(), saat: y.getUTCHours(), dakika: y.getUTCMinutes(), haftaGunu: g === 0 ? 7 : g };
}

/** Istanbul yerel (yıl, ay, gün, saat, dakika) → UTC Date. */
export function istanbulTarihi(yil: number, ay: number, gun: number, saat: number, dakika: number): Date {
  return new Date(Date.UTC(yil, ay - 1, gun, saat, dakika) - 3 * 60 * 60 * 1000);
}

/**
 * "resets Sep 21, 9am (Europe/Istanbul)" · "resets 9am" · "resets at 3:30pm" · "resets 14:00" · "resets tomorrow 9am"
 * → sıfırlanma zamanı (Istanbul). Ay-gün yoksa bugün; o saat geçtiyse yarın. Çözülemezse null.
 */
export function sifirlanmaZamaniCoz(mesaj: string, simdi: Date = new Date()): Date | null {
  const t = String(mesaj || '');
  // "resets 2026-09-25T06:00:00.000Z" (runner'ın yapısal olaydan yazdığı ISO)
  const iso = t.match(/resets?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)/i);
  if (iso) {
    const d = new Date(iso[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // "resets in 2 hours" / "resets in 45 minutes" → göreli
  const goreli = t.match(/resets?\s+in\s+(?:about\s+)?(\d+)\s*(h|hr|hrs|hour|hours|saat|m|min|mins|minute|minutes|dakika|dk)\b/i);
  if (goreli) {
    const n = Number(goreli[1]);
    const birim = goreli[2].toLowerCase();
    const dakikaMi = /^(m|min|mins|minute|minutes|dakika|dk)$/.test(birim);
    return new Date(simdi.getTime() + n * (dakikaMi ? 60 * 1000 : 60 * 60 * 1000));
  }
  const m = t.match(
    /(?:resets?|sıfırlan(?:ır|ma)|yenilen(?:ir|me))\s*(?:at|on|:)?\s*(tomorrow|yarın)?\s*(?:([A-Za-zÇĞİÖŞÜçğıöşü]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!m) return null;
  const yarin = Boolean(m[1]);
  const ayAdi = m[2] ? m[2].toLowerCase().slice(0, 4) : null;
  const ay = ayAdi ? AYLAR[ayAdi] ?? AYLAR[ayAdi.slice(0, 3)] ?? null : null;
  const gun = m[3] ? Number(m[3]) : null;
  let saat = Number(m[4]);
  const dakika = m[5] ? Number(m[5]) : 0;
  const ampm = m[6] ? m[6].toLowerCase() : null;
  if (!Number.isFinite(saat) || dakika > 59) return null;
  if (ampm === 'pm' && saat < 12) saat += 12;
  if (ampm === 'am' && saat === 12) saat = 0;
  if (saat > 23) return null;
  const bugun = istanbulParcalari(simdi);
  let hedef: Date;
  if (ay && gun) {
    hedef = istanbulTarihi(bugun.yil, ay, gun, saat, dakika);
    // Ay-gün geçen yılın sonundan sarkmışsa (Aralık'ta "resets Jan 2") gelecek yıl
    if (hedef.getTime() < simdi.getTime() - 40 * 24 * 60 * 60 * 1000) hedef = istanbulTarihi(bugun.yil + 1, ay, gun, saat, dakika);
  } else {
    hedef = istanbulTarihi(bugun.yil, bugun.ay, bugun.gun + (yarin ? 1 : 0), saat, dakika);
    if (!yarin && hedef.getTime() <= simdi.getTime()) hedef = istanbulTarihi(bugun.yil, bugun.ay, bugun.gun + 1, saat, dakika);
  }
  return Number.isNaN(hedef.getTime()) ? null : hedef;
}

@Injectable()
export class EkipKotaService {
  private readonly logger = new Logger('EkipKotaService');
  private durumu: KotaDurumu = { doldu: false, sifirlanma: null, kesin: false, sonHata: null, isaretlendi: null };

  /** Hata metni kota kalıbına uyuyorsa doldu işaretle; sıfırlanma mesajdan, yoksa +6 saat. Dönüş: işaretlendi mi. */
  hatadanIsaretle(mesaj: string | null | undefined, simdi: Date = new Date()): boolean {
    const t = String(mesaj || '').trim();
    if (!t || !KOTA_KALIBI.test(t)) return false;
    this.isaretle({ sifirlanma: sifirlanmaZamaniCoz(t, simdi), mesaj: t, simdi });
    return true;
  }

  /**
   * Yapısal işaret (Agent SDK rate_limit_event resetsAt ya da mesajdan çözülen zaman): sıfırlanma null/geçmişse +6 saat tahmini.
   * Kural: kesin (çözülmüş) zaman tahmine üstündür; ikisi de kesinse (ya da ikisi de tahminse) geç olan kalır (haftalık limit 5 saatlikten uzundur).
   */
  isaretle(p: { sifirlanma: Date | null; mesaj: string; simdi?: Date }): void {
    const simdi = p.simdi || new Date();
    const kesin = Boolean(p.sifirlanma && p.sifirlanma.getTime() > simdi.getTime());
    const sifirlanma = kesin ? (p.sifirlanma as Date) : new Date(simdi.getTime() + KOTA_VARSAYILAN_BEKLEME_MS);
    const mesaj = String(p.mesaj || '').slice(0, 300);
    if (this.durumu.doldu && this.durumu.sifirlanma) {
      const eskiKesin = this.durumu.kesin;
      const eskiKalsin = (eskiKesin && !kesin) || (eskiKesin === kesin && this.durumu.sifirlanma.getTime() >= sifirlanma.getTime());
      if (eskiKalsin) {
        this.durumu.sonHata = mesaj;
        return;
      }
    }
    this.durumu = { doldu: true, sifirlanma, kesin, sonHata: mesaj, isaretlendi: simdi };
    this.logger.warn(`[kota] Max kotası doldu; ekip ${sifirlanma.toISOString()} sonrasına kadar duraklar (${kesin ? 'sıfırlanma bilgisi' : '+6 saat tahmini'}) — ${mesaj}`);
  }

  /** Kota açık mı? Dolu ama sıfırlanma geçtiyse kendiliğinden temizler ve true döner. */
  acikMi(simdi: Date = new Date()): boolean {
    if (!this.durumu.doldu) return true;
    if (this.durumu.sifirlanma && this.durumu.sifirlanma.getTime() <= simdi.getTime()) {
      this.logger.log(`[kota] sıfırlanma zamanı geçti (${this.durumu.sifirlanma.toISOString()}); ekip devam ediyor`);
      this.temizle();
      return true;
    }
    return false;
  }

  /** Ekran / durum ucu için anlık durum (sıfırlanma geçtiyse temizlenmiş hâli). */
  durum(simdi: Date = new Date()): KotaDurumu {
    this.acikMi(simdi);
    return { ...this.durumu };
  }

  /** İşareti elle kaldır (test / gerekirse yönetim). */
  temizle(): void {
    this.durumu = { doldu: false, sifirlanma: null, kesin: false, sonHata: null, isaretlendi: null };
  }
}
