/**
 * İLETİM GÜNLÜĞÜ — saf mantık (prisma yok, test edilebilir).
 *
 * Hattat "İletim Raporları" mantığı (Muzaffer Bey 2026-09-14): belge bazında, tarih sıralı DÜZ günlük.
 * Her satır = bir belge × bir kanal × bir gönderim. Matris/özet cümlesi yok.
 *
 * Kaynaklar:
 *   1) documentDispatch — Akıllı Bildirim (VERGI/SGK/ETEBLIGAT) + Aylık Ödeme Listesi (ODEME_LISTESI).
 *      Bir gönderim satırı docRefs'teki HER BELGE için ayrı günlük satırına açılır:
 *        VERGI      → docRefs: BeyanKaydi id[]      → "KDV1 2026/07"
 *        SGK        → docRefs: PortalDocument id[]  → "Tahakkuk Fişi 2026/07"
 *        ETEBLIGAT  → docRefs: PortalDocument id[]  → tebligat başlığı (— kurum)
 *        ODEME_LISTESI → docRefs: { key, tur, donem, taksit, tutar }[] → "KDV Beyannamesi Temmuz 2026"
 *      docRefs boşsa (eski biçim) kategori adıyla TEK satır.
 *   2) communicationLog — Cari Kasa ekstre/tahsilat WhatsApp gönderimleri ve portaldan elle atılan
 *      mesajlar. Bu tablo bot sohbetiyle de doludur (gelen mesaj, owner brifingi, bot cevabı…); yalnız
 *      ILETISIM_KURALLARI'ndaki konu (subject) kalıplarıyla GİDEN belge/mesaj kayıtları alınır.
 *
 * Tarih = sentAt ?? createdAt (dispatch) / occurredAt (log). Ay süzgeci bu tarihe bakar.
 */
import * as ExcelJS from 'exceljs';
import { donemEtiketi, turAdi, ayAdi } from './aylik-odeme-donem';

export type GunlukBelgeTuru = 'Tebligat' | 'Beyanname' | 'SGK' | 'Ödeme Listesi' | 'Cari Kasa' | 'Mesaj';
export type GunlukKanal = 'WhatsApp' | 'Mail';
export type GunlukDurum = 'İletildi' | 'İletilemedi' | 'Test' | 'Bekliyor';
export type GunlukDurumSuzgeci = 'iletilen' | 'iletilmeyen' | 'tumu';

export const GUNLUK_BELGE_TURLERI: GunlukBelgeTuru[] = ['Tebligat', 'Beyanname', 'SGK', 'Ödeme Listesi', 'Cari Kasa', 'Mesaj'];

export interface GunlukSatiri {
  id: string;
  /** ISO */
  tarih: string;
  taxpayerId: string;
  unvan: string;
  belgeTuru: GunlukBelgeTuru;
  belgeAdi: string;
  kanal: GunlukKanal;
  durum: GunlukDurum;
  hata: string | null;
  test: boolean;
}

export interface GunlukSorgusu {
  /** YYYY-MM */
  month: string;
  taxpayerId: string;
  belgeTuru: GunlukBelgeTuru | '';
  kanal: 'WHATSAPP' | 'EMAIL' | '';
  durum: GunlukDurumSuzgeci;
  q: string;
  page: number;
  pageSize: number;
  sira: 'asc' | 'desc';
}

export interface GunlukOzeti {
  iletilen: number;
  iletilemeyen: number;
  test: number;
  /** "Başarısızları yeniden dene (N)" — ayın FAILED Vergi/SGK/e-Tebligat (kategori, mükellef) çifti; Ödeme Listesi buradan denenmez */
  yenidenDenenecek: number;
}

export interface GunlukYaniti {
  month: string;
  toplam: number;
  sayfa: number;
  sayfaBoyutu: number;
  satirlar: GunlukSatiri[];
  ozet: GunlukOzeti;
}

// ─── sorgu ──────────────────────────────────────────────────────────────────

