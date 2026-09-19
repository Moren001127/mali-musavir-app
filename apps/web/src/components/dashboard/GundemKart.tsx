'use client';
import { portalStyle } from '@/lib/portal-theme';
import './dashboard-white.css';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Home, Landmark, Loader2, RefreshCw, ScrollText, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * BAŞVURU SAYILARI (eski adıyla Günün Gündemi) — dar sağ sütun.
 * Müşavirin gün içinde defalarca baktığı sayılar tek yerde:
 *   1) TCMB kuru + gram altın (BIST kaldırıldı — iş değeri yok)
 *   2) TÜFE + kira artış tavanı
 *   3) Sabit parametreler: gecikme zammı, tecil faizi, yeniden değerleme,
 *      asgari ücret, SGK tavanı, kıdem tavanı, yemek istisnası (kaynak+tarihli)
 *   4) Resmî Gazete: YALNIZ eşleşme varsa satır açar; boşken tek satır dipnot
 * Renk düzeni Bugünün İş Listesi kartıyla aynı aile (mint #8fd7bd + altın #d8bd86).
 */

type Kur = { kod: string; isim: string; alis: number | null; satis: number | null; degisimYuzde: number | null };
type Piyasa = { kod: string; isim: string; deger: number | null; birim: string; degisimYuzde: number | null; ondalik: number };
type Mevzuat = { baslik: string; url: string; neden: string; onem: 'yuksek' | 'orta' };
type Enflasyon = { donem: string; aylik: number | null; yillik: number | null; kiraArtisTavani: number | null; yilbasindan: number | null; kaynakUrl: string };
type Sabit = { kod: string; etiket: string; deger: string; alt?: string; gecerlilik: string; kaynakUrl: string };
type GundemData = {
  tarih: string;
  kurTarihi: string | null;
  kurlar: Kur[];
  piyasa: Piyasa[];
  enflasyon: Enflasyon | null;
  sabitler?: Sabit[];
  mevzuat: Mevzuat[];
  mevzuatToplam: number;
  mevzuatHazirlaniyor: boolean;
  uyarilar: string[];
  uretimZamani: string;
  onbellekten: boolean;
};

const MINT = '#8fd7bd';
const GOLD = '#d8bd86';
const GIZLI_PIYASA = new Set(['BİST 100', 'BIST 100', 'XU100']);

const fmtKur = (n: number | null) => (n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }));
const fmtPiyasa = (n: number | null, ondalik: number) => (n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik }));

function Degisim({ yuzde, kurMu }: { yuzde: number | null; kurMu: boolean }) {
  if (yuzde == null) return null;
  const arti = yuzde > 0, eksi = yuzde < 0;
  // Kurda yükseliş maliyet artışı → kırmızı; altında piyasa yönü → yükseliş yeşil.
  const renk = kurMu ? (arti ? '#ef8a8a' : eksi ? MINT : 'rgba(250,250,249,0.55)') : (arti ? MINT : eksi ? '#ef8a8a' : 'rgba(250,250,249,0.55)');
  return (
    <span className="text-[10.5px] font-semibold tabular-nums inline-flex items-center gap-0.5" style={portalStyle({ color: renk })}>
      {arti ? <TrendingUp size={10} /> : eksi ? <TrendingDown size={10} /> : null}%{Math.abs(yuzde).toFixed(2)}
    </span>
  );
}

function Bolum({ baslik, sag, children }: { baslik: string; sag?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={portalStyle({ background: 'rgba(255,255,255,0.016)', border: '1px solid rgba(143,215,189,0.10)' })}>
      <div data-dashboard-band="neutral" className="flex items-center justify-between gap-2 px-3.5 py-2">
        <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={portalStyle({ color: 'rgba(221,246,238,0.62)' })}>{baslik}</span>
        {sag}
      </div>
      {children}
    </div>
  );
}

const SATIR_KENAR = { borderTop: '1px solid rgba(255,255,255,0.055)' } as const;

