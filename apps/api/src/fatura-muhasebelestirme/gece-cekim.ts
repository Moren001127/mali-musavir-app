/**
 * PLAN/16 §H — Gece otomatik çekim anahtarı: SAF kurallar (DB/Nest bağımlılığı YOK; regresyon betiği doğrudan çalıştırır).
 *
 * Kullanıcı kararları (2026-09-12, bağlayıcı):
 *   • Gece çekimi VARSAYILAN KAPALI; mükellef × entegratör bazında TEK TEK açılır ("hepsini aç/kapat" YOK).
 *   • 'global' anahtarıyla talimat AÇILAMAZ (gece çekimi mükellef bazında açılır).
 *   • Saat seçimi: 'HH:MM', 00:00–06:59 aralığı; varsayılan 02:00. Cron her saat başı (00:05…06:05) tikler;
 *     yalnız saati o saate denk gelen satırlar işlenir (dakika yok sayılır).
 *   • Global kill-switch: NIGHTLY_EFATURA = off | 0 | false | kapali → hiçbir şey çekilmez.
 */

export const GECE_VARSAYILAN_SAAT = '02:00';
/** Gece penceresi: saat 00–06 (dahil). */
export const GECE_SAAT_ARALIGI = { min: 0, max: 6 } as const;
/** Cron ifadesi: 00:05, 01:05, … 06:05 (Europe/Istanbul). */
export const GECE_CRON_IFADESI = '0 5 0-6 * * *';

/** 'HH:MM' → normalize ('2:0' → '02:00'); geçersiz/aralık dışı → null. */
export function geceSaatiNormalize(saat: unknown): string | null {
  const s = String(saat ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] === undefined ? 0 : Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < GECE_SAAT_ARALIGI.min || hh > GECE_SAAT_ARALIGI.max) return null;
  if (mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function geceSaatiGecerliMi(saat: unknown): boolean {
  return geceSaatiNormalize(saat) !== null;
}

/** Verilen anın Europe/Istanbul saatini (0-23) döndürür. */
export function istanbulSaati(now: Date): number {
  const parca = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false })
    .formatToParts(now)
    .find((p) => p.type === 'hour');
  const h = Number(parca?.value);
  // Bazı ICU sürümleri gece yarısını "24" verir.
  return Number.isFinite(h) ? h % 24 : now.getUTCHours();
}

/** Verilen anın Europe/Istanbul takvim tarihi (sunucu UTC'de koşar; 00:05 İstanbul = önceki gün 21:05 UTC). */
export function istanbulTarihi(now: Date): { yil: number; ay: number; gun: number; ymd: string } {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // "2026-09-12"
  const [y, m, d] = ymd.split('-').map(Number);
  return { yil: y, ay: m, gun: d, ymd };
}

/** Gece koşusunda taranacak dönemler ("YYYY-MM"): içinde bulunulan ay; ayın ilk 10 günü önceki ay da. */
export function geceDonemleri(now: Date): string[] {
  const t = istanbulTarihi(now);
  const donemler = [`${t.yil}-${String(t.ay).padStart(2, '0')}`];
  if (t.gun <= 10) {
    const oncekiAy = t.ay === 1 ? 12 : t.ay - 1;
    const oncekiYil = t.ay === 1 ? t.yil - 1 : t.yil;
    donemler.unshift(`${oncekiYil}-${String(oncekiAy).padStart(2, '0')}`);
  }
  return donemler;
}

/**
 * Mükellefin seçtiği saat (yoksa 02:00) şu anki Istanbul saatine denk geliyor mu? Dakika yok sayılır.
 * Geçersiz kayıtlı saat → varsayılan (02:00) gibi davranır (kayıt bozuksa çekim sessizce kaybolmasın).
 */
export function geceSaatiUyuyorMu(saat: unknown, now: Date | number): boolean {
  const hedef = geceSaatiNormalize(saat) ?? GECE_VARSAYILAN_SAAT;
  const hedefSaat = Number(hedef.slice(0, 2));
  const simdikiSaat = typeof now === 'number' ? now : istanbulSaati(now);
  return hedefSaat === simdikiSaat;
}

/** NIGHTLY_EFATURA env'i kapalı mı? (off | 0 | false | kapali | hayir) — tanımsız/boş = AÇIK (talimat kuralı yine geçerli). */
export function geceCekimEnvKapaliMi(deger: unknown = process.env.NIGHTLY_EFATURA): boolean {
  const v = String(deger ?? '').trim().toLowerCase();
  return ['off', '0', 'false', 'kapali', 'kapalı', 'hayir', 'hayır', 'no'].includes(v);
}