export function buAy(simdi: Date = new Date()): string {
  return `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`;
}

/** Ham query → doğrulanmış sorgu (geçersiz değerler varsayılana düşer). */
export function sorguCoz(q: Record<string, unknown> = {}): GunlukSorgusu {
  const s = (v: unknown) => (v == null ? '' : String(v).trim());
  const month = /^\d{4}-\d{2}$/.test(s(q.month)) ? s(q.month) : buAy();
  const belgeTuru = GUNLUK_BELGE_TURLERI.includes(s(q.belgeTuru) as GunlukBelgeTuru) ? (s(q.belgeTuru) as GunlukBelgeTuru) : '';
  const kanalHam = s(q.kanal).toUpperCase();
  const kanal = kanalHam === 'WHATSAPP' || kanalHam === 'EMAIL' ? kanalHam : '';
  const durumHam = s(q.durum);
  const durum: GunlukDurumSuzgeci = durumHam === 'iletilen' || durumHam === 'iletilmeyen' ? durumHam : 'tumu';
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const pageSize = Math.min(500, Math.max(1, Math.floor(Number(q.pageSize)) || 50));
  const sira = s(q.sira).toLowerCase() === 'asc' ? 'asc' : 'desc';
  return { month, taxpayerId: s(q.taxpayerId), belgeTuru, kanal, durum, q: s(q.q), page, pageSize, sira };
}

