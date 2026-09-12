/**
 * PLAN/16 §F — Mükellef faaliyet tanımı: SAF yardımcılar (DB/AI çağrısı YOK; regresyon betiği doğrudan çalıştırır).
 *
 *   faaliyetPatchDogrula(body)      → PATCH taxpayers/:id/faaliyet gövdesini zod ile doğrular, '' → null çevirir,
 *                                      yalnız GÖNDERİLEN alanları döndürür (undefined = dokunma).
 *   faaliyetBelgeOzeti(belgeler)    → son alış/satış faturalarından ≤ 2 KB özet metin (AI girdisi).
 *   faaliyetOnerIstemi(girdi)       → AI istemi (Türkçe; yalnız JSON ister).
 *   faaliyetOnerCevabiCoz(metin)    → AI cevabını güvenli çözer; kurumTuru geçersizse null; güven normalize.
 */
import {
  TaxpayerFaaliyetSchema,
  KURUM_TURU_KODLARI,
  KURUM_TURU_ETIKETLERI,
  DEFTER_TURU_KODLARI,
} from '@mali-musavir/shared';

export type FaaliyetAlanlari = {
  naceKodu?: string | null;
  faaliyetAciklama?: string | null;
  sektorEtiketi?: string | null;
  kurumTuru?: string | null;
  defterTuru?: 'BILANCO' | 'ISLETME' | null;
};

export const FAALIYET_ALANLARI = ['naceKodu', 'faaliyetAciklama', 'sektorEtiketi', 'kurumTuru', 'defterTuru'] as const;

export type FaaliyetDogrulama =
  | { ok: true; data: FaaliyetAlanlari; degisenAlanlar: string[] }
  | { ok: false; hatalar: string[] };

/** PATCH gövdesini doğrula. Boş string → null (alanı temizle). Hiç alan yoksa hata. */
export function faaliyetPatchDogrula(body: unknown): FaaliyetDogrulama {
  const r = TaxpayerFaaliyetSchema.safeParse(body ?? {});
  if (!r.success) {
    return { ok: false, hatalar: r.error.errors.map((e) => `${e.path.join('.') || 'govde'}: ${e.message}`) };
  }
  const data: FaaliyetAlanlari = {};
  const degisenAlanlar: string[] = [];
  for (const alan of FAALIYET_ALANLARI) {
    const v = (r.data as any)[alan];
    if (v === undefined) continue;
    (data as any)[alan] = v === '' || v === null ? null : v;
    degisenAlanlar.push(alan);
  }
  if (!degisenAlanlar.length) {
    return { ok: false, hatalar: [`en az bir alan gönderilmeli: ${FAALIYET_ALANLARI.join(', ')}`] };
  }
  return { ok: true, data, degisenAlanlar };
}

export type FaaliyetBelgeGirdisi = {
  invoiceKind?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  faturaTarihi?: Date | string | null;
  ocrData?: any;
};