export type GeceTalimatGirdisi = { taxpayerId?: string | null; provider?: string; active?: boolean; saat?: string | null };
export type GeceTalimatSonucu = { provider: string; taxpayerKey: string; active: boolean; saat: string };

/**
 * POST integrations/talimat gövdesini doğrular. Hata → Error (servis BadRequest'e çevirir).
 *   • provider zorunlu (büyük harfe çevrilir)
 *   • 'global' (taxpayerId boş) anahtarıyla AÇMA yasak; KAPATMAYA izin var (temizlik)
 *   • saat: geçersizse hata; verilmezse 02:00
 */
export function geceTalimatGirdisiDogrula(input: GeceTalimatGirdisi): GeceTalimatSonucu {
  const provider = String(input?.provider || '').trim().toUpperCase();
  if (!provider) throw new Error('Sağlayıcı belirtilmedi');
  const taxpayerKey = String(input?.taxpayerId || '').trim() || 'global';
  const active = input?.active === undefined ? true : Boolean(input.active);
  if (active && taxpayerKey === 'global') {
    throw new Error('Gece çekimi mükellef bazında açılır — önce mükellef seçin ("hepsini aç" yok).');
  }
  let saat = GECE_VARSAYILAN_SAAT;
  if (input?.saat !== undefined && input?.saat !== null && String(input.saat).trim() !== '') {
    const n = geceSaatiNormalize(input.saat);
    if (!n) throw new Error('Saat 00:00–06:59 aralığında HH:MM biçiminde olmalı (örn. 02:00).');
    saat = n;
  }
  return { provider, taxpayerKey, active, saat };
}

export type GeceBaglanti = { provider: string; config?: any; isActive?: boolean | null };
export type GecePlanSatiri = { taxpayerId: string; provider: string; saat: string };

/**
 * Bağlantı listesinden bu tik için çekim planı: talimat === true, 'global' değil, saati şu anki saate uyan satırlar.
 * `now` Date ya da doğrudan Istanbul saati (0-23) olabilir.
 */
export function gecePlaniOlustur(baglantilar: GeceBaglanti[], now: Date | number): GecePlanSatiri[] {
  const plan: GecePlanSatiri[] = [];
  for (const conn of Array.isArray(baglantilar) ? baglantilar : []) {
    if (!conn || conn.isActive === false) continue;
    const cfg: any = conn.config || {};
    const taxpayers: Record<string, any> = cfg.taxpayers || {};
    for (const [taxpayerKey, taxpayerCfg] of Object.entries(taxpayers)) {
      if (!taxpayerCfg || taxpayerKey === 'global') continue;
      if ((taxpayerCfg as any).talimat !== true) continue;
      // HIZ SINIRI SOĞUMASI (2026-09-22): 429 yiyen mükellef+sağlayıcı soğuma bitene kadar gece de çekilmez.
      const cooldownUntil = Date.parse(String((taxpayerCfg as any).cooldownUntil || ''));
      const simdiMs = typeof now === 'number' ? Date.now() : now.getTime();
      if (Number.isFinite(cooldownUntil) && cooldownUntil > simdiMs) continue;
      const saat = geceSaatiNormalize((taxpayerCfg as any).saat) ?? GECE_VARSAYILAN_SAAT;
      if (!geceSaatiUyuyorMu(saat, now)) continue;
      plan.push({ taxpayerId: taxpayerKey, provider: String(conn.provider || '').toUpperCase(), saat });
    }
  }
  return plan;
}

export type GeceKosuOzeti = { tarih: string; taxpayerId: string; provider: string; alis: number; satis: number; hata: number; sure: number };

/** AuditLog GECE_CEKIM kayıtlarından (son 24 saat) sabah özeti satırı: "gece çekimi: N belge geldi (X mükellef, Y hata)". */
export function geceOzetSatiri(kayitlar: Array<Partial<GeceKosuOzeti> | null | undefined>): string {
  const liste = (Array.isArray(kayitlar) ? kayitlar : []).filter(Boolean) as Array<Partial<GeceKosuOzeti>>;
  if (!liste.length) return 'gece çekimi: çalışmadı (talimatlı mükellef yok ya da anahtar kapalı)';
  let belge = 0;
  let hata = 0;
  const mukellefler = new Set<string>();
  for (const k of liste) {
    belge += (Number(k.alis) || 0) + (Number(k.satis) || 0);
    hata += Number(k.hata) || 0;
    if (k.taxpayerId) mukellefler.add(String(k.taxpayerId));
  }
  return `gece çekimi: ${belge} belge geldi (${mukellefler.size} mükellef, ${hata} hata)`;
}
