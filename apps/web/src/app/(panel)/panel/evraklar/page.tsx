'use client';
import './beyaz-inceleme.css';
import { portalStyle, portalPaint } from '@/lib/portal-theme';


import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Folder, FileText, Bot, HardDrive, Receipt, FileSignature, Mailbox, Landmark, ClipboardList } from 'lucide-react';

const GOLD = '#d4b876';

/**
 * 2026-09-25 (portal denetimi bulgu 35b) — ALANLAR ARTIK ŞEMAYLA AYNI.
 *   Eskiden `name`, `fileName`, `documentType`, `size`, `ocrCompleted` okunuyordu;
 *   BUNLARIN HİÇBİRİ şemada yok. Sonuç: her kart "Belge" yazıyordu, arama başlıkta
 *   hiç çalışmıyordu, "OCR edilmiş" sayacı hep %0 çıkıyordu ve OCR süzgeci
 *   seçildiğinde liste HER ZAMAN boş kalıyordu. Gerçek alanlar: title, sizeBytes.
 */
type DocumentItem = {
  id: string;
  title: string;
  category?: string;
  sizeBytes?: number;
  taxpayer?: { id: string; companyName?: string; firstName?: string; lastName?: string };
  createdAt?: string;
};

type Ozet = {
  toplam: number;
  buAy: number;
  toplamBoyut: number;
  kategoriDagilimi: Record<string, number>;
};

/** Şema kategorileri → ekranda görünen ad. Kutucuklar artık GERÇEK kategorilerden. */
const KATEGORI_ADI: Record<string, string> = {
  FATURA: 'Fatura',
  SOZLESME: 'Sözleşme',
  BEYANNAME: 'Beyanname',
  EVRAK: 'Evrak',
  DIGER: 'Diğer',
};
const KATEGORILER = ['FATURA', 'SOZLESME', 'BEYANNAME', 'EVRAK', 'DIGER'] as const;
/**
 * Sunucu sözleşmesi yalnız 25/50/100 kabul ediyor (`sayfaBoyutuNormalize`); başka bir
 * değer sessizce 50'ye çekiliyor. Burada 24 yazılıydı: istek 24 gidiyor, sunucu 50 satır
 * dönüyor, ekran ise sayfa sayısını 24'e göre hesaplıyordu — son sayfa BOŞ çıkıyordu
 * (canlı doğrulama: 90.215 belgede "sayfa 3759 → 0 satır"). Geçerli bir değer kullanılır
 * ve sayfa hesabı HER ZAMAN sunucunun döndürdüğü `pageSize` ile yapılır.
 */
const SAYFA_BOYUTU = 25;

function getIcon(type?: string) {
  const t = (type || '').toLowerCase();
  if (t.includes('fatur')) return Receipt;
  if (t.includes('sozles')) return FileSignature;
  if (t.includes('tebligat')) return Mailbox;
  if (t.includes('banka')) return Landmark;
  if (t.includes('muhasebe') || t.includes('rapor')) return ClipboardList;
  return FileText;
}
function getTypeTag(type?: string): string {
  const t = (type || '').toLowerCase();
  if (t.includes('fatur')) return 'Fatura';
  if (t.includes('sozles')) return 'Sözleşme';
  if (t.includes('tebligat')) return 'Tebligat';
  if (t.includes('banka')) return 'Banka';
  if (t.includes('muhasebe')) return 'Muhasebe';
  return type || 'Diğer';
}
function fmtBytes(b?: number): string {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}
function getTaxpayerName(d: DocumentItem): string {
  const t = d.taxpayer;
  if (!t) return '—';
  return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
}