/** Belge listesinden AI girdisi: "A · 2026-08-05 · SATICI — kalem1; kalem2". Toplam ≤ ustSinir (varsayılan 2000 karakter). */
export function faaliyetBelgeOzeti(belgeler: FaaliyetBelgeGirdisi[], ustSinir = 2000): string {
  const satirlar: string[] = [];
  for (const b of Array.isArray(belgeler) ? belgeler : []) {
    const yon = String(b?.invoiceKind || '').toUpperCase() === 'SATIS' ? 'S' : 'A';
    const taraf = String((yon === 'S' ? b?.customerName : b?.vendorName) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const kalemler = (Array.isArray(b?.ocrData?.kalemler) ? b.ocrData.kalemler : [])
      .map((k: any) => String(k?.ad || k?.aciklama || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((s: string) => s.slice(0, 40));
    const tarih = b?.faturaTarihi ? new Date(b.faturaTarihi) : null;
    const tarihMetni = tarih && !Number.isNaN(tarih.getTime()) ? tarih.toISOString().slice(0, 10) : '';
    if (!taraf && !kalemler.length) continue;
    satirlar.push(`${yon}${tarihMetni ? ' · ' + tarihMetni : ''}${taraf ? ' · ' + taraf : ''}${kalemler.length ? ' — ' + kalemler.join('; ') : ''}`);
  }
  let metin = '';
  for (const s of satirlar) {
    if (metin.length + s.length + 1 > ustSinir) break;
    metin += (metin ? '\n' : '') + s;
  }
  return metin;
}

export type FaaliyetOnerGirdisi = {
  unvan: string;
  taxpayerType?: string | null;
  naceKodu?: string | null;
  faaliyetAciklama?: string | null;
  sektorEtiketi?: string | null;
  kurumTuru?: string | null;
  defterTuru?: string | null;
  belgeOzeti: string;
  /** tevkifat-kurallari.kurumTuruTahmin(unvan) sonucu — AI'ya ipucu olarak verilir. */
  unvanKurumIpucu?: string | null;
};

/** AI istemi — sadece JSON ister. Kurum türü belirsizse null istenir ('diger' DEĞİL). */
export function faaliyetOnerIstemi(g: FaaliyetOnerGirdisi): string {
  const mevcut = [
    g.naceKodu ? `NACE: ${g.naceKodu}` : '',
    g.faaliyetAciklama ? `faaliyet: ${g.faaliyetAciklama}` : '',
    g.sektorEtiketi ? `sektör: ${g.sektorEtiketi}` : '',
    g.kurumTuru ? `kurum türü: ${g.kurumTuru}` : '',
    g.defterTuru ? `defter: ${g.defterTuru}` : '',
  ].filter(Boolean).join(' · ') || '(boş)';
  const kurumListesi = KURUM_TURU_KODLARI.map((k) => `${k} = ${KURUM_TURU_ETIKETLERI[k]}`).join(', ');
  return [
    'Sen Türkiye muhasebe/vergi uzmanısın. Aşağıdaki mükellefin FAALİYETİNİ tahmin et.',
    'Girdi: ünvan, mevcut tanım, son alış (A) ve satış (S) faturalarının karşı taraf ünvanı ve kalem adları.',
    '',
    `ÜNVAN: ${g.unvan || '(yok)'}${g.taxpayerType ? ` (${g.taxpayerType === 'GERCEK_KISI' ? 'gerçek kişi' : 'tüzel kişi'})` : ''}`,
    `MEVCUT TANIM: ${mevcut}`,
    g.unvanKurumIpucu ? `ÜNVAN İPUCU (kural tabanlı kurum türü tahmini): ${g.unvanKurumIpucu}` : '',
    '',
    'SON FATURALAR:',
    g.belgeOzeti || '(belge yok)',
    '',
    'KURALLAR:',
    '- naceKodu: NACE Rev.2 6 haneli "56.10.06" biçimi; naceAdi: resmi kısa adı.',
    '- faaliyetAciklama: en fazla 120 karakter, sade Türkçe (ör. "yemek üretimi ve satışı").',
    '- sektorEtiketi: TEK kelime/ikili, küçük harf (gıda, inşaat, nakliye, tekstil, yazılım, sağlık, eğitim, otomotiv, perakende, toptan, imalat, turizm, tarım, hizmet…).',
    `- kurumTuru: yalnız şu kodlardan biri: ${kurumListesi}. Ünvan ipuçları: BELEDİYE → belediye; ÜNİVERSİTE → universite; BANKASI/BANK → banka; T.C./MÜDÜRLÜĞÜ/İL ÖZEL İDARESİ/BAKANLIĞI/VALİLİĞİ → kamu; TCDD/PTT/KİT → kit; BİST/OSB/döner sermaye → belirlenmis_diger. Sıradan LTD/A.Ş./şahıs işletmesi → diger. BELİRSİZSE null yaz ("diger" YAZMA) ve gerekcede söyle.`,
    "- guven: 'yuksek' (faturalar ve ünvan aynı yönü gösteriyor) | 'orta' | 'dusuk' (belge yok / çelişkili).",
    '- gerekce: tek cümle, hangi ipuçlarına dayandığını söyle.',
    '- Satış faturaları faaliyeti alış faturalarından daha güçlü gösterir; alışlar yalnız girdi/gider ipucudur.',
    '- Sadece JSON döndür, başka metin yazma:',
    '{"naceKodu":"56.10.06","naceAdi":"Lokantalar…","faaliyetAciklama":"…","sektorEtiketi":"gıda","kurumTuru":"diger","guven":"yuksek","gerekce":"…"}',
  ].filter((s) => s !== '').join('\n');
}

export type FaaliyetOnerisi = {
  naceKodu: string | null;
  naceAdi: string | null;
  faaliyetAciklama: string | null;
  sektorEtiketi: string | null;
  kurumTuru: string | null;
  guven: 'yuksek' | 'orta' | 'dusuk';
  gerekce: string;
};

const NACE_DESENI = /^\d{2}(\.\d{2}){0,2}$/;

/** AI cevabını güvenli çöz. JSON bulunamazsa null. */
export function faaliyetOnerCevabiCoz(metin: string): FaaliyetOnerisi | null {
  const ham = String(metin || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const bas = ham.indexOf('{');
  const son = ham.lastIndexOf('}');
  if (bas < 0 || son <= bas) return null;
  let j: any;
  try {
    j = JSON.parse(ham.slice(bas, son + 1));
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const metinAl = (v: any, max: number) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
  };
  let nace = metinAl(j.naceKodu, 20);
  if (nace) {
    nace = nace.replace(/[^\d.]/g, '');
    if (!NACE_DESENI.test(nace)) nace = null;
  }
  const kurumHam = String(j.kurumTuru ?? '').trim().toLowerCase();
  const kurumTuru = (KURUM_TURU_KODLARI as readonly string[]).includes(kurumHam) ? kurumHam : null;
  const guvenHam = String(j.guven ?? '').trim().toLowerCase();
  const guven: FaaliyetOnerisi['guven'] = guvenHam === 'yuksek' || guvenHam === 'orta' ? guvenHam : 'dusuk';
  const sektor = metinAl(j.sektorEtiketi, 60);
  return {
    naceKodu: nace,
    naceAdi: metinAl(j.naceAdi, 200),
    faaliyetAciklama: metinAl(j.faaliyetAciklama, 300),
    sektorEtiketi: sektor ? sektor.toLocaleLowerCase('tr-TR') : null,
    kurumTuru,
    guven,
    gerekce: metinAl(j.gerekce, 400) || '',
  };
}

/** Defter türü kodu geçerli mi (BILANCO | ISLETME)? */
export function defterTuruGecerliMi(v: unknown): v is 'BILANCO' | 'ISLETME' {
  return typeof v === 'string' && (DEFTER_TURU_KODLARI as readonly string[]).includes(v);
}