export function GundemKart() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery<GundemData>({
    queryKey: ['gundem'],
    queryFn: () => api.get('/gundem').then((r) => r.data),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Resmî Gazete taraması sunucuda arkada sürerken kısa aralıkla sor; bitince dur.
    refetchInterval: (q) => (q.state.data?.mevzuatHazirlaniyor ? 15000 : false),
  });

  const handleRefresh = async () => {
    const r = await api.get('/gundem?force=1').then((res) => res.data);
    qc.setQueryData(['gundem'], r);
  };

  const piyasa = (data?.piyasa ?? []).filter((p) => !GIZLI_PIYASA.has(p.kod));
  const mevzuat = data?.mevzuat ?? [];

  return (
    <div
      data-dashboard-surface data-dashboard-root className="rounded-2xl overflow-hidden relative h-full"
      style={portalStyle({
        background:
          'radial-gradient(circle at 7% 0%, rgba(216,189,134,0.10), transparent 34%), radial-gradient(circle at 95% 10%, rgba(143,215,189,0.08), transparent 31%), linear-gradient(180deg, rgba(12,12,10,0.96), rgba(6,6,5,0.94))',
        border: '1px solid rgba(216,189,134,0.16)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)',
      })}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(216,189,134,0.65), rgba(143,215,189,0.38), transparent)' }} />
      <div className="pointer-events-none absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ background: `linear-gradient(180deg, ${GOLD}, ${MINT})`, boxShadow: '0 0 18px rgba(216,189,134,0.22)' }} />

      {/* Başlık */}
      <div data-dashboard-band="peach" className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 flex-wrap" style={portalStyle({ borderBottom: '1px solid rgba(216,189,134,0.10)' })}>
        <div className="flex items-center gap-2 min-w-0">
          <ScrollText size={14} style={portalStyle({ color: GOLD })} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={portalStyle({ color: 'rgba(244,236,220,0.75)' })}>Başvuru Sayıları</span>
        </div>
        <div className="flex items-center gap-2">
          {data?.kurTarihi && (
            <span className="text-[10.5px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })} title="TCMB kur tarihi">{data.kurTarihi}</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            title="Kur ve Resmî Gazete'yi yeniden çek"
            className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50"
            style={portalStyle({ background: 'rgba(216,189,134,0.06)', border: '1px solid rgba(216,189,134,0.16)', color: 'rgba(244,236,220,0.75)' })}
          >
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Yenile
          </button>
        </div>
      </div>

      <div className="px-4 pt-3 pb-4 space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-[13px] py-1" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
            <Loader2 size={13} className="animate-spin" /> Sayılar hazırlanıyor…
          </div>
        )}

        {/* Kur + altın — tek tablo */}
        {!isLoading && (data?.kurlar?.length || piyasa.length) ? (
          <Bolum baslik="Kur · Altın" sag={<span className="text-[10px]" style={portalStyle({ color: 'rgba(250,250,249,0.38)' })}>TCMB satış</span>}>
            {(data?.kurlar ?? []).map((k) => (
              <div key={k.kod} className="flex items-center gap-2 px-3.5 py-1.5" style={portalStyle(SATIR_KENAR)}>
                <span className="w-9 text-[10px] font-black tracking-wider" style={portalStyle({ color: GOLD })}>{k.kod}</span>
                <span className="flex-1 text-[13.5px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.9)' })}>{fmtKur(k.satis)}</span>
                <Degisim yuzde={k.degisimYuzde} kurMu />
              </div>
            ))}
            {piyasa.map((p) => (
              <div key={p.kod} className="flex items-center gap-2 px-3.5 py-1.5" style={portalStyle(SATIR_KENAR)} title={p.isim}>
                <span className="w-9 text-[10px] font-black tracking-wider" style={portalStyle({ color: GOLD })}>ALTIN</span>
                <span className="flex-1 text-[13.5px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.9)' })}>
                  {fmtPiyasa(p.deger, p.ondalik)}
                  {p.birim && <span className="text-[10px] font-semibold ml-1" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>{p.birim}</span>}
                </span>
                <Degisim yuzde={p.degisimYuzde} kurMu={false} />
              </div>
            ))}
          </Bolum>
        ) : null}

        {/* TÜFE + kira tavanı */}
        {data?.enflasyon && (
          <Bolum
            baslik={`TÜFE · ${data.enflasyon.donem}`}
            sag={
              <a href={data.enflasyon.kaynakUrl} target="_blank" rel="noopener noreferrer" title="TÜİK bültenini aç" className="opacity-40 hover:opacity-90 transition">
                <ExternalLink size={11} style={portalStyle({ color: GOLD })} />
              </a>
            }
          >
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap px-3.5 py-2" style={portalStyle(SATIR_KENAR)}>
              {data.enflasyon.aylik != null && (
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="text-[10.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>Aylık</span>
                  <span className="text-[13px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.88)' })}>%{data.enflasyon.aylik.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </span>
              )}
              {data.enflasyon.yillik != null && (
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="text-[10.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>Yıllık</span>
                  <span className="text-[13px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.88)' })}>%{data.enflasyon.yillik.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </span>
              )}
            </div>
            {data.enflasyon.kiraArtisTavani != null && (
              <div className="flex items-center gap-2 px-3.5 py-2" style={portalStyle({ ...SATIR_KENAR, background: 'rgba(216,189,134,0.05)' })}>
                <Home size={11} style={portalStyle({ color: GOLD })} />
                <span className="flex-1 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.7)' })}>Kira artış tavanı</span>
                <span className="text-[14px] font-bold tabular-nums" style={portalStyle({ color: GOLD })}>%{data.enflasyon.kiraArtisTavani.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
          </Bolum>
        )}

        {/* Sabit parametreler */}
        {!!data?.sabitler?.length && (
          <Bolum baslik="Oran ve Tutarlar" sag={<span className="text-[10px]" style={portalStyle({ color: 'rgba(250,250,249,0.38)' })}>kaynak için tıkla</span>}>
            {data.sabitler.map((s) => (
              <a
                key={s.kod}
                href={s.kaynakUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`${s.gecerlilik} — kaynağı aç`}
                className="group flex items-center gap-2 px-3.5 py-1.5 transition hover:bg-white/[0.03]"
                style={portalStyle(SATIR_KENAR)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold leading-tight" style={portalStyle({ color: 'rgba(250,250,249,0.86)' })}>{s.etiket}</span>
                  <span className="block truncate text-[10.5px] mt-0.5" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>{s.alt ? `${s.alt} · ` : ''}{s.gecerlilik}</span>
                </span>
                <span className="shrink-0 text-[13.5px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.92)' })}>{s.deger}</span>
                <ExternalLink size={11} className="shrink-0 opacity-25 transition group-hover:opacity-90" style={portalStyle({ color: GOLD })} />
              </a>
            ))}
          </Bolum>
        )}

        {/* Resmî Gazete — yalnız eşleşme varsa satır açar */}
        {mevzuat.length > 0 && (
          <Bolum baslik="Resmî Gazete · Bugün">
            {mevzuat.map((m, i) => {
              const yuksek = m.onem === 'yuksek';
              return (
                <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2.5 px-3.5 py-2 transition hover:bg-white/[0.03]" style={portalStyle(SATIR_KENAR)}>
                  <span className="mt-[6px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: yuksek ? GOLD : MINT }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold leading-snug" style={portalStyle({ color: 'rgba(250,250,249,0.9)' })}>{m.baslik}</span>
                    {m.neden && <span className="block mt-0.5 text-[11px] leading-snug" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>{m.neden}</span>}
                  </span>
                  <ExternalLink size={12} className="shrink-0 mt-1 opacity-40 transition group-hover:opacity-90" style={portalStyle({ color: yuksek ? GOLD : MINT })} />
                </a>
              );
            })}
          </Bolum>
        )}

        {/* Dipnot: tarama durumu + kaynak uyarıları */}
        {!isLoading && data && (
          <p className="flex items-center gap-1.5 text-[10.5px] px-1" style={portalStyle({ color: 'rgba(250,250,249,0.38)' })}>
            {data.mevzuatHazirlaniyor ? (
              <><Loader2 size={10} className="animate-spin" style={portalStyle({ color: MINT })} /> Resmî Gazete taranıyor…</>
            ) : mevzuat.length === 0 ? (
              <><Landmark size={10} style={portalStyle({ color: MINT })} /> Resmî Gazete: ilgili yayın yok{data.mevzuatToplam ? ` · ${data.mevzuatToplam} madde tarandı` : ''}</>
            ) : null}
            {!!data.uyarilar?.length && <span> · {data.uyarilar.join(' · ')}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