export default function EvraklarPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [sayfa, setSayfa] = useState(1);

  /**
   * 2026-09-25 (bulgu 35b) — SÜZME VE SAYAÇLAR ARTIK SUNUCUDA.
   *   Eskiden uç ilk 100 satırı getiriyor, ekran süzmeyi ve sayaçları o 100 satır
   *   üzerinde yapıyordu. CANLI ÖLÇÜM: silinmemiş belge sayısı 90.215 — yani
   *   "Toplam Evrak: 100" yazıyordu (900 kat yanlış) ve 101. belge hiç görünmüyordu.
   */
  const kategoriParam = typeFilter.length ? typeFilter.join(',') : undefined;
  const aramaParam = search.trim() || undefined;

  const { data: liste, isLoading } = useQuery<{ rows: DocumentItem[]; total: number; page: number; pageSize: number }>({
    queryKey: ['documents', 'list', sayfa, kategoriParam, aramaParam],
    queryFn: () => api
      .get('/documents', { params: { page: sayfa, pageSize: SAYFA_BOYUTU, category: kategoriParam, search: aramaParam } })
      .then((r) => r.data)
      .catch(() => ({ rows: [], total: 0, page: 1, pageSize: SAYFA_BOYUTU })),
  });

  const { data: ozet } = useQuery<Ozet>({
    queryKey: ['documents', 'ozet', kategoriParam, aramaParam],
    queryFn: () => api
      .get('/documents/ozet', { params: { category: kategoriParam, search: aramaParam } })
      .then((r) => r.data)
      .catch(() => ({ toplam: 0, buAy: 0, toplamBoyut: 0, kategoriDagilimi: {} })),
  });

  const documents = liste?.rows ?? [];
  const toplam = ozet?.toplam ?? 0;
  // Sayfa hesabı SUNUCUNUN döndürdüğü boyutla — istenen değer normalize edilmiş olabilir.
  const boyut = liste?.pageSize || SAYFA_BOYUTU;
  const sonSayfa = Math.max(1, Math.ceil(toplam / boyut));
  const ilkSira = toplam === 0 ? 0 : (sayfa - 1) * boyut + 1;
  const sonSira = Math.min(sayfa * boyut, toplam);

  const toggleType = (t: string) => {
    setSayfa(1);
    setTypeFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  return (
    <div data-inceleme="evraklar" className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div data-inceleme-baslik className="flex items-end justify-between pb-5" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.05)' })}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={portalStyle({ background: GOLD })} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={portalStyle({ color: '#b8a06f' })}>Arşiv</span>
          </div>
          <h1 style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' })}>Evrak Yönetimi</h1>
          <p className="text-[13px] mt-1.5" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>Belge arşivi — ara, türe/OCR durumuna göre filtrele, görüntüle</p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {[
          // Sayaçlar `/documents/ozet`ten — süzgeç varsa süzülmüş kümeye göre.
          { label: 'Toplam Evrak', value: toplam, sub: typeFilter.length || aramaParam ? 'süzgeçe uyan' : 'tüm dönemler', icon: Folder },
          { label: 'Bu Ay', value: ozet?.buAy ?? 0, sub: new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }), icon: FileText },
          // OCR: `documents` tablosunda belge başına OCR durumu YOK. Eskiden hep %0
          //   yazıyordu; yanlış sayı göstermek yerine izlenmediğini söylüyoruz.
          { label: 'OCR Edilmiş', value: '—', sub: 'bu ekranda izlenmiyor', icon: Bot },
          { label: 'Depolama', value: (ozet?.toplamBoyut ?? 0) > 0 ? fmtBytes(ozet?.toplamBoyut) : '0 B', sub: 'kullanılan', icon: HardDrive },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div data-inceleme-sayac={label} key={label} className="rounded-2xl p-5" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' })}>
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={portalStyle({ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD })}><Icon size={17} /></div>
            </div>
            <p className="text-[11px] uppercase font-semibold tracking-[.12em]" style={portalStyle({ color: 'rgba(250,250,249,0.38)' })}>{label}</p>
            <p className="mt-1.5 leading-none tabular-nums" style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: typeof value === 'number' ? 34 : 28, fontWeight: 700, letterSpacing: '-0.03em', color: GOLD })}>{value}</p>
            <p className="text-[11px] mt-1" style={portalStyle({ color: 'rgba(250,250,249,0.32)' })}>{sub}</p>
          </div>
        ))}
      </div>

      {/* SEARCH + MAIN GRID */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })} />
        <input type="text" value={search} onChange={(e) => { setSayfa(1); setSearch(e.target.value); }} placeholder="Evrak başlığı veya mükellef ara..." className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none" style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' })} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        {/* DOC GRID */}
        <div>
          {isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>
              <div className="w-8 h-8 rounded-full animate-spin" style={portalStyle({ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD })} />
              <span className="text-sm">Yükleniyor...</span>
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-2xl py-16 text-center" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' })}>
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={portalStyle({ background: 'rgba(255,255,255,0.05)' })}>
                <Folder size={24} style={portalStyle({ color: 'rgba(250,250,249,0.35)' })} />
              </div>
              <p className="text-[14px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>
                {typeFilter.length || aramaParam ? 'Süzgeçe uyan evrak yok' : 'Henüz evrak yok'}
              </p>
              <p className="text-[11.5px] mt-1" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>
                {typeFilter.length || aramaParam ? 'Aramayı ya da tür seçimini değiştirin' : 'Evrak yükleyin'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {documents.map((d) => {
                  const Icon = getIcon(d.category);
                  const tag = KATEGORI_ADI[String(d.category || '')] || getTypeTag(d.category);
                  return (
                    <div data-inceleme-belge key={d.id} className="p-4 rounded-2xl transition-all cursor-pointer"
                      style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' })}
                      onMouseEnter={(e) => { e.currentTarget.style.background = portalPaint('rgba(184,160,111,0.05)', 'background'); e.currentTarget.style.borderColor = portalPaint('rgba(184,160,111,0.2)', 'borderColor'); }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = portalPaint('rgba(255,255,255,0.02)', 'background'); e.currentTarget.style.borderColor = portalPaint('rgba(255,255,255,0.05)', 'borderColor'); }}>
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={portalStyle({ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD })}>
                        <Icon size={20} />
                      </div>
                      <p className="text-[13px] font-semibold truncate" style={portalStyle({ color: '#fafaf9' })}>{d.title || 'Belge'}</p>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>
                        <span className="truncate">{getTaxpayerName(d)}</span>
                        <span>·</span>
                        <span className="tabular-nums">{fmtDate(d.createdAt)}</span>
                      </div>
                      <span className="inline-block mt-2 px-2 py-[2px] rounded-md text-[10px] font-semibold" style={portalStyle({ background: 'rgba(184,160,111,0.12)', color: GOLD })}>{tag}</span>
                    </div>
                  );
                })}
              </div>
              {/* SAYFALAMA — 2026-09-25 (bulgu 35b): 101. belge artık ERİŞİLEBİLİR. */}
              <div className="flex items-center justify-center gap-3 mt-4">
                <button type="button" disabled={sayfa <= 1} onClick={() => setSayfa((n) => Math.max(1, n - 1))}
                  className="px-3 py-1.5 rounded-[10px] text-[12px] font-semibold disabled:opacity-35 disabled:cursor-not-allowed"
                  style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' })}>
                  Önceki
                </button>
                <p className="text-[12px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>
                  {ilkSira}–{sonSira} / {toplam}
                  <span className="ml-2">(sayfa {sayfa}/{sonSayfa})</span>
                </p>
                <button type="button" disabled={sayfa >= sonSayfa} onClick={() => setSayfa((n) => Math.min(sonSayfa, n + 1))}
                  className="px-3 py-1.5 rounded-[10px] text-[12px] font-semibold disabled:opacity-35 disabled:cursor-not-allowed"
                  style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' })}>
                  Sonraki
                </button>
              </div>
            </>
          )}
        </div>

        {/* SIDEBAR FILTERS */}
        <div className="space-y-4">
          <div className="rounded-2xl p-4" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' })}>
            {/* 2026-09-25 (bulgu 35b): kutucuklar artık ŞEMADAKİ GERÇEK kategoriler.
                Eskiden "Tebligat", "Banka", "Muhasebe" yazıyordu; bu adlar hiçbir
                kategoriyle eşleşmediği için o üç süzgeç HİÇBİR ZAMAN sonuç vermiyordu.
                Sayılar da artık `/documents/ozet`ten (tüm veri), elindeki 100 satırdan değil. */}
            <p className="text-[11px] font-bold uppercase mb-3 tracking-[.12em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>Türe Göre Filtre</p>
            {KATEGORILER.map((k) => (
              <label key={k} className="flex items-center justify-between py-1.5 cursor-pointer">
                <span className="flex items-center gap-2 text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.75)' })}>
                  <input type="checkbox" checked={typeFilter.includes(k)} onChange={() => toggleType(k)} style={portalStyle({ accentColor: GOLD })} />
                  {KATEGORI_ADI[k]}
                </span>
                <span className="text-[11px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>({ozet?.kategoriDagilimi?.[k] ?? 0})</span>
              </label>
            ))}
            {typeFilter.length > 0 && (
              <button type="button" onClick={() => { setSayfa(1); setTypeFilter([]); }}
                className="mt-2 text-[11.5px] font-semibold" style={portalStyle({ color: GOLD })}>
                Tür seçimini temizle
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
