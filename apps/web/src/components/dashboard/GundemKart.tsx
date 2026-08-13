'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Landmark, Loader2, RefreshCw, ScrollText, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * GÜNÜN GÜNDEMİ — brifingin dış-dünya tamamlayıcısı.
 * Resmî Gazete'de bugün mali müşavirliği ilgilendiren maddeler (AI süzgeçli) + TCMB kuru.
 * Renk düzeni Bugünkü Brifing kartıyla BİREBİR aynı (mint #8fd7bd + altın #d8bd86).
 */

type Kur = { kod: string; isim: string; alis: number | null; satis: number | null; degisimYuzde: number | null };
type Mevzuat = { baslik: string; url: string; neden: string; onem: 'yuksek' | 'orta' };
type GundemData = {
  tarih: string;
  kurTarihi: string | null;
  kurlar: Kur[];
  mevzuat: Mevzuat[];
  mevzuatToplam: number;
  uyarilar: string[];
  uretimZamani: string;
  onbellekten: boolean;
};

const MINT = '#8fd7bd';
const GOLD = '#d8bd86';

const fmtKur = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function GundemKart() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery<GundemData>({
    queryKey: ['gundem'],
    queryFn: () => api.get('/gundem').then((r) => r.data),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const handleRefresh = async () => {
    const r = await api.get('/gundem?force=1').then((res) => res.data);
    qc.setQueryData(['gundem'], r);
  };

  return (
    <div
      className="rounded-2xl overflow-hidden relative"
      style={{
        background:
          'radial-gradient(circle at 7% 0%, rgba(143,215,189,0.11), transparent 34%), radial-gradient(circle at 95% 10%, rgba(216,189,134,0.08), transparent 31%), linear-gradient(180deg, rgba(8,14,13,0.96), rgba(5,7,7,0.94))',
        border: '1px solid rgba(143,215,189,0.14)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(143,215,189,0.65), rgba(216,189,134,0.38), transparent)' }}
      />
      <div
        className="pointer-events-none absolute inset-y-5 left-0 w-[3px] rounded-r-full"
        style={{ background: `linear-gradient(180deg, ${MINT}, ${GOLD})`, boxShadow: '0 0 18px rgba(143,215,189,0.22)' }}
      />

      {/* Başlık */}
      <div
        className="px-5 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap"
        style={{ borderBottom: '1px solid rgba(143,215,189,0.08)' }}
      >
        <div className="flex items-center gap-2.5">
          <ScrollText size={14} style={{ color: MINT }} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: 'rgba(221,246,238,0.72)' }}>
            Günün Gündemi
          </span>
          <span
            className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md inline-flex items-center gap-1"
            style={{ background: 'rgba(216,189,134,0.075)', color: '#d8c38f', border: '1px solid rgba(216,189,134,0.18)' }}
          >
            Resmî Gazete · TCMB
          </span>
        </div>
        <div className="flex items-center gap-2">
          {data?.kurTarihi && (
            <span className="text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>
              {data.onbellekten ? '↻' : '✓'} {data.kurTarihi}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            title="Gündemi yeniden çek"
            className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50"
            style={{ background: 'rgba(143,215,189,0.055)', border: '1px solid rgba(143,215,189,0.14)', color: 'rgba(221,246,238,0.72)' }}
          >
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Yenile
          </button>
        </div>
      </div>

      {/* Kurlar */}
      <div className="px-5 pt-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-[13px] py-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={13} className="animate-spin" /> Gündem hazırlanıyor…
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(data?.kurlar ?? []).map((k) => {
              const arti = (k.degisimYuzde ?? 0) > 0;
              const eksi = (k.degisimYuzde ?? 0) < 0;
              const renk = arti ? '#ef8a8a' : eksi ? MINT : 'rgba(250,250,249,0.55)';
              return (
                <div
                  key={k.kod}
                  className="rounded-lg px-3 py-2 flex items-center gap-2.5"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <span className="text-[10px] font-black tracking-wider" style={{ color: GOLD }}>{k.kod}</span>
                  <span className="text-[14px] font-bold tabular-nums" style={{ color: 'rgba(250,250,249,0.9)' }}>
                    {fmtKur(k.satis)}
                  </span>
                  {k.degisimYuzde != null && (
                    <span className="text-[11px] font-semibold tabular-nums inline-flex items-center gap-0.5" style={{ color: renk }}>
                      {arti ? <TrendingUp size={11} /> : eksi ? <TrendingDown size={11} /> : null}
                      %{Math.abs(k.degisimYuzde).toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mevzuat */}
      <div className="px-5 pt-3 pb-4">
        {!isLoading && (data?.mevzuat?.length ?? 0) === 0 && (
          <div
            className="rounded-xl px-4 py-3 text-[13px] flex items-center gap-2"
            style={{
              background: 'rgba(255,255,255,0.018)',
              border: '1px solid rgba(143,215,189,0.10)',
              boxShadow: 'inset 3px 0 0 rgba(143,215,189,0.45)',
              color: 'rgba(250,250,249,0.72)',
            }}
          >
            <Landmark size={13} style={{ color: MINT }} />
            Bugünkü Resmî Gazete'de mükellefleri ilgilendiren yayın yok
            {data?.mevzuatToplam ? (
              <span style={{ color: 'rgba(250,250,249,0.38)' }}> · {data.mevzuatToplam} madde tarandı</span>
            ) : null}
          </div>
        )}

        <div className="space-y-2">
          {(data?.mevzuat ?? []).map((m, i) => {
            const yuksek = m.onem === 'yuksek';
            const vurgu = yuksek ? GOLD : MINT;
            return (
              <a
                key={i}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-xl px-4 py-3 transition hover:brightness-110"
                style={{
                  background: yuksek
                    ? 'linear-gradient(90deg, rgba(216,189,134,0.075), rgba(255,255,255,0.018) 60%)'
                    : 'rgba(255,255,255,0.018)',
                  border: `1px solid ${yuksek ? 'rgba(216,189,134,0.20)' : 'rgba(143,215,189,0.10)'}`,
                  boxShadow: `inset 3px 0 0 ${vurgu}`,
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: vurgu }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold leading-snug" style={{ color: 'rgba(250,250,249,0.9)' }}>
                      {m.baslik}
                    </span>
                    {m.neden && (
                      <span className="block mt-1 text-[12px] leading-snug" style={{ color: 'rgba(250,250,249,0.5)' }}>
                        {m.neden}
                      </span>
                    )}
                  </span>
                  <ExternalLink
                    size={13}
                    className="shrink-0 mt-1 opacity-40 transition group-hover:opacity-90"
                    style={{ color: vurgu }}
                  />
                </div>
              </a>
            );
          })}
        </div>

        {!!data?.uyarilar?.length && (
          <p className="mt-2 text-[11px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
            {data.uyarilar.join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}
