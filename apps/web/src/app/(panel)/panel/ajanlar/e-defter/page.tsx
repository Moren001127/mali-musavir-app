'use client';
import '@/app/(panel)/panel/ajanlar/_components/operations-white.css';
import './edefter-white.css';

import { portalStyle, portalPaint } from '@/lib/portal-theme';


import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Building2, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, EyeOff,
  FileSpreadsheet, FileText, History, LayoutGrid, ListChecks, Loader2, Play, RotateCcw,
  Search, Sparkles, UploadCloud, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { EDefterDonemTipi, edefterControlApi } from '@/lib/edefter-control';
import { lucaLogFriendly } from '@/lib/lucaLogFriendly';
import { useLucaAgent } from '@/hooks/useLucaAgent';
// ── e-Defter modül kimliği: kurumsal lacivert/mavi — sabitler TEK KAYNAK: _components/tema.ts ──
import {
  ARROW, BORDER, BORDER_STRONG, ERR, HERO_BG, ICON_GRAD, INFO, LEAD_GRAD, LIGHTBAR, MUTED, MUTED2, NAVY, NAVY_SOFT, OK,
  GRAY, PANEL, PANEL_HOVER, TEXT, WARN, fmtDate, fmtDateTime, fmtTRY, sevColor, sevLabel,
} from './_components/tema';
import { MIZAN_MODUL_ONEK, type KontrolOzeti, type KuralTanimi, alanSira, mizanAnomaliToBulgu, mizanModulTanimi } from './_components/katalog';
import { BulgularSekmesi } from './_components/BulgularSekmesi';
import { BulguTablosu, alanlaraGrupla, tumKurallariDaralt } from './_components/BulguTablosu';
import { HesaplarSekmesi } from './_components/HesaplarSekmesi';
import { ManuelKurallar } from './_components/ManuelKurallar';
import { Hap, Kart } from '../../ekip/_components/Kart';
import { ikonStili, kahramanKartStili } from '../../ekip/_components/ortak';

const EMPTY_LIST: any[] = [];

type Taxpayer = { id: string; firstName?: string | null; lastName?: string | null; companyName?: string | null; taxNumber?: string | null; defterTuru?: string | null; mihsapDefterTuru?: string | null };
type PeriodMode = 'GECICI' | 'AYLIK' | 'YILLIK';
type SeverityFilter = 'ALL' | 'ERROR' | 'WARN' | 'INFO';
type StatusFilter = 'OPEN' | 'ALL' | 'RESOLVED' | 'IGNORED';
type Tab = 'BULGULAR' | 'HESAPLAR' | 'SATIRLAR' | 'MIZAN' | 'KURALLAR' | 'GECMIS';

const MONTH_LABELS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];


function taxpayerName(t?: Taxpayer | null) {
  if (!t) return '-';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || '-';
}
// Defter türü tespiti: defterTuru + mihsapDefterTuru BİRLİKTE, Türkçe varyantlar dahil.
// Uygulamanın geneliyle aynı mantık (luca.service.normalizeDefterTuru): Mihsap'tan
// senkron mükelleflerde defter türü çoğu zaman mihsapDefterTuru'da, defterTuru boş olur.
// İşletme şüphesi varsa hariç tut; aksi halde bilanço işaretlerini ara.
function isBilancoTaxpayer(t?: Taxpayer | null) {
  const raw = `${t?.defterTuru || ''} ${t?.mihsapDefterTuru || ''}`.toLocaleUpperCase('tr-TR');
  if (/İŞLETME|ISLETME|DEFTER[_\s-]*BEYAN/.test(raw)) return false;
  return /BİLANÇO|BILANÇO|BILANCO/.test(raw);
}

// Profesyonel, aranabilir mükellef seçici (native <select> yerine).
// Panel PORTAL ile body'ye render edilir — yoksa üst kartın overflow:hidden'i kırpıyor
// (kullanıcı listeyi açamıyordu). position:fixed + butonun rect'ine göre konumlanır.
function TaxpayerSelect({ taxpayers, value, onChange }: { taxpayers: Taxpayer[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selected = taxpayers.find((t) => t.id === value) || null;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 6, width: r.width });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = search.trim().toLocaleLowerCase('tr-TR');
  const filtered = q
    ? taxpayers.filter((t) => `${taxpayerName(t)} ${t.taxNumber || ''}`.toLocaleLowerCase('tr-TR').includes(q))
    : taxpayers;

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-11 w-full rounded-xl pl-3 pr-9 text-[13px] inline-flex items-center gap-2 cursor-pointer transition-colors relative"
        style={portalStyle({ background: 'rgba(255,255,255,.04)', border: `1px solid ${open ? BORDER_STRONG : BORDER}`, color: TEXT })}
      >
        <span className="grid place-items-center w-[22px] h-[22px] rounded-md shrink-0" style={portalStyle({ background: NAVY_SOFT, color: NAVY })}><Building2 size={13} /></span>
        <span className="flex-1 text-left truncate font-semibold" style={portalStyle({ color: selected ? TEXT : MUTED })}>
          {selected ? taxpayerName(selected) : (taxpayers.length ? 'Mükellef seçin' : 'Bilanço mükellefi yok')}
        </span>
        {selected?.taxNumber && <span className="text-[11px] tabular-nums shrink-0" style={portalStyle({ color: MUTED2 })}>{selected.taxNumber}</span>}
        <ChevronDown size={15} className="absolute right-3 transition-transform" style={portalStyle({ color: MUTED, transform: open ? 'rotate(180deg)' : 'none' })} />
      </button>
      {open && rect && typeof document !== 'undefined' && createPortal(
        <div data-edefter-control="secici" ref={panelRef} className="rounded-xl overflow-hidden" style={portalStyle({ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, zIndex: 9999, background: '#16161b', border: `1px solid ${BORDER_STRONG}`, boxShadow: '0 18px 44px rgba(0,0,0,.55)' })}>
          <div className="p-2" style={portalStyle({ borderBottom: `1px solid ${BORDER}` })}>
            <div className="h-9 rounded-lg px-2.5 flex items-center gap-2 w-full" style={portalStyle({ background: 'rgba(255,255,255,.05)', border: `1px solid ${BORDER}` })}>
              <Search size={13} style={portalStyle({ color: MUTED2 })} />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mükellef veya VKN ara…" className="bg-transparent outline-none text-[13px] w-full" style={portalStyle({ color: TEXT })} />
            </div>
          </div>
          <div className="overflow-auto py-1" style={portalStyle({ maxHeight: 'min(340px, 60vh)' })}>
            {filtered.length === 0 && (<div className="px-3 py-6 text-center text-[12px]" style={portalStyle({ color: MUTED })}>Eşleşen mükellef yok</div>)}
            {filtered.map((t) => {
              const on = t.id === value;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onChange(t.id); setOpen(false); setSearch(''); }}
                  className="w-full px-3 py-2 text-left flex items-center gap-2.5 transition-colors"
                  style={portalStyle({ background: on ? NAVY_SOFT : 'transparent' })}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = portalPaint(PANEL_HOVER, 'background'); }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = portalPaint('transparent', 'background'); }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={portalStyle({ background: on ? NAVY : 'rgba(255,255,255,.15)' })} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px] font-semibold" style={portalStyle({ color: on ? NAVY : TEXT })}>{taxpayerName(t)}</span>
                    {t.taxNumber && <span className="block text-[11px] tabular-nums" style={portalStyle({ color: MUTED2 })}>VKN {t.taxNumber}</span>}
                  </span>
                  {on && <CheckCircle2 size={15} style={portalStyle({ color: NAVY })} />}
                </button>
              );
            })}
          </div>
          <div className="px-3 py-1.5 text-[10px] text-center" style={portalStyle({ borderTop: `1px solid ${BORDER}`, color: MUTED2 })}>
            {filtered.length} / {taxpayers.length} bilanço mükellefi
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
function apiArray<T>(value: any): T[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}
function quarterLabel(year: number, quarter: number) {
  const r: Record<number, string> = { 1: 'Ocak-Mart', 2: 'Nisan-Haziran', 3: 'Temmuz-Eylül', 4: 'Ekim-Aralık' };
  return `${year} ${quarter}. Dönem (${r[quarter] || 'Çeyrek'})`;
}
function periodDescriptor(mode: PeriodMode, year: number, quarter: number, month: number) {
  if (mode === 'GECICI') return quarterLabel(year, quarter);
  if (mode === 'AYLIK') return `${MONTH_LABELS[month - 1]} ${year}`;
  return `${year} Yıllık`;
}
function periodDonemString(mode: PeriodMode, year: number, quarter: number, month: number) {
  if (mode === 'GECICI') return `${year}-Q${quarter}`;
  if (mode === 'AYLIK') return `${year}-${String(month).padStart(2, '0')}`;
  return `${year}`;
}
function periodDonemTipi(mode: PeriodMode, quarter: number): EDefterDonemTipi {
  if (mode === 'GECICI') return `GECICI_Q${quarter}` as EDefterDonemTipi;
  if (mode === 'AYLIK') return 'AYLIK';
  return 'YILLIK';
}
function formatDonem(donem?: string | null, donemTipi?: string | null) {
  const source = `${donem || ''} ${donemTipi || ''}`;
  const yearMatch = source.match(/\b(20\d{2})\b/);
  const qMatch = source.match(/Q([1-4])/i);
  if (yearMatch && qMatch) return quarterLabel(Number(yearMatch[1]), Number(qMatch[1]));
  const mm = String(donem || '').match(/^(20\d{2})-(\d{1,2})$/);
  if (mm) { const m = Number(mm[2]); if (m >= 1 && m <= 12) return `${MONTH_LABELS[m - 1]} ${mm[1]}`; }
  if (/^20\d{2}$/.test(String(donem || ''))) return `${donem} Yıllık`;
  return donem || '-';
}
function cleanLucaStatus(value?: string | null) {
  const msg = String(value || '').trim();
  if (!msg) return '';
  if (/%PDF|application\/pdf|Detay Fis Listesi baslik satiri|Luca raporu PDF/i.test(msg)) {
    return 'LUCA rapor türünü PDF verdi. Ajan Rapor Türü alanını Excel (xlsx) yapacak; tekrar Luca’dan Çek deneyin.';
  }
  return msg.length > 320 ? `${msg.slice(0, 320)}...` : msg;
}
function normalizePeriodKey(donem?: string | null, donemTipi?: string | null) {
  const source = `${donem || ''} ${donemTipi || ''}`.trim();
  const yearMatch = source.match(/\b(20\d{2})\b/);
  const qMatch = source.match(/Q([1-4])/i);
  if (yearMatch && qMatch) return `${yearMatch[1]}-Q${qMatch[1]}`;
  return String(donem || '').trim().toUpperCase();
}
function sessionMatchesPeriod(session: any, key: string) {
  return normalizePeriodKey(session?.donem, session?.donemTipi) === key.toUpperCase();
}

function categoryLabel(code: string, katalog?: Map<string, KuralTanimi>) {
  const k = katalog?.get(code);
  if (k) return k.ad;
  if (code.startsWith('MANUEL:')) return 'Silinmiş ofis kuralı';
  const dict: Record<string, string> = {
    HESAP_KODU_EKSIK: 'Hesap kodu eksik', FIS_TARIHI_EKSIK: 'Fiş tarihi eksik',
    DONEM_DISI_TARIH: 'Dönem dışı tarih', FIS_DENGESIZ: 'Fiş dengesiz',
    KASA_GUNLUK_30000_TEVSIK_RISKI: 'Kasa 30.000 TL tevsik',
    KASA_HAREKET_30000_TEVSIK_RISKI: 'Kasa hareket 30.000 TL tevsik',
    KASA_TEVSIK_PARCALAMA: 'Tevsik parçalama riski',
    KASA_TEVSIK_BOLUNMUS_ISLEM: 'Tevsik bölünmüş işlem',
    YEVMIYE_NO_MUKERRER: 'Yevmiye no mükerrer', YEVMIYE_NO_ATLAMA: 'Yevmiye no atlama',
    YEVMIYE_TARIH_SIRASI: 'Yevmiye tarih sırası',
    BELGE_TARIHI_FIS_TARIHINDEN_SONRA: 'Belge tarihi > fiş tarihi',
    BELGE_TARIHI_DONEM_DISI: 'Belge tarihi dönem dışı',
    BOS_FIS: 'Boş fiş', TEK_SATIRLI_FIS: 'Tek satırlı fiş',
    FIS_TARIHI_PARSE_HATASI: 'Fiş tarihi parse hatası',
    VKN_FORMAT_HATALI: 'VKN/TCKN format hatalı',
    VKN_ALGORITMA_HATALI: 'VKN/TCKN algoritması tutmuyor',
    GERCEK_MUKERRER_FATURA: 'Mükerrer fatura (VKN+No+Tutar)',
    AYNI_GUN_AYNI_TUTAR_AYNI_TARAF: 'Aynı gün/tutar/taraf mükerrer',
    DEFTER_GENELI_DENGESIZ: 'Defter geneli dengesiz',
    CARI_TERS_BAKIYE_120: '120 ters bakiye (alacaklı)',
    CARI_TERS_BAKIYE_320: '320 ters bakiye (borçlu)',
    HAVADA_KDV_KAYDI: 'Havada KDV kaydı',
    YUKSEK_TUTAR_ACIKLAMA_EKSIK: 'Yüksek tutar açıklama eksik',
    ORTAK_ALACAK_FAIZ_RISKI: '131 ortak alacağı faiz riski',
    KDV_TAHAKKUK_EKSIK: 'KDV tahakkuk eksik',
    KDV_ODENECEK_360_UYUMSUZ: 'Ödenecek KDV 360\'a aktarılmamış',
    KDV_DEVREDEN_190_UYUMSUZ: 'Devreden KDV 190\'a aktarılmamış',
    DONEM_SONU_191_BAKIYE: '191 dönem sonu bakiye var',
    DONEM_SONU_391_BAKIYE: '391 dönem sonu bakiye var',
    BORDRO_TAHAKKUK_EKSIK: 'Bordro tahakkuk eksik (aylık)',
    KIRA_STOPAJI_EKSIK: 'Kira stopajı kesilmemiş',
    KIRA_STOPAJI_ORAN: 'Kira stopaj oranı sapma',
    SMM_STOPAJI_KONTROL: 'Serbest meslek stopaj eksik',
    DAMGA_VERGISI_KONTROL: 'Damga vergisi kontrolü',
    ACILIS_FISI_YOK: 'Açılış fişi yok',
    ACILIS_FISINDE_GELIR_GIDER: 'Açılış fişinde gelir/gider hesabı',
    YILLIK_KAPANIS_690_EKSIK: 'Yıllık kapanış 690 eksik',
    AVANS_KAPANMAMIS_159: '159 Verilen avans açık',
    AVANS_KAPANMAMIS_340: '340 Alınan avans açık',
    CEK_SENET_BAKIYE_121: '121 Alınan çek bakiyesi',
    CEK_SENET_BAKIYE_122: '122 Alınan senet bakiyesi',
    CEK_SENET_BAKIYE_322: '322 Verilen çek bakiyesi',
    CEK_SENET_BAKIYE_323: '323 Verilen senet bakiyesi',
    BANKA_EKSI_BAKIYE_102: '102 Banka eksi bakiye (kredi?)',
    POS_VALOR_108_BAKIYE: '108 POS valör bakiyesi',
    KKEG_689_KONTROL: '689 KKEG kontrolü',
    YILSONU_AMORTISMAN_EKSIK: 'Yıl sonu amortisman eksik',
    VERGI_KARSILIGI_370_YOK: '370 Vergi karşılığı yok',
    BENFORD_SAPMA: 'Benford yasası sapması',
    YUVARLAK_TUTAR_YIGILMASI: 'Yuvarlak tutar yığılması',
    HAFTA_SONU_KAYDI: 'Hafta sonu kaydı',
    SUPHELI_ACIKLAMA: 'Şüpheli açıklama',
    KASA_GUNLUK_NEGATIF_BAKIYE: 'Kasa günlük negatif bakiye',
    STOK_NEGATIF_BAKIYE: 'Stok negatif bakiye',
    BANKA_GUNLUK_EKSI_BAKIYE: 'Banka günlük eksi bakiye',
    MIZAN_FIS_UYUMSUZ: 'Mizan ↔ fiş uyumsuz',
    '191_TERS_CALISMA': '191 İndirilecek KDV ters çalışma',
    '391_TERS_CALISMA': '391 Hesaplanan KDV ters çalışma',
    KDV_TAHAKKUK_MUKERRER: 'KDV tahakkuk mükerrer',
    KDV_TAHAKKUK_191_TUTAR_UYUMSUZ: '191 tahakkuk tutar uyumsuz',
    KDV_TAHAKKUK_391_TUTAR_UYUMSUZ: '391 tahakkuk tutar uyumsuz',
    ANA_HESAPTA_KAYIT: 'Ana hesapta kayıt (alt hesap yok)',
    GELIR_HESABI_BORC_CALISMA: 'Gelir hesabı borç çalışma',
    GIDER_HESABI_ALACAK_CALISMA: 'Gider hesabı alacak çalışma',
    ORTAK_CARI_KASA_KULLANIMI: 'Ortak cari + kasa birlikte',
  };
  return dict[code] || code.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
}