/** [ayın 1'i, sonraki ayın 1'i) — yerel saat */
export function ayAraligi(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

// ─── ortak yardımcılar ──────────────────────────────────────────────────────

export function kanalAdi(channel: unknown): GunlukKanal {
  return String(channel || '').toUpperCase() === 'EMAIL' ? 'Mail' : 'WhatsApp';
}

/** 'ILETISIM-mükellefin telefon numarası yok' → 'mükellefin telefon numarası yok' */
export function hataMetni(e: unknown): string | null {
  const s = String(e || '').replace(/^ILETISIM-/, '').trim();
  return s || null;
}

export function unvanKur(t?: { companyName?: string | null; firstName?: string | null; lastName?: string | null; id?: string } | null, id?: string): string {
  if (!t) return id || '';
  return (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.id || id || '').toString();
}

function isoYap(d: unknown): string {
  const t = d instanceof Date ? d : new Date(String(d || ''));
  return Number.isNaN(t.getTime()) ? new Date(0).toISOString() : t.toISOString();
}

/** "2026-07" → "2026/07" (Beyanname/SGK belge adında Hattat biçimi) */
function donemEgik(donem: unknown): string {
  return String(donem || '').replace('-', '/');
}

// ─── documentDispatch → günlük satırları ────────────────────────────────────

export interface BeyanBilgisi {
  id: string;
  beyanTipi: string;
  donem: string;
}
export interface BelgeBilgisi {
  id: string;
  title: string | null;
  period: string | null;
  belgeTuru: string | null;
  raw?: any;
}
export interface DispatchBaglami {
  unvan: (taxpayerId: string) => string;
  beyanlar: Map<string, BeyanBilgisi>;
  belgeler: Map<string, BelgeBilgisi>;
}

const KATEGORI_TURU: Record<string, GunlukBelgeTuru> = {
  VERGI: 'Beyanname',
  SGK: 'SGK',
  ETEBLIGAT: 'Tebligat',
  ODEME_LISTESI: 'Ödeme Listesi',
};

/** Gönderim satırının durumu — test gönderimi 'İletildi' SAYILMAZ (mükellef almadı). */
export function dispatchDurumu(r: { status?: string | null; testMode?: boolean | null }): GunlukDurum {
  if (r.status === 'SENT') return r.testMode ? 'Test' : 'İletildi';
  if (r.status === 'PENDING') return 'Bekliyor';
  return 'İletilemedi';
}

/** docRefs öğesi → belge adı; bilinmeyen/boş → null (çağıran kategori adına düşer). */
export function belgeAdi(kategori: string, ref: unknown, ctx: DispatchBaglami): string | null {
  if (kategori === 'ODEME_LISTESI') {
    if (!ref || typeof ref !== 'object') return null;
    const o = ref as { key?: string; tur?: string; donem?: string; taksit?: any };
    const donem = donemEtiketi(o.donem);
    if (String(o.key || '').startsWith('SGK|') || String(o.tur || '').toUpperCase().includes('TAHAKKUK')) {
      return `SGK Prim Tahakkuku${donem ? ` ${donem}` : ''}`;
    }
    const ad = o.tur ? turAdi(String(o.tur), String(o.donem || ''), o.taksit || null) : '';
    return ad ? `${ad}${donem ? ` ${donem}` : ''}` : null;
  }
  const id = typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? String((ref as any).id || '') : '';
  if (!id) return null;
  if (kategori === 'VERGI') {
    const b = ctx.beyanlar.get(id);
    return b ? `${b.beyanTipi} ${donemEgik(b.donem)}`.trim() : null;
  }
  const d = ctx.belgeler.get(id);
  if (!d) return null;
  if (kategori === 'SGK') {
    const baslik = (d.title || (d.belgeTuru === 'SGK_HIZMET_LISTESI' ? 'Hizmet Listesi' : 'Tahakkuk Fişi')).replace(/^SGK\s+/i, '');
    return `${baslik}${d.period ? ` ${donemEgik(d.period)}` : ''}`.trim();
  }
  // ETEBLIGAT: başlık (belge türü açıklaması) — kurum
  const raw = (d.raw || {}) as Record<string, any>;
  const kurum = raw.kurumAciklama || raw.altKurum || '';
  const baslik = d.title || 'e-Tebligat';
  return kurum && !baslik.includes(kurum) ? `${baslik} — ${kurum}` : baslik;
}

/** Bir documentDispatch satırı → docRefs'teki her belge için bir günlük satırı. */
export function dispatchSatirlari(r: any, ctx: DispatchBaglami): GunlukSatiri[] {
  const belgeTuru = KATEGORI_TURU[String(r.kategori)] || 'Mesaj';
  const durum = dispatchDurumu(r);
  const temel = {
    tarih: isoYap(r.sentAt ?? r.createdAt),
    taxpayerId: String(r.taxpayerId || ''),
    unvan: ctx.unvan(String(r.taxpayerId || '')),
    belgeTuru,
    kanal: kanalAdi(r.channel),
    durum,
    hata: durum === 'İletilemedi' ? hataMetni(r.error) || 'gönderilemedi' : null,
    test: !!r.testMode,
  };
  const refs: unknown[] = Array.isArray(r.docRefs) ? r.docRefs : [];
  const adlar = refs.map((ref) => belgeAdi(String(r.kategori), ref, ctx));
  if (!adlar.length) {
    const donem = r.kategori === 'ODEME_LISTESI' && r.donem ? ` ${ayAdi(String(r.donem))}` : r.donem ? ` ${donemEgik(r.donem)}` : '';
    return [{ id: `${r.id}#0`, ...temel, belgeAdi: `${belgeTuru}${donem}` }];
  }
  // Aynı ad birden çok (aynı dönemde iki SGK fişi, iki bilinmeyen id…) → tek satır "(2 belge)"; adı bulunamayan belge kategori adıyla yazılır
  const sayac = new Map<string, number>();
  for (const a of adlar) {
    const ad = a || belgeTuru;
    sayac.set(ad, (sayac.get(ad) || 0) + 1);
  }
  return [...sayac.entries()].map(([ad, n], i) => ({ id: `${r.id}#${i}`, ...temel, belgeAdi: n > 1 ? `${ad} (${n} belge)` : ad }));
}

// ─── communicationLog → günlük satırı ───────────────────────────────────────

interface IletisimKurali {
  /** subject bununla başlar */
  onek?: string;
  /** subject bununla biter */
  sonek?: string;
  belgeTuru: GunlukBelgeTuru;
  ad: (subject: string, content: string | null) => string;
}

function evrakAdi(s: string): string {
  // "[TEST] Evrak hatırlatma — 2026/08 — Gönderildi · Hedef: 05xx · sebep" → "Evrak hatırlatma — 2026/08"
  return s.replace(/^\[TEST\]\s*/i, '').split(' — ').slice(0, 2).join(' — ').trim();
}
function sablonAdi(s: string): string {
  // "WhatsApp şablon — X" / "WhatsApp şablon gönderilemedi — X" / "WhatsApp sablon - X" / "WhatsApp sablon gonderilemedi - X"
  const m = /(?:—|-)\s*(.+)$/.exec(s);
  return m ? `Şablon: ${m[1].trim()}` : 'WhatsApp şablon mesajı';
}
function belgeIstegiAdi(_s: string, content: string | null): string {
  const m = /\[BELGE\]\s*([^\[\n]+)/.exec(String(content || ''));
  const ad = m ? m[1].trim() : '';
  return ad ? `${ad} (WhatsApp isteği)` : 'Belge (WhatsApp isteği)';
}

/**
 * communicationLog'dan günlüğe GİREN konu kalıpları. Kalıp dışı her şey (gelen mesaj, owner
 * brifingi, bot cevabı, onay bekleyen iş…) DIŞARIDA kalır. DB süzgeci de bu tablodan türer.
 */
export const ILETISIM_KURALLARI: IletisimKurali[] = [
  { onek: 'Hesap Dökümü', belgeTuru: 'Cari Kasa', ad: (s) => s.replace(/^Hesap Dökümü\s*\(ekstre PDF\)\s*—\s*/i, '').replace(/\s*\[TEST\]\s*$/i, '').trim() || 'Hesap Dökümü' },
  { onek: 'Tahsilat hatırlatma', belgeTuru: 'Cari Kasa', ad: (s) => s.replace(/\s*-\s*(Gönderildi|Başarısız)\s*$/i, '').trim() },
  { onek: 'Evrak', belgeTuru: 'Mesaj', ad: evrakAdi },
  { onek: '[TEST] Evrak', belgeTuru: 'Mesaj', ad: evrakAdi },
  { sonek: 'bilgilendirmesi', belgeTuru: 'Mesaj', ad: (s) => s.replace(/^WhatsApp\s+/i, '').trim() },
  { onek: 'Portal WhatsApp mesaj', belgeTuru: 'Mesaj', ad: () => 'Portal WhatsApp mesajı' },
  { onek: 'WhatsApp portal medya', belgeTuru: 'Mesaj', ad: () => 'Portal WhatsApp dosyası' },
  { onek: 'WhatsApp portal cevabı', belgeTuru: 'Mesaj', ad: () => 'Portal WhatsApp cevabı' },
  { onek: 'WhatsApp şablon', belgeTuru: 'Mesaj', ad: sablonAdi },
  { onek: 'WhatsApp sablon', belgeTuru: 'Mesaj', ad: sablonAdi },
  { onek: 'WhatsApp sohbet baslatma', belgeTuru: 'Mesaj', ad: () => 'WhatsApp sohbet başlatma' },
  { onek: 'WhatsApp müşavir yanıtı', belgeTuru: 'Mesaj', ad: () => 'Müşavir yanıtı (WhatsApp)' },
  { onek: 'WhatsApp mukellef belge gonderil', belgeTuru: 'Mesaj', ad: belgeIstegiAdi },
];

/** Prisma `where.OR` — yalnız kalıplara uyan konular çekilir (bot sohbeti DB'de elenir). */
export function iletisimKonuSuzgeci(): Array<{ subject: { startsWith?: string; endsWith?: string } }> {
  return ILETISIM_KURALLARI.map((k) => ({ subject: k.onek ? { startsWith: k.onek } : { endsWith: k.sonek } }));
}

function kuralBul(subject: string): IletisimKurali | null {
  const s = subject.trim();
  // En uzun ön ek önce ("[TEST] Evrak" vs "Evrak" çakışmaz ama "WhatsApp portal medya" genel kalıplardan önce gelsin)
  const adaylar = ILETISIM_KURALLARI.filter((k) => (k.onek ? s.startsWith(k.onek) : s.endsWith(k.sonek!)));
  if (!adaylar.length) return null;
  return adaylar.sort((a, b) => (b.onek || b.sonek || '').length - (a.onek || a.sonek || '').length)[0];
}

const ILETILEMEDI = /gonderilemedi|gönderilemedi|başarısız|basarisiz/i;

/** Konudan hata sebebi: "(gonderilemedi - master switch veya hata)" → "master switch veya hata"; Evrak: "Başarısız · Hedef: (yok) · telefon yok" */
export function iletisimHatasi(subject: string): string {
  const p = /\((?:gonderilemedi|gönderilemedi)\s*-?\s*([^)]*)\)/i.exec(subject);
  if (p && p[1].trim()) return p[1].trim();
  const e = /Başarısız\s*·\s*(.+)$/i.exec(subject);
  if (e && e[1].trim()) return e[1].trim();
  return 'gönderilemedi';
}

/** Bir communicationLog satırı → günlük satırı; kalıp dışı konu → null. */
export function iletisimSatiri(r: { id: string; taxpayerId: string; channel: string; subject: string; content?: string | null; occurredAt: Date | string }, unvan: string): GunlukSatiri | null {
  const subject = String(r.subject || '');
  const kural = kuralBul(subject);
  if (!kural) return null;
  const ch = String(r.channel || '').toUpperCase();
  if (ch !== 'WHATSAPP' && ch !== 'EMAIL') return null;
  const test = /\[TEST\]/i.test(subject);
  const hatali = ILETILEMEDI.test(subject);
  const durum: GunlukDurum = hatali ? 'İletilemedi' : test ? 'Test' : 'İletildi';
  return {
    id: `cl:${r.id}`,
    tarih: isoYap(r.occurredAt),
    taxpayerId: String(r.taxpayerId || ''),
    unvan,
    belgeTuru: kural.belgeTuru,
    belgeAdi: kural.ad(subject, r.content ?? null) || subject,
    kanal: kanalAdi(ch),
    durum,
    hata: hatali ? iletisimHatasi(subject) : null,
    test,
  };
}

// ─── süz / sırala / sayfala / özet ──────────────────────────────────────────

function kucuk(s: string): string {
  return String(s || '').toLocaleLowerCase('tr-TR');
}

export function gunlukSuz(satirlar: GunlukSatiri[], s: GunlukSorgusu): GunlukSatiri[] {
  const q = kucuk(s.q).trim();
  const kanal: GunlukKanal | '' = s.kanal === 'WHATSAPP' ? 'WhatsApp' : s.kanal === 'EMAIL' ? 'Mail' : '';
  return satirlar.filter((x) => {
    if (s.taxpayerId && x.taxpayerId !== s.taxpayerId) return false;
    if (s.belgeTuru && x.belgeTuru !== s.belgeTuru) return false;
    if (kanal && x.kanal !== kanal) return false;
    if (s.durum === 'iletilen' && x.durum !== 'İletildi') return false;
    if (s.durum === 'iletilmeyen' && x.durum !== 'İletilemedi' && x.durum !== 'Bekliyor') return false;
    if (q && !kucuk(x.unvan).includes(q) && !kucuk(x.belgeAdi).includes(q)) return false;
    return true;
  });
}

/** Tarihe göre (varsayılan en yeni üstte); eşitlikte mükellef adı, sonra belge adı. */
export function gunlukSirala(satirlar: GunlukSatiri[], sira: 'asc' | 'desc'): GunlukSatiri[] {
  const yon = sira === 'asc' ? 1 : -1;
  return [...satirlar].sort((a, b) => {
    const t = new Date(a.tarih).getTime() - new Date(b.tarih).getTime();
    if (t) return t * yon;
    return a.unvan.localeCompare(b.unvan, 'tr') || a.belgeAdi.localeCompare(b.belgeAdi, 'tr');
  });
}

export function sayfala<T>(satirlar: T[], page: number, pageSize: number): { sayfa: number; satirlar: T[] } {
  const sonSayfa = Math.max(1, Math.ceil(satirlar.length / pageSize));
  const sayfa = Math.min(Math.max(1, page), sonSayfa);
  return { sayfa, satirlar: satirlar.slice((sayfa - 1) * pageSize, sayfa * pageSize) };
}

export function ozetCikar(satirlar: GunlukSatiri[], yenidenDenenecek: number): GunlukOzeti {
  const o: GunlukOzeti = { iletilen: 0, iletilemeyen: 0, test: 0, yenidenDenenecek };
  for (const s of satirlar) {
    if (s.durum === 'İletildi') o.iletilen++;
    else if (s.durum === 'İletilemedi') o.iletilemeyen++;
    else if (s.durum === 'Test') o.test++;
  }
  return o;
}

/** resendFailed ile aynı evren: ayın FAILED satırlarından (kategori, mükellef) çiftleri — Ödeme Listesi hariç. */
export function yenidenDenenecekSayisi(dispatchRows: Array<{ status?: string | null; kategori?: string | null; taxpayerId?: string | null }>): number {
  const ciftler = new Set<string>();
  for (const r of dispatchRows) {
    if (r.status !== 'FAILED') continue;
    if (!['VERGI', 'SGK', 'ETEBLIGAT'].includes(String(r.kategori))) continue;
    ciftler.add(`${r.kategori}:${r.taxpayerId}`);
  }
  return ciftler.size;
}

// ─── Excel ──────────────────────────────────────────────────────────────────

export const EXCEL_BASLIKLARI = ['Tarih', 'Mükellef', 'Belge Türü', 'Belge Adı', 'Gönderim', 'Durum', 'Hata'];

/** ISO → "14.09.2026 08:04:38" (Türkiye saati; sunucu UTC'de çalışsa da) */
export function tarihSaatTR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const al = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${al('day')}.${al('month')}.${al('year')} ${al('hour')}:${al('minute')}:${al('second')}`;
}

export async function gunlukExcel(satirlar: GunlukSatiri[], month: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Moren Portal';
  wb.created = new Date();
  const ws = wb.addWorksheet('İletim Günlüğü', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [
    { key: 'tarih', width: 20 },
    { key: 'mukellef', width: 38 },
    { key: 'belgeTuru', width: 15 },
    { key: 'belgeAdi', width: 44 },
    { key: 'kanal', width: 11 },
    { key: 'durum', width: 12 },
    { key: 'hata', width: 44 },
  ];
  const baslik = ws.addRow([`İletim Günlüğü — ${ayAdi(month)} (${satirlar.length} kayıt)`]);
  baslik.font = { bold: true, size: 13 };
  ws.mergeCells(1, 1, 1, EXCEL_BASLIKLARI.length);
  const th = ws.addRow(EXCEL_BASLIKLARI);
  th.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  th.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D5A80' } };
  th.alignment = { vertical: 'middle' };
  for (const s of satirlar) {
    const row = ws.addRow([tarihSaatTR(s.tarih), s.unvan, s.belgeTuru, s.belgeAdi, s.kanal, s.durum, s.hata || '']);
    if (s.durum === 'İletilemedi') row.getCell(6).font = { color: { argb: 'FFC0392B' }, bold: true };
    else if (s.durum === 'Test' || s.durum === 'Bekliyor') row.getCell(6).font = { color: { argb: 'FF7F8C8D' } };
  }
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: EXCEL_BASLIKLARI.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
