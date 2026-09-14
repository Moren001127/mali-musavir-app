/**
 * İLETİM RAPORU — saf mantık + API sözleşmesi (ekran bileşeni yok, test edilebilir).
 *
 * Hattat "İletim Raporları" mantığı (Muzaffer Bey 2026-09-14): belge bazında, tarih sıralı DÜZ günlük
 * (log) tablosu + süzgeç çubuğu + Excel indir. Matris yok, "son durum" cümlesi yok, hap sayaç yok.
 *
 * Sunucu: GET /akilli-bildirim/iletim-gunlugu?month&taxpayerId&belgeTuru&kanal&durum&q&page&pageSize&sira
 *         GET /akilli-bildirim/iletim-gunlugu/excel (aynı süzgeçler, sayfalama yok) → xlsx
 *         POST /akilli-bildirim/resend-failed {month}   (Vergi/SGK/e-Tebligat başarısızlarını yeniden dener)
 */
import { api } from '@/lib/api';
import { ayAdi } from '@/lib/aylik-odeme';

export type BelgeTuru = 'Tebligat' | 'Beyanname' | 'SGK' | 'Ödeme Listesi' | 'Cari Kasa' | 'Mesaj';
export type Kanal = 'WhatsApp' | 'Mail';
export type Durum = 'İletildi' | 'İletilemedi' | 'Test' | 'Bekliyor';
export type Tur = 'tumu' | 'iletilen' | 'iletilmeyen';
export type KanalSuzgeci = '' | 'WHATSAPP' | 'EMAIL';
export type Sira = 'asc' | 'desc';

export const BELGE_TURLERI: BelgeTuru[] = ['Tebligat', 'Beyanname', 'SGK', 'Ödeme Listesi', 'Cari Kasa', 'Mesaj'];
export const TURLER: Array<{ key: Tur; ad: string }> = [
  { key: 'tumu', ad: 'Tümü' },
  { key: 'iletilen', ad: 'İletilen Raporlar' },
  { key: 'iletilmeyen', ad: 'İletilmeyen Raporlar' },
];
export const KANALLAR: Array<{ key: KanalSuzgeci; ad: string }> = [
  { key: '', ad: 'Tümü' },
  { key: 'WHATSAPP', ad: 'WhatsApp' },
  { key: 'EMAIL', ad: 'Mail' },
];
export const SAYFA_BOYUTLARI = [20, 50, 100];

export interface GunlukSatiri {
  id: string;
  /** ISO */
  tarih: string;
  taxpayerId: string;
  unvan: string;
  belgeTuru: BelgeTuru;
  belgeAdi: string;
  kanal: Kanal;
  durum: Durum;
  hata: string | null;
  test: boolean;
}

export interface GunlukOzeti {
  iletilen: number;
  iletilemeyen: number;
  test: number;
  /** "Başarısızları yeniden dene (N)" */
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

/** Süzgeç çubuğu — "Filtrele"ye basınca uygulanır (Hattat mantığı) */
export interface Suzgec {
  month: string;
  taxpayerId: string;
  tur: Tur;
  belgeTuru: BelgeTuru | '';
  kanal: KanalSuzgeci;
}

/** Tablo düzeyi: arama kutusu, kayıt sayısı, sayfa, sıralama — anında uygulanır */
export interface TabloDurumu {
  q: string;
  page: number;
  pageSize: number;
  sira: Sira;
}

export const VARSAYILAN_TABLO: TabloDurumu = { q: '', page: 1, pageSize: 50, sira: 'desc' };

/** Sunucu sorgu parametreleri (boş süzgeç gönderilmez → URL kısa kalır) */
export function sorguParametreleri(s: Suzgec, t: TabloDurumu): Record<string, string | number> {
  const p: Record<string, string | number> = { month: s.month, durum: s.tur, page: t.page, pageSize: t.pageSize, sira: t.sira };
  if (s.taxpayerId) p.taxpayerId = s.taxpayerId;
  if (s.belgeTuru) p.belgeTuru = s.belgeTuru;
  if (s.kanal) p.kanal = s.kanal;
  if (t.q.trim()) p.q = t.q.trim();
  return p;
}

export const iletimGunluguApi = {
  liste: (s: Suzgec, t: TabloDurumu) =>
    api.get<GunlukYaniti>('/akilli-bildirim/iletim-gunlugu', { params: sorguParametreleri(s, t) }).then((r) => r.data),
  excel: (s: Suzgec, t: TabloDurumu) =>
    api.get<Blob>('/akilli-bildirim/iletim-gunlugu/excel', { params: sorguParametreleri(s, { ...t, page: 1 }), responseType: 'blob' }).then((r) => r.data),
  yenidenDene: (month: string) => api.post('/akilli-bildirim/resend-failed', { month }).then((r) => r.data || {}),
};

// ─── metin yardımcıları ──────────────────────────────────────────────────────

/** ISO → "14.09.2026 08:04:38" (Hattat biçimi); geçersizse '' */
export function tarihSaatSaniye(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "Eylül 2026 · 124 gönderim · 118 iletildi · 6 iletilemedi · 3 test" (test yoksa parçası yazılmaz) */
export function ozetCumlesi(month: string, y: GunlukYaniti | undefined): string {
  if (!y) return ayAdi(month);
  const parcalar = [`${y.toplam} gönderim`, `${y.ozet.iletilen} iletildi`, `${y.ozet.iletilemeyen} iletilemedi`];
  if (y.ozet.test > 0) parcalar.push(`${y.ozet.test} test`);
  return `${ayAdi(month)} · ${parcalar.join(' · ')}`;
}

/** "1–50 / 124 kayıt"; boşsa "0 kayıt" */
export function sayfaBilgisi(y: GunlukYaniti | undefined): string {
  if (!y || !y.toplam) return '0 kayıt';
  const bas = (y.sayfa - 1) * y.sayfaBoyutu + 1;
  const son = Math.min(y.toplam, bas + y.satirlar.length - 1);
  return `${bas}–${son} / ${y.toplam} kayıt`;
}

export function sonSayfa(y: GunlukYaniti | undefined): number {
  if (!y || !y.toplam) return 1;
  return Math.max(1, Math.ceil(y.toplam / y.sayfaBoyutu));
}

/** Süzgeç varsayılanda mı (Filtrele/temizle düğmesi için) */
export function suzgecBos(s: Suzgec, month: string): boolean {
  return !s.taxpayerId && s.tur === 'tumu' && !s.belgeTuru && !s.kanal && s.month === month;
}

/** Excel dosya adı: "iletim-gunlugu-2026-09.xlsx" */
export function excelDosyaAdi(month: string): string {
  return `iletim-gunlugu-${month}.xlsx`;
}

/** Durum hücresi için ipucu (üzerine gelince) */
export function durumIpucu(s: GunlukSatiri): string {
  if (s.durum === 'İletilemedi') return `İletilemedi: ${s.hata || 'gönderilemedi'}`;
  if (s.durum === 'Test') return 'Test modu gönderimi — test alıcısına gitti, mükellef almadı';
  if (s.durum === 'Bekliyor') return 'Gönderim kaydı açıldı, sonuç henüz yazılmadı';
  return `${s.kanal} ile iletildi`;
}