function categoryGroup(code: string, katalog?: Map<string, KuralTanimi>): { id: string; label: string; order: number; icon: string } {
  const k = katalog?.get(code);
  if (k) return { id: k.alan, label: k.alan, order: alanSira(k.alan), icon: '' };
  if (code === 'DEFTER_GENELI_DENGESIZ') return { id: 'temel', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code.startsWith('VKN_')) return { id: 'vkn', label: 'VKN / TCKN Doğrulama', order: 1, icon: '🆔' };
  if (code === 'GERCEK_MUKERRER_FATURA' || code === 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF') return { id: 'mukerrer', label: 'Mükerrer Kayıt Kontrolü', order: 2, icon: '⚠️' };
  if (code === 'HAVADA_KDV_KAYDI' || code.startsWith('KDV_') || code === 'DONEM_SONU_191_BAKIYE' || code === 'DONEM_SONU_391_BAKIYE') return { id: 'kdv', label: 'KDV Kontrolleri', order: 3, icon: '🧾' };
  if (code.startsWith('CARI_TERS_BAKIYE')) return { id: 'cari', label: 'Cari Hesap Tutarlılığı', order: 4, icon: '👥' };
  if (code === 'ORTAK_ALACAK_FAIZ_RISKI') return { id: 'ortak', label: 'Ortak Alacakları / KKEG', order: 5, icon: '⚖️' };
  if (code === 'KASA_GUNLUK_NEGATIF_BAKIYE' || code === 'STOK_NEGATIF_BAKIYE' || code === 'BANKA_GUNLUK_EKSI_BAKIYE') return { id: 'bakiye', label: 'Bakiye Kontrolü', order: 6, icon: '⚖️' };
  if (code === 'MIZAN_FIS_UYUMSUZ') return { id: 'mizan', label: 'Mizan Mutabakatı', order: 1, icon: '🔗' };
  if (code.startsWith('KASA_')) return { id: 'tevsik', label: 'Tevsik / Kasa', order: 6, icon: '💰' };
  if (code.startsWith('YEVMIYE_') || code === 'FIS_DENGESIZ' || code === 'BOS_FIS' || code === 'TEK_SATIRLI_FIS')
    return { id: 'yevmiye', label: 'Yevmiye / Fiş Bütünlüğü', order: 7, icon: '📋' };
  if (code.includes('BELGE')) return { id: 'belge', label: 'Belge / Evrak', order: 8, icon: '📄' };
  if (code === 'HESAP_KODU_EKSIK' || code === 'FIS_TARIHI_EKSIK' || code === 'FIS_TARIHI_PARSE_HATASI' || code === 'DONEM_DISI_TARIH')
    return { id: 'tem2', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code === 'YUKSEK_TUTAR_ACIKLAMA_EKSIK') return { id: 'aciklama', label: 'Açıklama / Kalite', order: 10, icon: '📝' };
  if (code === 'BORDRO_TAHAKKUK_EKSIK') return { id: 'bordro', label: 'Bordro / SGK', order: 5, icon: '👷' };
  if (code.startsWith('KIRA_STOPAJI') || code === 'SMM_STOPAJI_KONTROL' || code === 'DAMGA_VERGISI_KONTROL') return { id: 'stopaj', label: 'Stopaj / Vergi Kesintisi', order: 6, icon: '💸' };
  if (code === 'ACILIS_FISI_YOK' || code === 'ACILIS_FISINDE_GELIR_GIDER' || code === 'YILLIK_KAPANIS_690_EKSIK' || code === 'VERGI_KARSILIGI_370_YOK' || code === 'YILSONU_AMORTISMAN_EKSIK') return { id: 'donem-baslangic', label: 'Açılış / Kapanış / Yıl Sonu', order: 7, icon: '📅' };
  if (code.startsWith('AVANS_KAPANMAMIS')) return { id: 'avans', label: 'Avans Hesapları', order: 8, icon: '💳' };
  if (code.startsWith('CEK_SENET_BAKIYE')) return { id: 'cek-senet', label: 'Çek / Senet', order: 9, icon: '📜' };
  if (code === 'BANKA_EKSI_BAKIYE_102' || code === 'POS_VALOR_108_BAKIYE') return { id: 'banka', label: 'Banka / POS', order: 10, icon: '🏦' };
  if (code === 'KKEG_689_KONTROL') return { id: 'kkeg', label: 'KKEG / KVK', order: 11, icon: '⚖️' };
  if (code === 'BENFORD_SAPMA' || code === 'YUVARLAK_TUTAR_YIGILMASI' || code === 'HAFTA_SONU_KAYDI' || code === 'SUPHELI_ACIKLAMA') return { id: 'forensic', label: 'Forensic / Anomali', order: 12, icon: '🔬' };
  return { id: 'diger', label: 'Diğer', order: 99, icon: '•' };
}

// Bulgu kategorisi → mevzuat dayanağı (müşteri raporu güveni; salt görsel, kod ↔ referans haritası)
const MEVZUAT_REF: Record<string, string> = {
  KASA_GUNLUK_30000_TEVSIK_RISKI: 'VUK 459', KASA_HAREKET_30000_TEVSIK_RISKI: 'VUK 459',
  KASA_TEVSIK_PARCALAMA: 'VUK 459', KASA_TEVSIK_BOLUNMUS_ISLEM: 'VUK 459',
  FIS_DENGESIZ: 'VUK 219', DEFTER_GENELI_DENGESIZ: 'VUK 219', DONEM_DISI_TARIH: 'VUK 219',
  HESAP_KODU_EKSIK: 'VUK 219', FIS_TARIHI_PARSE_HATASI: 'VUK 219',
  YEVMIYE_NO_MUKERRER: 'VUK 219', YEVMIYE_NO_ATLAMA: 'VUK 219', YEVMIYE_TARIH_SIRASI: 'VUK 219',
  BOS_FIS: 'VUK 219', TEK_SATIRLI_FIS: 'VUK 219',
  BELGE_TARIHI_FIS_TARIHINDEN_SONRA: 'VUK 219', BELGE_TARIHI_DONEM_DISI: 'VUK 219',
  HAVADA_KDV_KAYDI: 'KDVK 29', KDV_TAHAKKUK_EKSIK: 'KDVK 41', KDV_ODENECEK_360_UYUMSUZ: 'KDVK 41',
  KDV_DEVREDEN_190_UYUMSUZ: 'KDVK 29', DONEM_SONU_191_BAKIYE: 'KDVK 29', DONEM_SONU_391_BAKIYE: 'KDVK 41',
  KIRA_STOPAJI_EKSIK: 'GVK 94', KIRA_STOPAJI_ORAN: 'GVK 94', SMM_STOPAJI_KONTROL: 'GVK 94', DAMGA_VERGISI_KONTROL: 'Damga V.K.',
  VKN_FORMAT_HATALI: 'VUK 230', VKN_ALGORITMA_HATALI: 'VUK 230',
  GERCEK_MUKERRER_FATURA: 'KDVK 29', AYNI_GUN_AYNI_TUTAR_AYNI_TARAF: 'BDS 240',
  CARI_TERS_BAKIYE_120: 'TDHP', CARI_TERS_BAKIYE_320: 'TDHP',
  ORTAK_ALACAK_FAIZ_RISKI: 'KVK 13', KKEG_689_KONTROL: 'KVK 11',
  BANKA_EKSI_BAKIYE_102: 'TDHP', POS_VALOR_108_BAKIYE: 'TDHP', YUKSEK_TUTAR_ACIKLAMA_EKSIK: 'BDS 230',
  BORDRO_TAHAKKUK_EKSIK: '5510 / GVK 94',
  YILSONU_AMORTISMAN_EKSIK: 'VUK 313/333',
  ACILIS_FISI_YOK: 'TDHP', ACILIS_FISINDE_GELIR_GIDER: 'TDHP', YILLIK_KAPANIS_690_EKSIK: 'TDHP', VERGI_KARSILIGI_370_YOK: 'KVK 32',
  BENFORD_SAPMA: 'Benford · VEDAS', YUVARLAK_TUTAR_YIGILMASI: 'Forensic', HAFTA_SONU_KAYDI: 'BDS 240', SUPHELI_ACIKLAMA: 'BDS 240',
  KASA_GUNLUK_NEGATIF_BAKIYE: 'TDHP · VUK', STOK_NEGATIF_BAKIYE: 'TDHP', BANKA_GUNLUK_EKSI_BAKIYE: 'TDHP',
  MIZAN_FIS_UYUMSUZ: 'VUK 219', ANA_HESAPTA_KAYIT: 'TDHP',
  GELIR_HESABI_BORC_CALISMA: 'TDHP', GIDER_HESABI_ALACAK_CALISMA: 'TDHP', ORTAK_CARI_KASA_KULLANIMI: 'KVK 13',
  KDV_TAHAKKUK_MUKERRER: 'KDVK 41', KDV_TAHAKKUK_191_TUTAR_UYUMSUZ: 'KDVK 29', KDV_TAHAKKUK_391_TUTAR_UYUMSUZ: 'KDVK 41',
  '191_TERS_CALISMA': 'KDVK 29', '391_TERS_CALISMA': 'KDVK 41',
};

// Mizan modülü tip etiketleri artık _components/katalog.ts → mizanModulTanimi (Mizan Denetimi tek listede yazılır)
function mizanDurumLabel(status?: string | null) {
  const s = String(status || '').toUpperCase();
  if (s === 'READY' || s === 'DONE' || s === 'OK') return 'Hazır';
  if (s === 'PENDING' || s === 'QUEUED') return 'Bekliyor';
  if (s === 'RUNNING' || s === 'PROCESSING') return 'İşleniyor';
  if (s === 'FAILED' || s === 'ERROR') return 'Hata';
  return status || '-';
}
// Mizan: alt kırılımı (muavin) olan ANA hesabı gizle — aynı bulgunun rollup tekrarını eler.
// Örn. 10 ve 100 gizlenir, 100.01.001 gösterilir; 370/590 gibi alt kırılımı olmayanlar kalır.
function mizanIsAncestorCode(parent: string, child: string) {
  if (!parent || parent === child || !child.startsWith(parent)) return false;
  const next = child.charAt(parent.length);
  return next === '.' || !parent.includes('.');
}

export default function EDefterAgentPage() {
  const qc = useQueryClient();
  const { preferredDeviceId } = useLucaAgent();
  const now = new Date();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [periodMode, setPeriodMode] = useState<PeriodMode>('GECICI');
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [lucaStatus, setLucaStatus] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('BULGULAR');
  const [lineSearch, setLineSearch] = useState('');
  const [mizanKapaliKurallar, setMizanKapaliKurallar] = useState<Record<string, boolean>>({}); // Mizan Denetimi: kural blokları daraltıldı mı
  const [findingSearch, setFindingSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [focusedFinding, setFocusedFinding] = useState<any | null>(null);
  const focusedLineRef = useRef<HTMLTableRowElement | null>(null);

  const donem = periodDonemString(periodMode, year, quarter, month);
  const donemTipi = periodDonemTipi(periodMode, quarter);
  const periodKey = normalizePeriodKey(donem, donemTipi);

  const { data: allTaxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => apiArray<Taxpayer>(r.data)),
  });
  // Sadece bilanço usulüne tabi mükellefler (e-Defter mükellefi olabilir).
  // Hem defterTuru hem mihsapDefterTuru'ya bakılır — Mihsap senkronunda tür mihsapDefterTuru'da olabilir.
  const taxpayers = useMemo(
    () => allTaxpayers
      .filter(isBilancoTaxpayer)
      .sort((a, b) => taxpayerName(a).localeCompare(taxpayerName(b), 'tr', { sensitivity: 'base' })),
    [allTaxpayers],
  );
  useEffect(() => { if (!taxpayerId && taxpayers[0]?.id) setTaxpayerId(taxpayers[0].id); }, [taxpayers, taxpayerId]);
  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ['edefter-control-list', taxpayerId],
    queryFn: () => edefterControlApi.list(taxpayerId || undefined).then((data) => apiArray<any>(data)),
    refetchInterval: 5000,
  });
  const periodSessions = useMemo(() => sessions.filter((s: any) => sessionMatchesPeriod(s, periodKey)), [sessions, periodKey]);

  useEffect(() => {
    const latest = periodSessions[0]?.id || null;
    if (!latest) { if (selectedSessionId) setSelectedSessionId(null); return; }
    if (!selectedSessionId || !periodSessions.some((s: any) => s.id === selectedSessionId)) setSelectedSessionId(latest);
  }, [periodSessions, selectedSessionId]);

  const activeSessionId = selectedSessionId && periodSessions.some((s: any) => s.id === selectedSessionId)
    ? selectedSessionId : periodSessions[0]?.id || null;

  const { data: session } = useQuery<any>({
    queryKey: ['edefter-control-session', activeSessionId],
    queryFn: () => edefterControlApi.get(activeSessionId!),
    enabled: !!activeSessionId,
  });

  // Tek kural katalogu (sunucu): ad, açıklama, öneri, alan, mevzuat — bulgu gruplama ve etiketler buradan
  const { data: ruleSettingsData } = useQuery({
    queryKey: ['edefter-rule-settings'],
    queryFn: () => edefterControlApi.getRuleSettings(),
    staleTime: 5 * 60 * 1000,
  });
  const katalog = useMemo(() => {
    const m = new Map<string, KuralTanimi>();
    for (const k of (ruleSettingsData?.catalog || []) as KuralTanimi[]) m.set(k.kod, k);
    return m;
  }, [ruleSettingsData]);
  const kontrolOzeti = (session?.kontrolOzeti || null) as KontrolOzeti | null;

  const fetchMut = useMutation({
    mutationFn: () => edefterControlApi.fetchFromLucaAgent({ mukellefId: taxpayerId, donem, donemTipi, targetDeviceId: preferredDeviceId ?? undefined }),
    onSuccess: (data) => {
      setLucaJobId(data.jobId); setSelectedSessionId(null);
      // Mizan işi artık çekimle BİRLİKTE açılıyor. Açılamadıysa bunu sakla —
      // eskiden sessizce yutuluyor, ekran yine "mizan da güncellendi" diyordu.
      if (data.mizanJobId) {
        setLucaStatus('Luca ajanı Detay Fiş Listesi ve Mizan raporlarını hazırlıyor...');
        toast.info('Detay Fiş Listesi + Mizan işleri oluşturuldu');
      } else {
        const neden = (data as any)?.mizanHata ? `: ${(data as any).mizanHata}` : '';
        setLucaStatus(`Detay Fiş Listesi hazırlanıyor — ancak eşlik eden Mizan işi AÇILAMADI${neden}`);
        toast.warning(`Mizan işi oluşturulamadı${neden}`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Luca işi oluşturulamadı'),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => edefterControlApi.uploadExcel({ taxpayerId, donem, donemTipi }, file),
    onSuccess: (data: any) => {
      toast.success(`Detay Fiş Listesi yüklendi: ${data.rows} satır`);
      setSelectedSessionId(data.sessionId);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['edefter-control-session', data.sessionId] });
      qc.refetchQueries({ queryKey: ['edefter-control-list', taxpayerId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Excel yüklenemedi'),
  });

  const statusMut = useMutation({
    mutationFn: ({ findingId, status, note }: { findingId: string; status: 'OPEN' | 'RESOLVED' | 'IGNORED'; note?: string | null }) =>
      edefterControlApi.updateFindingStatus(activeSessionId!, findingId, { status, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edefter-control-session', activeSessionId] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Bulgu güncellenemedi'),
  });

  const exportMut = useMutation({
    mutationFn: () => edefterControlApi.downloadExcel(activeSessionId!),
    onSuccess: () => toast.success('Excel raporu indirildi'),
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Excel indirilemedi'),
  });

  const reanalyzeMut = useMutation({
    mutationFn: () => edefterControlApi.reanalyze(activeSessionId!),
    onSuccess: (data: any) => {
      qc.setQueryData(['edefter-control-session', activeSessionId], data);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      toast.success('Mevcut Excel snapshot yeniden analiz edildi');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Yeniden analiz edilemedi'),
  });

  const jobQuery = useQuery({
    queryKey: ['edefter-luca-job', lucaJobId],
    queryFn: () => edefterControlApi.getLucaJob(lucaJobId!),
    enabled: !!lucaJobId, refetchInterval: 3000,
  });
  useEffect(() => {
    const data = jobQuery.data; if (!data?.job) return;
    const job = data.job;
    const rawLines = String(job.errorMsg || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const lines = lucaLogFriendly(rawLines); // ham teknik logları sade Türkçe aşamalara çevir
    const lastLine = cleanLucaStatus(lines[lines.length - 1]);
    const mizanJob = data.mizanJob;
    const mizanStatus = String(mizanJob?.status || '').toLowerCase();
    // "Mizan işi hiç yok" ile "mizan işi bitti" AYRI şeylerdir. Eskiden ikisi de
    // mizanDone sayılıp ekran "Mizan kontrolü de güncellendi" diyordu; mizan hiç
    // gelmemişken sistem başarı raporluyordu — kullanıcının "çekmiyor ama çektim
    // diyor" şikâyetinin kaynağı buydu.
    const mizanYok = !mizanJob;
    const mizanBitti = ['done', 'failed', 'cancelled'].includes(mizanStatus);
    const mizanDone = mizanYok || mizanBitti;
    if (job.status === 'running') setLucaStatus(lastLine || 'Luca Detay Fiş Listesi Excel hazırlanıyor...');
    if (job.status === 'done') {
      setLucaStatus(
        mizanYok
          ? 'Detay Fiş Listesi alındı — eşlik eden Mizan işi AÇILMAMIŞ, açılış bakiyeleri hesaba katılamadı'
          : mizanStatus === 'done'
            ? 'Detay Fiş Listesi ve Mizan alındı; denetim mizanla birlikte çalıştırıldı'
            : mizanBitti
              ? `Detay Fiş Listesi alındı; Mizan işi ${mizanStatus === 'failed' ? 'hata verdi' : 'iptal edildi'}`
              : 'Detay Fiş Listesi alındı; eşlik eden Mizan kontrolü sürüyor...',
      );
      if (data.session?.id) setSelectedSessionId(data.session.id);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['edefter-control-session'] });
      qc.refetchQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      if (data.session?.id) qc.refetchQueries({ queryKey: ['edefter-control-session', data.session.id] });
      if (mizanDone) setLucaJobId(null);
      if (!mizanDone) return;
      if (mizanYok) { toast.warning('Detay Fiş Listesi hazır; Mizan işi hiç açılmamış — açılış bakiyesi hesaba katılamadı'); return; }
      if (mizanStatus === 'failed') { toast.warning('Detay Fiş Listesi hazır; Mizan işi hata verdi'); return; }
      if (mizanStatus === 'cancelled') { toast.warning('Detay Fiş Listesi hazır; Mizan işi iptal edilmiş'); return; }
      toast.success('e-Defter ön kontrol verisi hazır (mizan dahil)');
    }
    if (job.status === 'failed') {
      const friendly = lastLine || cleanLucaStatus(job.errorMsg) || 'Luca işi hata verdi';
      setLucaStatus(friendly); setLucaJobId(null); toast.error(friendly);
    }
  }, [jobQuery.data, qc, taxpayerId]);

  const allFindings = useMemo<any[]>(() => (Array.isArray(session?.findings) ? session.findings : EMPTY_LIST), [session?.findings]);
  const stats = useMemo(() => {
    const open = allFindings.filter((f) => (f.status || 'OPEN') === 'OPEN');
    return {
      total: allFindings.length,
      open: open.length,
      resolved: allFindings.filter((f) => f.status === 'RESOLVED').length,
      ignored: allFindings.filter((f) => f.status === 'IGNORED').length,
      error: open.filter((f) => f.severity === 'ERROR').length,
      warn: open.filter((f) => f.severity === 'WARN').length,
      info: open.filter((f) => f.severity === 'INFO').length,
    };
  }, [allFindings]);

  const mizan = session?.companionMizan || jobQuery.data?.mizan || null;
  const mizanAnomalies = useMemo(() => {
    return (mizan?.anomaliler || []) as any[];
  }, [mizan]);
  // Sadece en uç (muavin) hesapları göster; alt kırılımı olan ana hesapları gizle.
  const mizanLeafAnomalies = useMemo(() => {
    const codes = mizanAnomalies.map((a) => String(a.hesapKodu || '').trim()).filter(Boolean);
    return mizanAnomalies.filter((a) => {
      const code = String(a.hesapKodu || '').trim();
      if (!code) return true;
      return !codes.some((c) => mizanIsAncestorCode(code, c));
    });
  }, [mizanAnomalies]);
  // Mizan Denetimi = TEK liste (Muzaffer Bey 2026-09-14 "onları birlikte yaz"):
  //   e-Defter'in mizan bakiyesine dayanan kuralları (katalogda mizanGerekli: 549/570/331/502, hareketsiz cari, kasa bakiyesi...)
  //   + Mizan modülünün kendi bulguları (ters bakiye, TDHP dışı, kapanış...). İkincisi salt görünüm (çözüldü/görmezden yok).
  const mizanKatalog = useMemo(() => {
    const m = new Map(katalog);
    for (const a of mizanLeafAnomalies) {
      const tip = String(a.tip || '').trim();
      if (!m.has(MIZAN_MODUL_ONEK + tip)) m.set(MIZAN_MODUL_ONEK + tip, mizanModulTanimi(tip));
    }
    return m;
  }, [katalog, mizanLeafAnomalies]);
  const mizanBulgulari = useMemo(() => {
    const edefter = allFindings.filter((f: any) => (f.status || 'OPEN') === 'OPEN' && katalog.get(f.category)?.mizanGerekli);
    return [...edefter, ...mizanLeafAnomalies.map(mizanAnomaliToBulgu)];
  }, [allFindings, katalog, mizanLeafAnomalies]);
  const mizanAlanlar = useMemo(() => alanlaraGrupla(mizanBulgulari, mizanKatalog), [mizanBulgulari, mizanKatalog]);

  const visibleFindings = useMemo(() => {
    const query = findingSearch.trim().toLocaleLowerCase('tr-TR');
    return allFindings.filter((f: any) => {
      const fStatus = f.status || 'OPEN';
      if (statusFilter !== 'ALL' && fStatus !== statusFilter) return false;
      if (severityFilter !== 'ALL' && f.severity !== severityFilter) return false;
      if (!query) return true;
      const haystack = [f.severity, f.category, f.message, f.voucherKey, f.rowIndex, f.hesapKodu, categoryLabel(f.category, katalog)].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return haystack.includes(query);
    });
  }, [allFindings, findingSearch, severityFilter, statusFilter, katalog]);

  const groupedFindings = useMemo(() => {
    const groups = new Map<string, { id: string; label: string; order: number; icon: string; items: any[] }>();
    for (const f of visibleFindings) {
      const g = categoryGroup(f.category, katalog);
      if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] });
      groups.get(g.id)!.items.push(f);
    }
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [visibleFindings, katalog]);

  useEffect(() => {
    if (groupedFindings.length === 0) return;
    setExpandedGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of groupedFindings) {
        if (next[g.id] === undefined) {
          next[g.id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groupedFindings]);

  const lines = useMemo<any[]>(() => (Array.isArray(session?.lines) ? session.lines : EMPTY_LIST), [session?.lines]);
  const visibleLines = useMemo(() => {
    const query = lineSearch.trim().toLocaleLowerCase('tr-TR');

    // Focus aktifse, fis butununu kapsa
    let focusedRows: Set<number> | null = null;
    if (focusedFinding && lines.length > 0) {
      focusedRows = new Set<number>();
      const fVoucherKey = focusedFinding?.voucherKey || null;
      const fRowIndex = focusedFinding?.rowIndex ? Number(focusedFinding.rowIndex) : null;
      const focusedLine: any = fRowIndex != null ? lines.find((l: any) => Number(l.rowIndex) === fRowIndex) : null;
      const fFisNo = focusedLine?.fisNo || null;
      const fYevmiyeNo = focusedLine?.yevmiyeNo || null;

      // 1) Ayni voucherKey
      if (fVoucherKey) {
        for (const l of lines) if (l.voucherKey === fVoucherKey) focusedRows.add(Number(l.rowIndex));
      }
      // 2) Ayni yevmiye no (varsa)
      if (fYevmiyeNo) {
        for (const l of lines) if (l.yevmiyeNo === fYevmiyeNo) focusedRows.add(Number(l.rowIndex));
      }
      // 3) Ayni fis no (varsa)
      if (fFisNo) {
        for (const l of lines) if (l.fisNo === fFisNo) focusedRows.add(Number(l.rowIndex));
      }
      // 4) Tek satir kaldiysa +/-5 satir baglam ekle
      if (focusedRows.size <= 1 && fRowIndex != null) {
        for (const l of lines) {
          const ri = Number(l.rowIndex);
          if (Math.abs(ri - fRowIndex) <= 5) focusedRows.add(ri);
        }
      }
    }

    return lines.filter((line: any) => {
      if (focusedRows && !focusedRows.has(Number(line.rowIndex))) return false;
      if (!query) return true;
      const haystack = [line.rowIndex, line.voucherKey, line.fisNo, line.yevmiyeNo, line.evrakNo, line.hesapKodu, line.hesapAdi, line.aciklama, fmtDate(line.fisTarihi)].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return haystack.includes(query);
    });
  }, [focusedFinding, lineSearch, lines]);

  const focusFinding = (finding: any) => {
    setFocusedFinding(finding); setLineSearch(''); setActiveTab('SATIRLAR');
    window.setTimeout(() => { focusedLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 200);
  };

  useEffect(() => {
    setFocusedFinding(null); setLineSearch(''); setFindingSearch('');
    setSeverityFilter('ALL'); setStatusFilter('OPEN'); setActiveTab('BULGULAR');
  }, [activeSessionId]);

  const statusColor = (s: string) => s === 'RESOLVED' ? OK : s === 'IGNORED' ? '#94a3b8' : NAVY;
  const handleStatusChange = (f: any, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => {
    if ((f.status || 'OPEN') === status) return;
    statusMut.mutate({ findingId: f.id, status });
    if (status !== 'OPEN') toast.success(status === 'RESOLVED' ? 'Bulgu çözüldü olarak işaretlendi' : 'Bulgu görmezden gelindi');
    else toast.info('Bulgu yeniden açıldı');
  };

  // ── Denetim skoru (0-100): açık bulgulardan türetilir, yalnızca görsel ──
  const hasData = !!session;
  const scoreColor = stats.error > 0 ? ERR : stats.warn > 0 ? WARN : OK;
  const score = !hasData ? null : (stats.total === 0 ? 100 : Math.max(0, Math.round(100 - (stats.error * 10 + stats.warn * 3 + stats.info * 0.5))));
  const scoreLabel = !hasData ? 'Veri yok' : stats.total === 0 ? 'Temiz' : stats.error > 0 ? 'Kritik' : stats.warn > 0 ? 'Dikkat' : 'İyi';
  const scoreHint = !hasData ? 'Bir dönem seç veya Luca’dan Detay Fiş Listesi çek.'
    : stats.total === 0 ? 'Defter ön kontrolden temiz geçti.'
    : stats.error > 0 ? `${stats.error} hata düzeltilmeden berat oluşturmayın.`
    : stats.warn > 0 ? `${stats.warn} uyarı incelenmeli; hata yok.`
    : 'Yalnızca bilgi düzeyinde not var.';

  const sevTotal = stats.error + stats.warn + stats.info;
  const pct = (n: number) => (sevTotal > 0 ? (n / sevTotal) * 100 : 0);

  const toggleSeverity = (s: SeverityFilter) => { setSeverityFilter(severityFilter === s ? 'ALL' : s); setActiveTab('BULGULAR'); };
  const pickStatus = (s: StatusFilter) => { setStatusFilter(s); setActiveTab('BULGULAR'); };

  // PDF müşteri raporu — bağımlılıksız: yazdırma penceresi açar, kullanıcı "PDF olarak kaydet" der.
  const printReport = () => {
    if (!session) { toast.error('Önce bir dönem verisi yükleyin'); return; }
    const w = window.open('', '_blank');
    if (!w) { toast.error('Açılır pencere engellendi; tarayıcı pop-up iznini açın'); return; }
    const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]));
    const sevTxt = (s: string) => s === 'ERROR' ? 'HATA' : s === 'WARN' ? 'UYARI' : 'BİLGİ';
    const sevC = (s: string) => s === 'ERROR' ? '#c0392b' : s === 'WARN' ? '#b8860b' : '#2e6da4';
    const scoreC = scoreColor === OK ? '#2e7d52' : scoreColor === WARN ? '#b8860b' : '#c0392b';
    const gmap = new Map<string, { label: string; order: number; items: any[] }>();
    for (const f of allFindings) {
      const g = categoryGroup(f.category, katalog);
      if (!gmap.has(g.id)) gmap.set(g.id, { label: g.label, order: g.order, items: [] });
      gmap.get(g.id)!.items.push(f);
    }
    const groups = [...gmap.values()].sort((a, b) => a.order - b.order);
    const body = groups.map((g) => `
      <h2>${esc(g.label)} <span class="cnt">${g.items.length}</span></h2>
      <table><thead><tr><th>Seviye</th><th>Bulgu</th><th>Yer</th><th>Dayanak</th><th>Durum</th></tr></thead><tbody>
      ${g.items.map((f: any) => `<tr>
        <td><span class="sev" style="color:${sevC(f.severity)};border-color:${sevC(f.severity)}">${sevTxt(f.severity)}</span></td>
        <td>${esc(f.message)}</td>
        <td class="nw">${f.rowIndex ? 'Satır ' + esc(f.rowIndex) : ''}${f.hesapKodu ? ' · ' + esc(f.hesapKodu) : ''}</td>
        <td class="nw">${MEVZUAT_REF[f.category] ? esc(MEVZUAT_REF[f.category]) : '-'}</td>
        <td class="nw">${(f.status || 'OPEN') === 'OPEN' ? 'Açık' : f.status === 'RESOLVED' ? 'Çözüldü' : 'Görmezden'}</td>
      </tr>`).join('')}
      </tbody></table>`).join('');
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>e-Defter Ön Kontrol Raporu</title><style>
      *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;margin:32px;font-size:12px;line-height:1.5}
      .top{border-bottom:3px solid #1d4ed8;padding-bottom:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
      .eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#1d4ed8;font-weight:700}
      h1{font-size:19px;margin:4px 0 2px} .meta{color:#555;font-size:11px}
      .score{text-align:center;border:2px solid ${scoreC};border-radius:10px;padding:8px 14px;min-width:92px}
      .score .n{font-size:30px;font-weight:800;line-height:1;color:${scoreC}} .score .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-top:3px}
      .sum{display:flex;gap:22px;margin:8px 0 18px;flex-wrap:wrap} .sum div{font-size:11px;color:#555} .sum b{font-size:17px;display:block;color:#1a1a1a}
      h2{font-size:13px;margin:18px 0 6px;border-left:4px solid #1d4ed8;padding-left:8px} .cnt{font-size:10px;color:#999;font-weight:400}
      table{width:100%;border-collapse:collapse;margin-bottom:6px} th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#777;border-bottom:1px solid #ccc;padding:5px 6px}
      td{border-bottom:1px solid #eee;padding:5px 6px;vertical-align:top} td.nw{white-space:nowrap;color:#555}
      .sev{font-size:9px;font-weight:700;border:1px solid;border-radius:4px;padding:1px 5px;white-space:nowrap}
      footer{margin-top:24px;border-top:1px solid #ddd;padding-top:10px;font-size:10px;color:#999;display:flex;justify-content:space-between;gap:16px}
      @media print{body{margin:14mm}}
      </style></head><body>
      <div class="top"><div>
        <div class="eyebrow">e-Defter Ön Kontrol Raporu</div>
        <h1>${esc(taxpayerName(selectedTp))}</h1>
        <div class="meta">${esc(periodDescriptor(periodMode, year, quarter, month))} · ${session.totalVouchers ?? 0} fiş · ${session.totalLines ?? 0} satır · Rapor: ${esc(new Date().toLocaleString('tr-TR'))}</div>
      </div><div class="score"><div class="n">${score ?? '—'}</div><div class="l">${esc(scoreLabel)}</div></div></div>
      <div class="sum"><div>Toplam<b>${stats.total}</b></div><div>Açık<b>${stats.open}</b></div><div style="color:#c0392b">Hata<b>${stats.error}</b></div><div style="color:#b8860b">Uyarı<b>${stats.warn}</b></div><div style="color:#2e6da4">Bilgi<b>${stats.info}</b></div><div style="color:#2e7d52">Çözüldü<b>${stats.resolved}</b></div></div>
      ${allFindings.length === 0 ? '<p>Bu dönem için bulgu üretilmedi — defter ön kontrolden temiz geçti.</p>' : body}
      <footer><span>Moren Mali Müşavirlik · e-Defter Ön Kontrol</span><span>Yapay zekâ destekli ön kontroldür; nihai değerlendirme mali müşavire aittir.</span></footer>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
      </body></html>`;
    w.document.write(html);
    w.document.close();
    toast.success('PDF raporu hazırlandı; yazdır penceresinden "PDF olarak kaydet" seçin');
  };

  const selectStyle = (accent = false): CSSProperties => ({
    background: 'rgba(255,255,255,.05)', border: `1px solid ${BORDER_STRONG}`, color: accent ? NAVY : TEXT,
    backgroundImage: ARROW('5b8def'), backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '34px',
  });

  return (
    <div data-edefter-control data-ops-page="ajanlar" className="space-y-4">
      {/* ════════ BAŞLIK KARTI — kimlik + eylemler + tek satır hap rozetler + seçiciler ════════ */}
      <Kart className="ops-module-card" renk={NAVY} serit>
        <div data-portal-page-header className="px-5 pt-4 pb-4 flex flex-wrap items-start gap-4">
          <div className="flex items-center gap-3.5 flex-1 min-w-[320px]">
            <span className="grid h-12 w-12 place-items-center rounded-2xl shrink-0" style={portalStyle(ikonStili(NAVY))}>
              <BookOpen size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase font-bold tracking-[.22em] mb-0.5" style={portalStyle({ color: NAVY })}>e-Defter Ön Kontrol</div>
              <h1 className="truncate" style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: TEXT, lineHeight: 1.2 })}>
                {taxpayerName(selectedTp)}
              </h1>
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                <Hap renk={NAVY}>{periodDescriptor(periodMode, year, quarter, month)}</Hap>
                {session && <Hap renk={GRAY}>{session.totalVouchers ?? 0} fiş · {session.totalLines ?? 0} satır</Hap>}
                {session && (mizan
                  ? <Hap renk={OK} title={`Mizan ${fmtDateTime(mizan.createdAt)} tarihinde çekildi ve denetimde kullanıldı`}><FileSpreadsheet size={11} /> Mizan {mizan.hesapCount} hesap</Hap>
                  : <Hap renk={ERR} title="Mizan bu denetime bağlanmadı — açılış bakiyeleri hesaba katılamıyor"><FileSpreadsheet size={11} /> Mizan yok</Hap>)}
                {session?.createdAt && <Hap renk={GRAY}>Son kontrol {fmtDateTime(session.createdAt)}</Hap>}
                {kontrolOzeti?.ozet && <Hap renk={OK}><CheckCircle2 size={11} /> {kontrolOzeti.ozet.calisti}/{kontrolOzeti.ozet.kural} kontrol · {kontrolOzeti.ozet.hesap} hesap</Hap>}
              </div>
            </div>
          </div>
          {/* Eylemler: ana düğme + ikincil grup (her zaman görünür) */}
          <div className="flex items-center gap-2 flex-wrap">
            <button data-ed-btn="luca" disabled={!taxpayerId || fetchMut.isPending || !!lucaJobId} onClick={() => fetchMut.mutate()} className="h-10 pl-2 pr-4 rounded-xl text-[13px] font-semibold inline-flex items-center gap-2.5 disabled:opacity-50" style={portalStyle({ background: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#fff', boxShadow: '0 6px 18px rgba(59,130,246,.38)' })}>
              <span className="grid place-items-center w-[26px] h-[26px] rounded-lg" style={portalStyle({ background: 'rgba(255,255,255,.18)' })}>{fetchMut.isPending || lucaJobId ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}</span> Luca'dan Çek
            </button>
            <div data-ed-btn-group className="inline-flex h-10 rounded-xl overflow-hidden" style={portalStyle({ border: `1px solid ${BORDER_STRONG}`, background: 'rgba(255,255,255,.04)' })}>
              <button disabled={!activeSessionId || exportMut.isPending} onClick={() => exportMut.mutate()} className="px-3 text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={portalStyle({ color: 'rgba(250,250,249,.85)' })} title="Bulguları Excel olarak indir">
                {exportMut.isPending ? <Loader2 size={13} className="animate-spin" style={portalStyle({ color: NAVY })} /> : <Download size={13} style={portalStyle({ color: NAVY })} />} Excel
              </button>
              <button disabled={!activeSessionId} onClick={printReport} className="px-3 text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={portalStyle({ color: 'rgba(250,250,249,.85)', borderLeft: `1px solid ${BORDER}` })} title="Müşteri raporu (yazdır / PDF)">
                <FileText size={13} style={portalStyle({ color: NAVY })} /> PDF Rapor
              </button>
              <button disabled={!activeSessionId || reanalyzeMut.isPending} onClick={() => reanalyzeMut.mutate()} className="px-3 text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={portalStyle({ color: 'rgba(250,250,249,.85)', borderLeft: `1px solid ${BORDER}` })} title="Kayıtlı Excel'i tüm kurallarla yeniden analiz et">
                {reanalyzeMut.isPending ? <Loader2 size={13} className="animate-spin" style={portalStyle({ color: NAVY })} /> : <RotateCcw size={13} style={portalStyle({ color: NAVY })} />} Yeniden Analiz
              </button>
              <label className="px-3 text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer" style={portalStyle({ color: 'rgba(250,250,249,.85)', borderLeft: `1px solid ${BORDER}` })} title="Detay Fiş Listesi Excel'i elle yükle">
                <UploadCloud size={13} style={portalStyle({ color: NAVY })} /> Yükle
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadMut.mutate(file); e.currentTarget.value = ''; }} />
              </label>
            </div>
          </div>
        </div>

        {/* Seçici bandı — etiketli, hizalı kontroller */}
        <div className="ed-period px-5 py-3.5 flex flex-wrap items-end gap-x-4 gap-y-3" style={portalStyle({ background: 'rgba(0,0,0,.24)', borderTop: `1px solid ${BORDER}` })}>
          <label className="flex flex-col gap-1.5 flex-1 min-w-[260px]">
            <span className="text-[9px] uppercase tracking-[.16em] font-bold" style={portalStyle({ color: MUTED2 })}>Mükellef <span style={portalStyle({ color: NAVY })}>· {taxpayers.length} bilanço</span></span>
            <TaxpayerSelect taxpayers={taxpayers} value={taxpayerId} onChange={(id) => { setTaxpayerId(id); setSelectedSessionId(null); }} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase tracking-[.16em] font-bold" style={portalStyle({ color: MUTED2 })}>Yıl</span>
            <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setSelectedSessionId(null); }} className="h-11 rounded-xl px-3 text-[13px] tabular-nums appearance-none cursor-pointer" style={portalStyle(selectStyle())}>
              {Array.from({ length: 7 }, (_, i) => now.getFullYear() + 1 - i).map((y) => (<option key={y} value={y} style={portalStyle({ background: '#1a1a17', color: TEXT })}>{y}</option>))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase tracking-[.16em] font-bold" style={portalStyle({ color: MUTED2 })}>Dönem Türü</span>
            <div className="inline-flex h-11 p-1 rounded-xl" style={portalStyle({ background: 'rgba(255,255,255,.04)', border: `1px solid ${BORDER}` })}>
              {(['GECICI', 'AYLIK', 'YILLIK'] as PeriodMode[]).map((mode) => {
                const on = periodMode === mode;
                return (
                  <button key={mode} aria-pressed={on} onClick={() => { setPeriodMode(mode); setSelectedSessionId(null); }} className="px-4 rounded-lg text-[13px] font-semibold transition-all" style={portalStyle({ background: on ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : 'transparent', color: on ? '#fff' : 'rgba(250,250,249,.6)', boxShadow: on ? '0 4px 12px rgba(59,130,246,.4)' : 'none' })}>
                    {mode === 'GECICI' ? 'Geçici' : mode === 'AYLIK' ? 'Aylık' : 'Yıllık'}
                  </button>
                );
              })}
            </div>
          </div>
          {periodMode === 'GECICI' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] uppercase tracking-[.16em] font-bold" style={portalStyle({ color: MUTED2 })}>Çeyrek</span>
              <div className="inline-flex h-11 p-1 rounded-xl" style={portalStyle({ background: 'rgba(255,255,255,.04)', border: `1px solid ${BORDER}` })}>
                {[1, 2, 3, 4].map((q) => {
                  const on = quarter === q;
                  return (
                    <button key={q} aria-pressed={on} onClick={() => { setQuarter(q); setSelectedSessionId(null); }} className="w-11 rounded-lg text-[13px] font-semibold transition-all" style={portalStyle({ background: on ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : 'transparent', color: on ? '#fff' : 'rgba(250,250,249,.65)', boxShadow: on ? '0 4px 12px rgba(59,130,246,.4)' : 'none' })}>
                      {q}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {periodMode === 'AYLIK' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[9px] uppercase tracking-[.16em] font-bold" style={portalStyle({ color: MUTED2 })}>Ay</span>
              <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setSelectedSessionId(null); }} className="h-11 rounded-xl px-3 text-[13px] appearance-none cursor-pointer" style={portalStyle(selectStyle())}>
                {MONTH_LABELS.map((label, i) => (<option key={i + 1} value={i + 1} style={portalStyle({ background: '#1a1a17', color: TEXT })}>{label}</option>))}
              </select>
            </label>
          )}
          {periodSessions.length > 1 && (
            <label className="flex flex-col gap-1.5 ml-auto">
              <span className="text-[9px] uppercase tracking-[.16em] font-bold" style={portalStyle({ color: MUTED2 })}>Versiyon</span>
              <select value={activeSessionId || ''} onChange={(e) => setSelectedSessionId(e.target.value)} className="h-11 rounded-xl px-3 text-[13px] appearance-none cursor-pointer" style={portalStyle(selectStyle(true))}>
                {periodSessions.map((s: any, i: number) => (
                  <option key={s.id} value={s.id} style={portalStyle({ background: '#1a1a17', color: TEXT })}>{i === 0 ? '★ ' : ''}v{periodSessions.length - i} · {fmtDateTime(s.createdAt)} · {s.findingCount} bulgu</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {lucaStatus && (
          <div className="px-5 py-2.5 text-xs flex items-center gap-2" style={portalStyle({ background: 'rgba(91,141,239,.08)', borderTop: '1px solid rgba(91,141,239,.20)', color: '#bfd4ff' })}>
            <Loader2 size={13} className="animate-spin shrink-0" /> {lucaStatus}
          </div>
        )}
      </Kart>

      {/* ════════ KAHRAMAN KART — denetim özeti (tek kart: skor · şiddet · durum) ════════ */}
      <section className="ed-summary rounded-2xl" style={portalStyle(kahramanKartStili(hasData ? scoreColor : NAVY))}>
        <div className="px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex items-center gap-4 min-w-[250px]">
            <Gauge score={score} color={scoreColor} hasData={hasData} />
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[.08em] px-2.5 py-1 rounded-lg w-fit" style={portalStyle({ background: `${hasData ? scoreColor : GRAY}22`, color: hasData ? scoreColor : GRAY, border: `1px solid ${hasData ? scoreColor : GRAY}44` })}>
                {scoreLabel}
              </span>
              <span className="text-[11.5px] leading-snug max-w-[220px]" style={portalStyle({ color: MUTED })}>{scoreHint}</span>
            </div>
          </div>
          <div className="flex-1 min-w-[280px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[.18em] font-bold" style={portalStyle({ color: MUTED2 })}>Şiddet dağılımı</span>
              <span className="text-[11px] tabular-nums" style={portalStyle({ color: MUTED })}>{sevTotal} açık bulgu · {groupedFindings.length} alan</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden flex" style={portalStyle({ background: 'rgba(255,255,255,.06)' })}>
              <div style={portalStyle({ width: `${pct(stats.error)}%`, background: ERR, transition: 'width .3s' })} />
              <div style={portalStyle({ width: `${pct(stats.warn)}%`, background: WARN, transition: 'width .3s' })} />
              <div style={portalStyle({ width: `${pct(stats.info)}%`, background: INFO, transition: 'width .3s' })} />
            </div>
            <div className="flex items-center gap-5 mt-2.5 flex-wrap">
              <LegendItem color={ERR} label="Hata" value={stats.error} active={severityFilter === 'ERROR'} onClick={() => toggleSeverity('ERROR')} />
              <LegendItem color={WARN} label="Uyarı" value={stats.warn} active={severityFilter === 'WARN'} onClick={() => toggleSeverity('WARN')} />
              <LegendItem color={INFO} label="Bilgi" value={stats.info} active={severityFilter === 'INFO'} onClick={() => toggleSeverity('INFO')} />
            </div>
          </div>
          <div className="flex flex-col gap-2 min-w-[230px]">
            <span className="text-[10px] uppercase tracking-[.18em] font-bold" style={portalStyle({ color: MUTED2 })}>Bulgu durumu</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Hap renk={NAVY} dolu={statusFilter === 'OPEN'} onClick={() => pickStatus('OPEN')}>Açık {stats.open}</Hap>
              <Hap renk={OK} dolu={statusFilter === 'RESOLVED'} onClick={() => pickStatus('RESOLVED')}>Çözüldü {stats.resolved}</Hap>
              <Hap renk={GRAY} dolu={statusFilter === 'IGNORED'} onClick={() => pickStatus('IGNORED')}>Görmezden {stats.ignored}</Hap>
              <Hap renk={GRAY} dolu={statusFilter === 'ALL'} onClick={() => pickStatus('ALL')}>Tümü {stats.total}</Hap>
            </div>
            <span className="text-[11px]" style={portalStyle({ color: MUTED2 })}>
              {!hasData ? 'Dönem seçip Luca’dan çekince özet burada.' : stats.open === 0 ? 'Açık bulgu kalmadı.' : 'Hap rozete tıkla → liste süzülür.'}
            </span>
          </div>
        </div>
      </section>

      {/* ════════ HAP SEKMELER → aynı anda TEK içerik kartı ════════ */}
      <div data-ed-tabs className="flex items-center gap-2 flex-wrap px-0.5">
        <HapSekme active={activeTab === 'BULGULAR'} onClick={() => setActiveTab('BULGULAR')} icon={LayoutGrid} label="Bulgular" badge={stats.open} />
        <HapSekme active={activeTab === 'HESAPLAR'} onClick={() => setActiveTab('HESAPLAR')} icon={Building2} label="Hesaplar" badge={kontrolOzeti?.ozet?.hesap || 0} />
        <HapSekme active={activeTab === 'SATIRLAR'} onClick={() => setActiveTab('SATIRLAR')} icon={ListChecks} label="Fiş Satırları" badge={lines.length} />
        <HapSekme active={activeTab === 'MIZAN'} onClick={() => setActiveTab('MIZAN')} icon={FileSpreadsheet} label="Mizan Denetimi" badge={mizanBulgulari.length} />
        <HapSekme active={activeTab === 'KURALLAR'} onClick={() => setActiveTab('KURALLAR')} icon={Sparkles} label="Kontrol Kuralları" />
        <HapSekme active={activeTab === 'GECMIS'} onClick={() => setActiveTab('GECMIS')} icon={History} label="Geçmiş Kontroller" badge={periodSessions.length} />
      </div>

      <Kart renk={NAVY} className="p-4 ops-module-card">
      {/* ════════ TAB: BULGULAR (alan → kural → satır; derli toplu) ════════ */}
      {activeTab === 'BULGULAR' && (
        <BulgularSekmesi
          session={session}
          allFindings={allFindings}
          visibleFindings={visibleFindings}
          stats={stats}
          katalog={katalog}
          kontrolOzeti={kontrolOzeti}
          findingSearch={findingSearch}
          setFindingSearch={setFindingSearch}
          severityFilter={severityFilter}
          setSeverityFilter={setSeverityFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          focusFinding={focusFinding}
          handleStatusChange={handleStatusChange}
        />
      )}

      {/* ════════ TAB: HESAPLAR (her yaprak hesabın dönem kartı) ════════ */}
      {activeTab === 'HESAPLAR' && (
        <HesaplarSekmesi
          session={session}
          kontrolOzeti={kontrolOzeti}
          allFindings={allFindings}
          onHesapSec={(kod) => { setFindingSearch(kod); setSeverityFilter('ALL'); setStatusFilter('OPEN'); setActiveTab('BULGULAR'); }}
        />
      )}

      {/* ════════ TAB: MIZAN DENETİMİ — TEK LİSTE: mizana dayanan e-Defter kuralları + Mizan modülünün kendi bulguları ════════ */}
      {activeTab === 'MIZAN' && (
        <div className="space-y-3">
          {!mizan ? (
            <div className="rounded-2xl p-12 text-center" style={portalStyle({ background: PANEL, border: `1px dashed ${BORDER_STRONG}` })}>
              <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={portalStyle({ background: NAVY_SOFT, color: NAVY })}>
                <FileSpreadsheet size={26} />
              </div>
              <div className="text-base font-semibold mb-1" style={portalStyle({ color: TEXT })}>Mizan henüz çekilmedi</div>
              <div className="text-xs" style={portalStyle({ color: MUTED })}>"Luca'dan Çek" butonunu kullandığında aynı dönemin mizanı otomatik olarak buraya gelir.</div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <BigStat label="Toplam Hesap" value={mizan.hesapCount || 0} color={TEXT} />
                <BigStat label="Mizan Bulgusu" value={mizanBulgulari.length} color={TEXT} />
                <div className="rounded-xl p-3" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}` })}>
                  <div className="text-[9px] uppercase tracking-[.18em] mb-1" style={portalStyle({ color: MUTED2 })}>Durum</div>
                  <div className="text-sm font-semibold" style={portalStyle({ color: String(mizan.status || '').toUpperCase() === 'READY' ? OK : NAVY })}>{mizanDurumLabel(mizan.status)}</div>
                </div>
                <div className="rounded-xl p-3" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}` })}>
                  <div className="text-[9px] uppercase tracking-[.18em] mb-1" style={portalStyle({ color: MUTED2 })}>Güncelleme</div>
                  <div className="text-xs font-semibold tabular-nums" style={portalStyle({ color: TEXT })}>{fmtDateTime(mizan.updatedAt || mizan.createdAt)}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px]" style={portalStyle({ color: MUTED2 })}>
                  Mizan bakiyesine dayanan kontroller — e-Defter kuralları ({mizanBulgulari.filter((f: any) => !f.saltGorunum).length}) ve Mizan modülünün kendi kontrolü ({mizanLeafAnomalies.length}); ana hesap toplamları (örn. 10, 100) gizlenir.
                </span>
                {mizanAlanlar.length > 0 && (
                  <div className="ml-auto inline-flex h-9 p-0.5 rounded-lg gap-0.5" style={portalStyle({ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` })}>
                    <button onClick={() => setMizanKapaliKurallar({})} className="px-2.5 rounded-md text-[11px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,.7)' })} title="Tüm kural bloklarını aç">Genişlet</button>
                    <button onClick={() => setMizanKapaliKurallar(tumKurallariDaralt(mizanAlanlar))} className="px-2.5 rounded-md text-[11px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,.7)' })} title="Yalnız kural başlıkları kalsın">Daralt</button>
                  </div>
                )}
              </div>

              {mizanAlanlar.length === 0 ? (
                <div className="rounded-2xl p-10 text-center" style={portalStyle({ background: 'rgba(92,191,138,.05)', border: '1px dashed rgba(92,191,138,.2)' })}>
                  <div className="inline-flex h-12 w-12 rounded-full items-center justify-center mb-3" style={portalStyle({ background: 'rgba(92,191,138,.15)', color: OK })}>
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="text-base font-semibold mb-1" style={portalStyle({ color: '#aeddc4' })}>Mizan kontrolünde bulgu yok</div>
                  <div className="text-xs" style={portalStyle({ color: MUTED })}>{mizan.hesapCount || 0} hesap kontrol edildi, mizana dayanan kurallar ve mizan disiplini açısından temiz.</div>
                </div>
              ) : (
                <BulguTablosu
                  alanlar={mizanAlanlar}
                  katalog={mizanKatalog}
                  kapaliKurallar={mizanKapaliKurallar}
                  setKapaliKurallar={setMizanKapaliKurallar}
                  focusFinding={focusFinding}
                  handleStatusChange={handleStatusChange}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ════════ TAB: FİŞ SATIRLARI ════════ */}
      {activeTab === 'SATIRLAR' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-10 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[300px]" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' })}>
              <Search size={14} />
              <input value={lineSearch} onChange={(e) => setLineSearch(e.target.value)} placeholder="Satır, fiş, evrak, hesap veya açıklama ara..." className="bg-transparent outline-none text-sm w-full" style={portalStyle({ color: TEXT })} />
            </div>
            <span className="text-xs tabular-nums" style={portalStyle({ color: MUTED })}>{visibleLines.length}/{lines.length}</span>
            {focusedFinding && (
              <button onClick={() => setFocusedFinding(null)} className="h-10 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1" style={portalStyle({ background: NAVY_SOFT, color: NAVY, border: `1px solid ${BORDER_STRONG}` })}>
                <XCircle size={12} /> Bulgu filtresini temizle
              </button>
            )}
          </div>

          {session && visibleLines.length === 0 && (<div className="rounded-2xl p-12 text-center" style={portalStyle({ background: PANEL, border: `1px dashed ${BORDER_STRONG}`, color: MUTED })}>Bu filtreyle satır bulunamadı.</div>)}
          {!session && (<div className="rounded-2xl p-12 text-center" style={portalStyle({ background: PANEL, border: `1px dashed ${BORDER_STRONG}`, color: MUTED })}>Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.</div>)}

          <div className="space-y-3 max-h-[720px] overflow-auto pr-1">
            {(() => {
              const groups: any[] = [];
              const groupMap = new Map<string, any>();
              // 2026-06-11: Limit 1000 -> 20000 (backend served satır limiti ile aynı).
              // 1000 çok düşüktü: çok fişli mükellefte (ör. İLGİ OTO ~2600 satır) liste
              // dönem ortasında (~13.02) kesiliyor, sonraki fişler (31.03 dahil) gizleniyor
              // -> denetim eksik/yanlış SANILIYORDU. Denetim arka uçta zaten TÜM satırlarda
              // çalışıyor (doğru); bu yalnız gösterim kesintisiydi.
              for (const line of visibleLines.slice(0, 20000)) {
                const key = line.voucherKey || `row-${line.rowIndex}`;
                if (!groupMap.has(key)) {
                  const g = { key, lines: [] as any[], first: line, borcSum: 0, alacakSum: 0 };
                  groupMap.set(key, g);
                  groups.push(g);
                }
                const g = groupMap.get(key);
                g.lines.push(line);
                g.borcSum += Number(line.borc || 0);
                g.alacakSum += Number(line.alacak || 0);
              }
              return groups.map((g) => {
                const fark = Math.abs(g.borcSum - g.alacakSum);
                const dengesiz = fark > 0.01 && g.lines.length >= 2;
                const focusedHere = focusedFinding?.rowIndex && g.lines.some((l: any) => Number(l.rowIndex) === Number(focusedFinding.rowIndex));
                return (
                  <div key={g.key} className="rounded-xl border overflow-hidden" style={portalStyle({ background: PANEL, borderColor: focusedHere ? 'rgba(91,141,239,.45)' : (dengesiz ? 'rgba(226,112,111,.35)' : BORDER), borderLeftWidth: '3px', borderLeftColor: focusedHere ? NAVY : (dengesiz ? ERR : 'rgba(92,191,138,.5)') })}>
                    <div className="flex flex-wrap items-center gap-3 px-3 py-2" style={portalStyle({ background: focusedHere ? 'rgba(91,141,239,.10)' : 'rgba(0,0,0,.18)', borderBottom: `1px solid ${BORDER}` })}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider" style={portalStyle({ color: MUTED2 })}>Yevmiye</span>
                        <span className="text-base font-bold" style={portalStyle({ color: TEXT, fontFamily: 'monospace' })}>{g.first.yevmiyeNo || g.first.fisNo || '-'}</span>
                      </div>
                      <span className="text-xs" style={portalStyle({ color: MUTED })}>{fmtDate(g.first.fisTarihi)}</span>
                      {g.first.evrakNo && (<span className="text-xs px-2 py-0.5 rounded" style={portalStyle({ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.65)' })}>Evrak: {g.first.evrakNo}</span>)}
                      <span className="text-xs tabular-nums ml-auto" style={portalStyle({ color: MUTED })}>{g.lines.length} satır</span>
                      <span className="text-xs tabular-nums px-2 py-0.5 rounded font-mono" style={portalStyle({ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,.8)' })}>
                        B: {fmtTRY(g.borcSum)} · A: {fmtTRY(g.alacakSum)}
                      </span>
                      {dengesiz && (<span className="text-[10px] font-bold px-2 py-0.5 rounded" style={portalStyle({ background: 'rgba(226,112,111,.18)', color: ERR })}>DENGESİZ {fmtTRY(fark)}</span>)}
                    </div>
                    <table data-ops-table="true" className="w-full text-xs">
                      <tbody>
                        {g.lines.map((line: any, idx: number) => (
                          <tr key={line.id} ref={focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? focusedLineRef : undefined} style={portalStyle({ borderBottom: idx < g.lines.length - 1 ? `1px solid ${BORDER}` : undefined, color: 'rgba(250,250,249,.82)', background: focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? NAVY_SOFT : 'transparent' })}>
                            <td className="py-2 px-3 tabular-nums w-12" style={portalStyle({ color: MUTED2 })}>{line.rowIndex || '-'}</td>
                            <td className="py-2 px-3 whitespace-nowrap w-44">
                              <span className="font-semibold" style={portalStyle({ color: TEXT })}>{line.hesapKodu || '-'}</span>
                            </td>
                            <td className="py-2 px-3" style={portalStyle({ color: 'rgba(250,250,249,.7)' })}>{line.hesapAdi || ''}</td>
                            <td className="py-2 px-3 min-w-[180px]" style={portalStyle({ color: 'rgba(250,250,249,.65)' })}>{line.aciklama || '-'}</td>
                            <td className="py-2 px-3 text-right tabular-nums font-mono w-32" style={portalStyle({ color: Number(line.borc) > 0 ? TEXT : MUTED2 })}>{Number(line.borc) > 0 ? fmtTRY(line.borc) : '-'}</td>
                            <td className="py-2 px-3 text-right tabular-nums font-mono w-32" style={portalStyle({ color: Number(line.alacak) > 0 ? TEXT : MUTED2 })}>{Number(line.alacak) > 0 ? fmtTRY(line.alacak) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ════════ TAB: KONTROL KURALLARI ════════ */}
      {activeTab === 'KURALLAR' && (<KurallarTab />)}

      {/* ════════ TAB: GEÇMİŞ KONTROLLER ════════ */}
      {activeTab === 'GECMIS' && (
        <div className="space-y-3">
          {periodSessions.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={portalStyle({ background: PANEL, border: `1px dashed ${BORDER_STRONG}` })}>
              <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={portalStyle({ background: NAVY_SOFT, color: NAVY })}>
                <Clock size={26} />
              </div>
              <div className="text-base font-semibold mb-1" style={portalStyle({ color: TEXT })}>Henüz Detay Fiş Listesi çekilmedi</div>
              <div className="text-xs" style={portalStyle({ color: MUTED })}>"Luca'dan Çek" butonu ile başlat veya manuel Excel yükle.</div>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={portalStyle({ background: PANEL, borderColor: BORDER })}>
              <table data-ops-table="true" className="w-full text-sm">
                <thead style={portalStyle({ background: 'rgba(0,0,0,.18)' })}>
                  <tr style={portalStyle({ color: MUTED, borderBottom: `1px solid ${BORDER}` })}>
                    <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Versiyon</th>
                    <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Tarih</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Fiş</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Satır</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Bulgu</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSessions.map((s: any, i: number) => {
                    const isActive = activeSessionId === s.id;
                    return (
                      <tr key={s.id} onClick={() => { setSelectedSessionId(s.id); setActiveTab('BULGULAR'); }} className="cursor-pointer" style={portalStyle({ borderBottom: `1px solid ${BORDER}`, background: isActive ? NAVY_SOFT : 'transparent', color: TEXT })}>
                        <td className="py-3 px-4 font-bold" style={portalStyle({ color: isActive ? NAVY : TEXT })}>
                          {i === 0 ? '★ ' : ''}v{periodSessions.length - i}
                        </td>
                        <td className="py-3 px-4" style={portalStyle({ color: 'rgba(250,250,249,.7)' })}>{fmtDateTime(s.createdAt)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{s.totalVouchers}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{s.totalLines}</td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          <span className="font-semibold" style={portalStyle({ color: s.findingCount ? WARN : OK })}>{s.findingCount || 0}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider" style={portalStyle({ background: s.findingCount ? 'rgba(212,168,95,.14)' : 'rgba(92,191,138,.14)', color: s.findingCount ? WARN : OK })}>
                            {s.findingCount ? `${s.findingCount} bulgu` : 'temiz'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </Kart>
    </div>
  );
}

function Gauge({ score, color, hasData }: { score: number | null; color: string; hasData: boolean }) {
  const p = hasData && score != null ? score : 0;
  const ring = hasData ? color : 'rgba(255,255,255,.16)';
  return (
    <div data-ops-gauge="true" className="relative shrink-0" style={portalStyle({ width: 92, height: 92, borderRadius: '50%', background: `conic-gradient(${ring} 0 ${p}%, rgba(255,255,255,.07) ${p}% 100%)` })}>
      <div className="absolute rounded-full" style={portalStyle({ inset: 9, background: '#0e1116' })} />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[27px] font-bold leading-none tabular-nums" style={portalStyle({ color: hasData ? TEXT : MUTED2 })}>{hasData && score != null ? score : '—'}</div>
        <div className="text-[8px] uppercase tracking-[.18em] mt-1" style={portalStyle({ color: MUTED })}>Skor</div>
      </div>
    </div>
  );
}

function Metric({ label, value, color, active, lead, onClick }: { label: string; value: number; color: string; active: boolean; lead?: boolean; onClick: () => void }) {
  return (
    <button data-ops-stat="true" data-ops-selected={active ? 'true' : 'false'} onClick={onClick} className="rounded-xl p-3 text-left transition-all" style={portalStyle({ '--ops-tone': portalStyle({ color: color }).color, border: `1px solid ${active ? 'rgba(91,141,239,.34)' : BORDER}`, background: active || lead ? LEAD_GRAD : 'rgba(255,255,255,.012)' } as React.CSSProperties)}>
      <div data-ops-label="true" className="text-[9px] uppercase tracking-[.16em] mb-1.5" style={portalStyle({ color: active || lead ? 'rgba(91,141,239,.9)' : MUTED2 })}>{label}</div>
      <div data-ops-value="true" className="text-[24px] font-bold tabular-nums leading-none" style={portalStyle({ color })}>{value}</div>
    </button>
  );
}

function LegendItem({ color, label, value, active, onClick }: { color: string; label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button data-ed-severity={label} aria-pressed={active} onClick={onClick} className="ed-counter flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition-all" style={portalStyle({ background: active ? `${color}1a` : 'transparent', outline: active ? `1px solid ${color}55` : 'none' })}>
      <span className="w-2.5 h-2.5 rounded-sm" style={portalStyle({ background: color })} />
      <span className="flex flex-col items-start leading-none">
        <span className="text-[19px] font-bold tabular-nums" style={portalStyle({ color })}>{value}</span>
        <span className="text-[11px] mt-1" style={portalStyle({ color: active ? color : MUTED })}>{label}</span>
      </span>
    </button>
  );
}

function BigStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div data-ed-stat={label} data-portal-kpi className="rounded-xl p-3" style={portalStyle({ '--kpi-tone': portalStyle({color}).color, background: PANEL, border: `1px solid ${BORDER}` } as React.CSSProperties)}>
      <div className="text-[9px] uppercase tracking-[.18em] mb-1" style={portalStyle({ color: MUTED2 })}>{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none" style={portalStyle({ color })}>{value}</div>
    </div>
  );
}

// Hap sekme: seçili = dolu lacivert hap, diğerleri ince kenarlı nötr hap; aynı anda tek içerik kartı görünür.
function HapSekme({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: any; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      data-ed-tab={label}
      className="h-9 px-3.5 rounded-full inline-flex items-center gap-2 text-[12.5px] font-semibold transition-[transform,filter] duration-150 hover:-translate-y-px"
      style={portalStyle(active
        ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY}bb)`, color: '#0b1218', border: '1px solid transparent', boxShadow: '0 6px 16px rgba(91,141,239,.30)' }
        : { background: 'rgba(255,255,255,.035)', color: 'rgba(250,250,249,.72)', border: `1px solid ${BORDER}` })}
    >
      <Icon size={14} />
      {label}
      {badge != null && badge > 0 && (
        <span className="text-[10.5px] tabular-nums px-1.5 py-px rounded-full" style={portalStyle({ background: active ? 'rgba(11,18,24,.18)' : 'rgba(255,255,255,.06)', color: active ? '#0b1218' : 'rgba(250,250,249,.6)' })}>{badge}</span>
      )}
    </button>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: any; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className="h-10 px-4 inline-flex items-center gap-2 text-sm font-semibold border-b-2 transition-colors" style={portalStyle({ borderColor: active ? NAVY : 'transparent', color: active ? NAVY : 'rgba(250,250,249,.55)' })}>
      <Icon size={15} />
      {label}
      {badge != null && badge > 0 && (
        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full" style={portalStyle({ background: active ? NAVY_SOFT : 'rgba(255,255,255,.05)', color: active ? NAVY : 'rgba(250,250,249,.55)' })}>{badge}</span>
      )}
    </button>
  );
}

function SeverityPill({ count, color, label }: { count: number; color: string; label?: string }) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded tabular-nums inline-flex items-center gap-1" style={portalStyle({ background: `${color}1c`, color })}>
      {count}{label ? ` ${label}` : ''}
    </span>
  );
}

function Severity({ value }: { value: string }) {
  const color = sevColor(value);
  return (<span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={portalStyle({ background: `${color}1c`, color })}>{sevLabel(value)}</span>);
}

type KuralDef = { kod: string; ad: string; aciklama: string; severity: 'ERROR' | 'WARN' | 'INFO'; grup: string; aktif: boolean };

const STANDART_KURALLAR: KuralDef[] = [
  { kod: 'DEFTER_GENELI_DENGESIZ', ad: 'Defter geneli borç=alacak', aciklama: 'Tüm dönem toplam borç ile alacak eşit değilse uyarır. Berat oluşturmadan önce mutlaka düzeltilmelidir.', severity: 'ERROR', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'HESAP_KODU_EKSIK', ad: 'Hesap kodu eksik', aciklama: 'Satırda hesap kodu boş bırakılmış.', severity: 'ERROR', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'DONEM_DISI_TARIH', ad: 'Dönem dışı tarih', aciklama: 'Fiş tarihi seçilen dönem aralığının dışında.', severity: 'ERROR', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'FIS_TARIHI_PARSE_HATASI', ad: 'Tarih parse hatası (aggregate)', aciklama: 'Excel sütununda tarih okunamayan satırların toplam sayısı.', severity: 'WARN', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'VKN_FORMAT_HATALI', ad: 'VKN/TCKN format hatası', aciklama: 'VKN/TCKN 10 veya 11 haneli değil.', severity: 'ERROR', grup: 'VKN / TCKN', aktif: true },
  { kod: 'VKN_ALGORITMA_HATALI', ad: 'VKN/TCKN algoritması tutmuyor', aciklama: 'Hane sayısı doğru ama Maliye kontrol algoritması başarısız. BA/BS uyumsuzluğu yaratır.', severity: 'ERROR', grup: 'VKN / TCKN', aktif: true },
  { kod: 'GERCEK_MUKERRER_FATURA', ad: 'Gerçek mükerrer fatura', aciklama: 'Aynı belge no + aynı VKN + aynı tutar üç alan birden eşleşiyor. KDV indirimi mükerrer inmiş olabilir.', severity: 'ERROR', grup: 'Mükerrer Kayıt', aktif: true },
  { kod: 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF', ad: 'Aynı gün/tutar/taraf', aciklama: 'Aynı tarihte aynı VKN için aynı tutarlı 50.000+ TL kayıt birden fazla.', severity: 'WARN', grup: 'Mükerrer Kayıt', aktif: true },
  { kod: 'HAVADA_KDV_KAYDI', ad: 'Havada KDV kaydı', aciklama: '191/391 KDV var ama matrah veya cari/kasa karşılık hesabı yok.', severity: 'ERROR', grup: 'KDV', aktif: true },
  { kod: 'CARI_TERS_BAKIYE_120', ad: '120 ters bakiye', aciklama: '120 Alıcılar dönem hareketinde alacak (ters) bakiye veriyor (eşik 5.000 TL, açılış hariç). Müşteri avansı olabilir ya da bir alış satıcı hesabı (320) yerine 120\'ye işlenmiş olabilir.', severity: 'WARN', grup: 'Cari Hesap', aktif: true },
  { kod: 'CARI_TERS_BAKIYE_320', ad: '320 ters bakiye', aciklama: '320 Satıcılar dönem hareketinde borç (ters) bakiye veriyor (eşik 5.000 TL, açılış hariç). Satıcıya avans olabilir ya da bir satış müşteri hesabı (120) yerine 320\'ye işlenmiş olabilir.', severity: 'WARN', grup: 'Cari Hesap', aktif: true },
  { kod: 'ORTAK_ALACAK_FAIZ_RISKI', ad: '131 ortak alacağı', aciklama: '131 Ortaklardan Alacaklar net bakiyesi 100.000+ TL. KKEG faiz hesaplaması gerekebilir.', severity: 'INFO', grup: 'KKEG', aktif: true },
  { kod: 'KASA_HAREKET_30000_TEVSIK_RISKI', ad: 'Kasa hareket 30.000 TL', aciklama: 'Tek 100 Kasa hareketi 30.000 TL sınırını aşıyorsa ödeme/tahsilat mahiyeti ve banka/finans kurumu belgesi kontrol edilir.', severity: 'WARN', grup: 'Tevsik', aktif: true },
  { kod: 'KASA_TEVSIK_PARCALAMA', ad: 'Aynı gün aynı taraf kasa toplamı', aciklama: 'Aynı VKN/TCKN için aynı gün yapılan birden fazla kasa hareketi birlikte 30.000 TL sınırını aşıyorsa parçalama riski kontrol edilir.', severity: 'WARN', grup: 'Tevsik', aktif: true },
  { kod: 'KASA_TEVSIK_BOLUNMUS_ISLEM', ad: 'Kısım kısım kasa işlemi', aciklama: 'Aynı VKN/TCKN ve aynı belge no için farklı günlerdeki kasa hareketleri toplamı 30.000 TL sınırını aşıyorsa kısmi ödeme/tahsilat tevsiki kontrol edilir.', severity: 'WARN', grup: 'Tevsik', aktif: true },
  { kod: 'FIS_DENGESIZ', ad: 'Fiş dengesiz', aciklama: 'Tek fişin borç ve alacak toplamları eşit değil.', severity: 'ERROR', grup: 'Yevmiye', aktif: true },
  { kod: 'YEVMIYE_NO_MUKERRER', ad: 'Yevmiye no mükerrer', aciklama: 'Aynı yevmiye numarası farklı tarihlerde / farklı fişlerde kullanılmış.', severity: 'ERROR', grup: 'Yevmiye', aktif: true },
  { kod: 'YEVMIYE_NO_ATLAMA', ad: 'Yevmiye no atlama', aciklama: 'Yevmiye numarası sırasında atlanmış aralık var (tek özet). Genelde iptal edilen fişlerden kaynaklanır.', severity: 'INFO', grup: 'Yevmiye', aktif: true },
  { kod: 'YEVMIYE_TARIH_SIRASI', ad: 'Yevmiye tarih sırası', aciklama: 'Yevmiye numarası ile fiş tarihleri sıralı değil.', severity: 'WARN', grup: 'Yevmiye', aktif: true },
  { kod: 'BOS_FIS', ad: 'Boş fiş', aciklama: 'Fişte hiçbir hareket satırı yok.', severity: 'WARN', grup: 'Yevmiye', aktif: true },
  { kod: 'TEK_SATIRLI_FIS', ad: 'Tek satırlı fiş', aciklama: 'Fişte sadece 1 hareket satırı var — çift taraflı kayıt prensibi ihlali.', severity: 'WARN', grup: 'Yevmiye', aktif: true },
  { kod: 'BELGE_TARIHI_FIS_TARIHINDEN_SONRA', ad: 'Belge tarihi > fiş tarihi', aciklama: 'Belge tarihi fiş tarihinden sonra — mantıken belge kaydedildiği günden sonra düzenlenmiş.', severity: 'WARN', grup: 'Belge', aktif: true },
  { kod: 'BELGE_TARIHI_DONEM_DISI', ad: 'Belge tarihi dönem dışı', aciklama: 'Belge tarihi seçilen dönem aralığının dışında.', severity: 'WARN', grup: 'Belge', aktif: true },
  { kod: 'YUKSEK_TUTAR_ACIKLAMA_EKSIK', ad: 'Yüksek tutar açıklama eksik', aciklama: '50.000+ TL fişte açıklama 5 karakterden az — denetimde riskli.', severity: 'INFO', grup: 'Kalite', aktif: true },
  { kod: 'DONEM_SONU_191_BAKIYE', ad: '191 dönem sonu bakiye', aciklama: 'Dönem sonu 191 İndirilecek KDV bakiyesi sıfırlanmamış — tahakkuk fişi eksik.', severity: 'WARN', grup: 'KDV', aktif: true },
  { kod: 'DONEM_SONU_391_BAKIYE', ad: '391 dönem sonu bakiye', aciklama: 'Dönem sonu 391 Hesaplanan KDV bakiyesi sıfırlanmamış — tahakkuk fişi eksik.', severity: 'WARN', grup: 'KDV', aktif: true },
  { kod: 'KDV_TAHAKKUK_EKSIK', ad: 'KDV tahakkuk fişi eksik', aciklama: 'Ay içinde 191/391 hareketi var ama tahakkuk fişi bulunamadı. Çeyrek dönemde son ayın tahakkuku bir sonrakine kaymış olabilir.', severity: 'WARN', grup: 'KDV', aktif: true },
  { kod: 'BORDRO_TAHAKKUK_EKSIK', ad: 'Aylık bordro tahakkuku eksik', aciklama: 'Her ay 770/772 personel gideri + 335 net ücret + 361 SGK kayıtları olmalı.', severity: 'WARN', grup: 'Bordro / SGK', aktif: true },
  { kod: 'KIRA_STOPAJI_EKSIK', ad: 'Kira stopajı eksik', aciklama: 'Kira gideri var ama 360 altında kira stopajı kaydı yok. %20 stopaj (GVK 94) ayrı fişte/dönemde olabilir; kontrol edilmeli.', severity: 'WARN', grup: 'Stopaj', aktif: true },
  { kod: 'KIRA_STOPAJI_ORAN', ad: 'Kira stopaj oranı sapma', aciklama: 'Kira/stopaj oranı %20 dışında — brüt/net hesaplama hatalı olabilir.', severity: 'WARN', grup: 'Stopaj', aktif: true },
  { kod: 'SMM_STOPAJI_KONTROL', ad: 'Serbest meslek stopajı eksik', aciklama: 'SMM/avukat/noter/tercüme ödemesi var ama 360.01.007 boş. %20 tevkifat zorunlu.', severity: 'WARN', grup: 'Stopaj', aktif: true },
  { kod: 'DAMGA_VERGISI_KONTROL', ad: 'Damga vergisi kontrolü', aciklama: 'Personel ücret/bordro kaydı var ama 360.01.002 veya 360 altında damga kaydı görünmüyorsa bilgi verir. Asgari ücret istisnası veya ayrı fiş ihtimali nedeniyle kesin hata sayılmaz.', severity: 'INFO', grup: 'Stopaj', aktif: true },
  { kod: 'ACILIS_FISI_YOK', ad: 'Açılış fişi yok', aciklama: 'Dönem başında (1 Ocak) açılış kaydı bulunamadı; geçen yıl kapanış mizanıyla bire bir olmalı.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'ACILIS_FISINDE_GELIR_GIDER', ad: 'Açılış fişinde 5/6/7xx', aciklama: 'Açılış fişinde gelir-gider-maliyet (5xx/6xx/7xx) hesabı olmamalı.', severity: 'ERROR', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'YILLIK_KAPANIS_690_EKSIK', ad: 'Yıllık kapanış 690 eksik', aciklama: 'Yıl sonunda 6xx/7xx var ama 690 Dönem Kârı/Zararı hesabı kullanılmamış.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'VERGI_KARSILIGI_370_YOK', ad: '370 Vergi karşılığı yok', aciklama: 'Yıl sonu 690 kullanılmış ama 370/371 vergi karşılığı hesaplanmamış.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'YILSONU_AMORTISMAN_EKSIK', ad: 'Yıl sonu amortisman eksik', aciklama: 'Sabit kıymet var ama 257/268 birikmiş amortisman + 770/760/730 amortisman gider kaydı eksik (VUK 333).', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'AVANS_KAPANMAMIS_159', ad: '159 Verilen avans açık', aciklama: '159 Verilen Sipariş Avansları hesabında 10.000+ TL açık bakiye — mal/hizmet teslim alındıysa kapatılmalı.', severity: 'INFO', grup: 'Avans', aktif: true },
  { kod: 'AVANS_KAPANMAMIS_340', ad: '340 Alınan avans açık', aciklama: '340 Alınan Sipariş Avansları hesabında 10.000+ TL açık bakiye.', severity: 'INFO', grup: 'Avans', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_121', ad: '121 Alınan çek bakiyesi', aciklama: 'Dönem sonu 121 bakiyesi var — vadesi geçmiş çek olabilir.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_122', ad: '122 Alınan senet bakiyesi', aciklama: 'Dönem sonu 122 bakiyesi var — vadesi geçmiş senet olabilir.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_322', ad: '322 Verilen çek bakiyesi', aciklama: 'Dönem sonu 322 bakiyesi var — vadesi geçmiş çek olabilir.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_323', ad: '323 Verilen senet bakiyesi', aciklama: 'Dönem sonu 323 bakiyesi var.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'BANKA_EKSI_BAKIYE_102', ad: '102 Banka eksi bakiye', aciklama: 'Banka hesabı dönem hareketinde alacak (eksi) bakiye veriyor (açılış/devir hariç). Gerçekten eksiyse 300 Banka Kredileri hesabında izlenmeli.', severity: 'WARN', grup: 'Banka', aktif: true },
  { kod: 'POS_VALOR_108_BAKIYE', ad: '108 POS valör bakiyesi', aciklama: '108 POS hesabında bakiye — valör tarihi geçip 102 banka hesabına geçmesi gereken kayıtlar olabilir.', severity: 'INFO', grup: 'Banka', aktif: true },
  { kod: 'KKEG_689_KONTROL', ad: '689 KKEG kontrolü', aciklama: '689 Diğer Olağandışı Gider hesabında hareket var — KKEG ise Kurumlar Vergisi matrahına eklenmeli.', severity: 'INFO', grup: 'KKEG', aktif: true },
  { kod: 'BENFORD_SAPMA', ad: 'Benford yasası sapması', aciklama: 'Tutarların ilk basamak dağılımı Benford yasasından sapıyor (MAD eşiği). Doğal olmayan/uydurulmuş tutar göstergesi olabilir — VEDAS resmî olarak kullanır.', severity: 'WARN', grup: 'Forensic / Anomali', aktif: true },
  { kod: 'YUVARLAK_TUTAR_YIGILMASI', ad: 'Yuvarlak tutar yığılması', aciklama: '1.000 TL ve üzeri tutarların aşırı yüksek oranı tam yuvarlak (1.000/10.000 katı). Tahmini/uydurma kayıt işareti.', severity: 'WARN', grup: 'Forensic / Anomali', aktif: true },
  { kod: 'HAFTA_SONU_KAYDI', ad: 'Hafta sonu kaydı', aciklama: 'Cumartesi/Pazar tarihli fişler. Mesai dışı kayıtlar BDS 240 kapsamında denetimde gözden geçirilir.', severity: 'INFO', grup: 'Forensic / Anomali', aktif: true },
  { kod: 'SUPHELI_ACIKLAMA', ad: 'Şüpheli açıklama', aciklama: 'Açıklamada "düzeltme, iptal, hata, sehven, geri alma" gibi riskli ifadeler. Düzeltme/iptal kayıtları denetimde önceliklidir.', severity: 'INFO', grup: 'Forensic / Anomali', aktif: true },
  { kod: 'KASA_GUNLUK_NEGATIF_BAKIYE', ad: 'Kasa günlük negatif bakiye', aciklama: 'Kasa (100) gün sonu bakiyesi eksiye düşemez (fiziki nakit). Açılış fişi/Mizan ile kesin (ERROR), yoksa açılış hariç (WARN). Negatif = eksik tahsilat/gelir, ortaklardan ödeme (131) ya da fiş tarihi hatası.', severity: 'ERROR', grup: 'Bakiye Kontrolü', aktif: true },
  { kod: 'STOK_NEGATIF_BAKIYE', ad: 'Stok negatif bakiye', aciklama: 'Stok (150-153) gün sonu eksiye düşemez — elde olmayan mal satılamaz. Her stok hesabı ayrı yürütülür. Negatif = alış/giriş kaydı eksik/geç, maliyet/miktar hatası.', severity: 'WARN', grup: 'Bakiye Kontrolü', aktif: true },
  { kod: 'BANKA_GUNLUK_EKSI_BAKIYE', ad: 'Banka günlük eksi bakiye', aciklama: 'Banka (102) gün sonu eksi (alacak) bakiye veriyor (eşik 1.000 TL, her hesap ayrı). Gerçekten kredili mevduat ise 300 Banka Kredileri\'nde izlenmeli; değilse eksik tahsilat/yanlış hesap.', severity: 'WARN', grup: 'Bakiye Kontrolü', aktif: true },
  { kod: 'MIZAN_FIS_UYUMSUZ', ad: 'Mizan ↔ fiş uyumsuz', aciklama: 'Tam defterde (açılış fişi var) yevmiyeden hesaplanan kapanış bakiyesi ile Mizan bakiyesi tutmuyor — yevmiyede eksik/fazla fiş ya da Mizan güncel değil. Kısmi dönemde (açılış yok) çalışmaz.', severity: 'WARN', grup: 'Mizan Mutabakatı', aktif: true },
];

const EK_KAPALI_KURALLAR: KuralDef[] = [
  { kod: 'SIFIR_TUTARLI_SATIR', ad: 'Sıfır tutarlı satır', aciklama: 'Hesap kodu olduğu halde borç/alacak tutarı sıfır olan satırları yakalar. Rapor formatından çok gürültü üretebildiği için varsayılan pasif.', severity: 'INFO', grup: 'Temel Bütünlük', aktif: false },
  { kod: 'SATIRDA_BORC_ALACAK_BIRLIKTE', ad: 'Satırda borç/alacak birlikte', aciklama: 'Aynı satırda hem borç hem alacak tutarı varsa uyarır. Bazı aktarım formatlarında teknik satır olabildiği için varsayılan pasif.', severity: 'WARN', grup: 'Temel Bütünlük', aktif: false },
  { kod: '191_TERS_CALISMA', ad: '191 ters çalışma', aciklama: '191 İndirilecek KDV hesabının alacak çalıştığı satırları yakalar; KDV tahakkuk fişleri ayrıştırılamazsa gürültü üretebilir.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: '391_TERS_CALISMA', ad: '391 ters çalışma', aciklama: '391 Hesaplanan KDV hesabının borç çalıştığı satırları yakalar; KDV tahakkuk fişleri ayrıştırılamazsa gürültü üretebilir.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: 'KDV_ODENECEK_360_UYUMSUZ', ad: 'Ödenecek KDV 360 uyumsuz', aciklama: 'Basit 191/391 netleştirme sonucuna göre 360 aktarımını kontrol eder. Tevkifat ve devreden KDV nedeniyle varsayılan pasif.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: 'KDV_DEVREDEN_190_UYUMSUZ', ad: 'Devreden KDV 190 uyumsuz', aciklama: 'Basit 191/391 netleştirme sonucuna göre 190 aktarımını kontrol eder. Önceki dönem devreden ve tevkifatları modellemediği için varsayılan pasif.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: 'KDV_TAHAKKUK_MUKERRER', ad: 'KDV tahakkuk mükerrer', aciklama: 'Aynı ay içinde birden fazla KDV tahakkuk fişi sinyali varsa uyarır. Düzeltme fişleri nedeniyle varsayılan pasif.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: 'KDV_TAHAKKUK_AY_SONU_DEGIL', ad: 'KDV tahakkuk ay sonu değil', aciklama: 'KDV tahakkuk fişinin ay sonu dışında kesilmesini kontrol eder. Uygulama farklılıkları nedeniyle varsayılan pasif.', severity: 'INFO', grup: 'KDV', aktif: false },
  { kod: 'KDV_TAHAKKUK_191_TUTAR_UYUMSUZ', ad: '191 tahakkuk tutar uyumsuz', aciklama: 'Tahakkuk fişindeki 191 tutarı ile ay içi 191 hareketini karşılaştırır; iade/tevkifat/istisna ayrımı olmadığı için varsayılan pasif.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: 'KDV_TAHAKKUK_391_TUTAR_UYUMSUZ', ad: '391 tahakkuk tutar uyumsuz', aciklama: 'Tahakkuk fişindeki 391 tutarı ile ay içi 391 hareketini karşılaştırır; iade/tevkifat/istisna ayrımı olmadığı için varsayılan pasif.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: 'KDV_ORANI_OLAGAN_DISI', ad: 'KDV oranı olağan dışı', aciklama: 'Matrah/KDV oranı olağan sınırların dışındaysa uyarır. Karma oranlı belgeler nedeniyle varsayılan pasif.', severity: 'INFO', grup: 'KDV', aktif: false },
  { kod: 'KDV_MATRAH_KARSILIK_YOK', ad: 'KDV matrah karşılık yok', aciklama: 'KDV satırı var ama aynı fişte matrah hesabı bulunamazsa uyarır. Bazı toplu/mahsup fişleri nedeniyle varsayılan pasif.', severity: 'WARN', grup: 'KDV', aktif: false },
  { kod: 'MUKERRER_EVRAK_NO', ad: 'Evrak no mükerrer', aciklama: 'Aynı evrak numarasının birden fazla fişte geçmesini kontrol eder. Belge no formatları temiz değilse gürültü üretir.', severity: 'WARN', grup: 'Mükerrer Kayıt', aktif: false },
  { kod: 'FATURA_KARSILIK_HESAP_EKSIK', ad: 'Fatura karşılık hesap eksik', aciklama: 'Fatura kayıtlarında cari/kasa/banka karşılık hesabı aranır. Mahsup ve toplu fişler nedeniyle varsayılan pasif.', severity: 'WARN', grup: 'Belge', aktif: false },
  { kod: 'BELGE_TURU_DIGER_ACIKLAMA_EKSIK', ad: 'Belge türü diğer açıklama eksik', aciklama: 'Belge türü Diğer ise açıklama alanının yeterli olup olmadığını kontrol eder.', severity: 'INFO', grup: 'Belge', aktif: false },
  { kod: 'ANA_HESAPTA_KAYIT', ad: 'Ana hesapta kayıt', aciklama: 'Alt kırılım yerine 100/120/320 gibi ana hesapta kayıt olup olmadığını kontrol eder. Ofis hesap planı farkları nedeniyle varsayılan pasif.', severity: 'INFO', grup: 'Hesap Planı', aktif: false },
  { kod: 'YEVMIYE_NO_FORMAT_SUPHELI', ad: 'Yevmiye no format şüpheli', aciklama: 'Yevmiye numarası formatı olağan dışıysa uyarır. Luca rapor formatı değişiklikleri nedeniyle varsayılan pasif.', severity: 'INFO', grup: 'Yevmiye', aktif: false },
  { kod: 'TEK_FISTE_BIRDEN_COK_BELGE', ad: 'Tek fişte birden çok belge', aciklama: 'Aynı fişte birden fazla belge sinyali varsa uyarır. Toplu kayıt alışkanlıkları nedeniyle varsayılan pasif.', severity: 'INFO', grup: 'Belge', aktif: false },
  { kod: 'AYNI_FISTE_BELGE_ALANLARI_FARKLI', ad: 'Aynı fişte belge alanları farklı', aciklama: 'Aynı fişte belge tarihi/no/tür alanları tutarsızsa uyarır.', severity: 'INFO', grup: 'Belge', aktif: false },
  { kod: 'GELIR_HESABI_BORC_CALISMA', ad: 'Gelir hesabı borç çalışma', aciklama: '6xx gelir hesaplarının borç çalışmasını kontrol eder. İade/düzeltme fişleri nedeniyle varsayılan pasif.', severity: 'WARN', grup: 'Gelir / Gider', aktif: false },
  { kod: 'GIDER_HESABI_ALACAK_CALISMA', ad: 'Gider hesabı alacak çalışma', aciklama: '7xx gider hesaplarının alacak çalışmasını kontrol eder. İade/düzeltme fişleri nedeniyle varsayılan pasif.', severity: 'WARN', grup: 'Gelir / Gider', aktif: false },
  { kod: 'ORTAK_CARI_KASA_KULLANIMI', ad: 'Ortak cari/kasa kullanımı', aciklama: 'Ortak hesapları ile kasa/cari kapama riskini kontrol eder.', severity: 'INFO', grup: 'Ortak / Cari', aktif: false },
  { kod: 'AVANS_KASA_ORTAK_CARI_KAPAMA', ad: 'Avans-kasa-ortak kapama', aciklama: 'Avans, kasa ve ortak/cari hesapların aynı fişte kapanmasını riskli işlem olarak işaretler.', severity: 'INFO', grup: 'Avans', aktif: false },
  { kod: 'CARI_KAPAMA_KARSILIK_KONTROL', ad: 'Cari kapama karşılık kontrolü', aciklama: 'Cari hesap kapamalarında karşılık hesabının kasa/banka/avans gibi uygun hesap olup olmadığını kontrol eder.', severity: 'INFO', grup: 'Cari Hesap', aktif: false },
  { kod: 'BORDRO_TAHAKKUK_HESAP_KONTROL', ad: 'Bordro hesap bacakları', aciklama: 'Bordro fişinde 335/360/361 hesaplarının birlikte bulunmasını kontrol eder. Hesap planı farkları nedeniyle varsayılan pasif.', severity: 'INFO', grup: 'Bordro / SGK', aktif: false },
  { kod: 'UCRET_SGK_TAHAKKUK_KONTROL', ad: 'Ücret SGK tahakkuk kontrolü', aciklama: 'Ücret/bordro sinyali varken SGK tahakkuk bacaklarını kontrol eder.', severity: 'WARN', grup: 'Bordro / SGK', aktif: false },
  { kod: 'AMORTISMAN_KAYDI_KONTROL', ad: 'Amortisman kayıt kontrolü', aciklama: 'Sabit kıymet hesabı varken amortisman kaydı aranır. Dönemsel farklılıklar nedeniyle varsayılan pasif.', severity: 'INFO', grup: 'Açılış / Kapanış', aktif: false },
  { kod: 'REESKONT_SIMETRI_KONTROL', ad: 'Reeskont simetri kontrolü', aciklama: 'Reeskont gelir/gider ve karşılık hesaplarının simetrisini kontrol eder.', severity: 'INFO', grup: 'Dönemsellik', aktif: false },
  { kod: 'DONEMSELLIK_GIDER_KONTROL', ad: 'Dönemsellik gider kontrolü', aciklama: 'Giderin ilgili döneme ait olup olmadığını açıklama ve tarih sinyallerinden kontrol eder.', severity: 'INFO', grup: 'Dönemsellik', aktif: false },
  { kod: 'MALIYET_YANSITMA_EKSIK_KONTROL', ad: 'Maliyet yansıtma eksik', aciklama: '7/A maliyet hesaplarında dönem sonu yansıtma fişi aranır. Ara dönemlerde varsayılan pasif.', severity: 'INFO', grup: 'Maliyet', aktif: false },
  { kod: 'ACILIS_FISI_TARIH_KONTROL', ad: 'Açılış fişi tarih kontrolü', aciklama: 'Açılış fişinin dönem başı tarihiyle uyumunu kontrol eder.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: false },
  { kod: 'KAPANIS_FISI_TARIH_KONTROL', ad: 'Kapanış fişi tarih kontrolü', aciklama: 'Kapanış fişinin dönem sonu tarihiyle uyumunu kontrol eder.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: false },
  { kod: 'KASA_30000_TEVSIK_RISKI', ad: 'Eski kasa günlük tevsik', aciklama: 'Eski günlük toplam yaklaşımıdır; hareket bazlı yeni tevsik kontrolleri geldiği için varsayılan pasif.', severity: 'WARN', grup: 'Tevsik', aktif: false },
];

const TUM_KURALLAR: KuralDef[] = [...STANDART_KURALLAR, ...EK_KAPALI_KURALLAR];

function KurallarTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: ruleSettings } = useQuery({
    queryKey: ['edefter-rule-settings'],
    queryFn: () => edefterControlApi.getRuleSettings(),
  });

  const settingMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of ruleSettings?.settings || []) map.set(row.code, row.active);
    return map;
  }, [ruleSettings]);

  // Aktif/pasif: önce tenant ayarı; yoksa backend'in GERÇEK varsayılanı (defaultDisabledCodes) —
  //   katalogdaki statik `aktif` bayrağı bayatlamasın diye (backend bir kuralı açtığında ekran da görsün).
  const defaultDisabled = useMemo(() => new Set(ruleSettings?.defaultDisabledCodes || []), [ruleSettings]);
  const ruleActive = (k: KuralDef) =>
    settingMap.has(k.kod) ? Boolean(settingMap.get(k.kod)) : (ruleSettings ? !defaultDisabled.has(k.kod) : k.aktif);

  const ruleMut = useMutation({
    mutationFn: ({ code, active }: { code: string; active: boolean }) => edefterControlApi.setRuleActive(code, active),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['edefter-rule-settings'] });
      toast.success(`${vars.code} ${vars.active ? 'aktif' : 'pasif'} yapıldı. Mevcut oturum için Yeniden Analiz çalıştırın.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Kural ayarı kaydedilemedi'),
  });

  // Sunucu katalogu (150 kural: eski motor + hesap davranış motoru) varsa onu kullan; yoksa yerel yedek liste.
  //   Manuel (ofis) kuralları katalogda da gelir ama burada ayrı bileşende yönetilir (ManuelKurallar).
  const sunucuKatalog = ((ruleSettings?.catalog || []) as KuralTanimi[]).filter((k) => k.motor !== 'MANUEL');
  const manuelSayisi = ((ruleSettings?.catalog || []) as KuralTanimi[]).filter((k) => k.motor === 'MANUEL').length;
  const kuralListesi: KuralDef[] = sunucuKatalog.length
    ? [...sunucuKatalog]
        .sort((a, b) => alanSira(a.alan) - alanSira(b.alan))
        .map((k) => ({ kod: k.kod, ad: k.ad, aciklama: k.oneri ? `${k.aciklama} → ${k.oneri}` : k.aciklama, severity: k.siddet, grup: k.alan, aktif: k.varsayilanAktif }))
    : TUM_KURALLAR;
  const q = search.trim().toLocaleLowerCase('tr-TR');
  const filtered = kuralListesi.filter((k) => !q || `${k.kod} ${k.ad} ${k.aciklama} ${k.grup}`.toLocaleLowerCase('tr-TR').includes(q));
  const byGroup = new Map<string, KuralDef[]>();
  for (const k of filtered) { if (!byGroup.has(k.grup)) byGroup.set(k.grup, []); byGroup.get(k.grup)!.push(k); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-10 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[280px]" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' })}>
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kural ara..." className="bg-transparent outline-none text-sm w-full" style={portalStyle({ color: TEXT })} />
        </div>
        <span className="text-xs tabular-nums" style={portalStyle({ color: MUTED })}>{kuralListesi.length} standart · {manuelSayisi} ofis kuralı</span>
      </div>

      {/* Ofis (manuel) kuralları — sunucuda saklanır, analizde çalışır */}
      <ManuelKurallar />

      <div className="space-y-3">
        {[...byGroup.entries()].map(([grupAd, kurallar]) => (
          <div key={grupAd} className="rounded-xl overflow-hidden" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}` })}>
            <div className="ed-rule-heading px-4 py-2.5" style={portalStyle({ background: PANEL_HOVER, borderBottom: `1px solid ${BORDER}` })}>
              <span className="text-xs font-bold uppercase tracking-wider" style={portalStyle({ color: 'rgba(250,250,249,.85)' })}>{grupAd}</span>
              <span className="text-xs tabular-nums ml-2" style={portalStyle({ color: MUTED })}>{kurallar.length}</span>
            </div>
            <div className="divide-y" style={portalStyle({ borderColor: BORDER })}>
              {kurallar.map((k) => {
                const active = ruleActive(k);
                return (
                <div key={k.kod} className="px-4 py-3 flex items-start gap-3" style={portalStyle({ borderColor: BORDER })}>
                  <Severity value={k.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold" style={portalStyle({ color: TEXT })}>{k.ad}</span>
                      <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-mono" style={portalStyle({ background: 'rgba(255,255,255,.04)', color: MUTED2 })}>{k.kod}</span>
                    </div>
                    <div className="text-xs" style={portalStyle({ color: 'rgba(250,250,249,.65)' })}>{k.aciklama}</div>
                  </div>
                  <button
                    disabled={ruleMut.isPending}
                    onClick={() => ruleMut.mutate({ code: k.kod, active: !active })}
                    className="h-8 px-3 rounded-md text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    style={portalStyle({
                      background: active ? 'rgba(92,191,138,.12)' : 'rgba(226,112,111,.10)',
                      color: active ? OK : ERR,
                      border: `1px solid ${active ? 'rgba(92,191,138,.24)' : 'rgba(226,112,111,.22)'}`,
                    })}
                    title={active ? 'Bu kuralı pasif yap' : 'Bu kuralı aktif yap'}
                  >
                    {active ? <CheckCircle2 size={13} /> : <EyeOff size={13} />}
                    {active ? 'AKTİF' : 'PASİF'}
                  </button>
                </div>
              );})}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
