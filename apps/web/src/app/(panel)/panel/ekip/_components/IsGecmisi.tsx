'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { isOmurgaYok, type Akis, type AkisFiltre, type AkisGun, type AkisSayaclari, type MukellefOzet, type Vaka } from '@/lib/ekip';
import { MukellefSecici } from './MukellefSecici';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { Avatar, Bos, Dugme, GOLD, KIRMIZI, MAVI, MUTED, OK, ROW_SEP, Rozet, TEXT, ajanRengi } from './Tema';
import { KUTULAR, ajanKisaAd, ajanKisaltma, tarihKisa, vakaSirasi } from './ortak';

/** Sayfa başına satır. */
const SAYFA = 8;

/** Yalnız İşler listesinde kullanılan sade süzgeç. */
function IsFiltresi({ aktif, onClick, children, sayi, dikkat = false }: { aktif: boolean; onClick: () => void; children: ReactNode; sayi?: number | null; dikkat?: boolean }) {
  return (
    <button type="button" aria-pressed={aktif} onClick={onClick}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] transition hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ color: aktif || dikkat ? GOLD : MUTED, border: `1px solid ${aktif ? `${GOLD}4d` : 'transparent'}`, background: aktif ? `${GOLD}14` : undefined }}>
      {children}
      {sayi != null && <span className="font-semibold tabular-nums" style={{ opacity: aktif || dikkat ? 1 : 0.7 }}>{sayi}</span>}
    </button>
  );
}

/** Durum rozeti (kutu + durum). */
export function vakaRozeti(v: Vaka, kosuyor: boolean): { ad: string; renk: string } {
  if (v.kutu === 'onay') return { ad: 'onay', renk: GOLD };
  if (v.kutu === 'istek') return { ad: 'karar', renk: GOLD };
  if (v.kutu === 'suruyor' || kosuyor) return { ad: 'sürüyor', renk: MAVI };
  if (v.durum === 'hata') return { ad: 'yarım', renk: KIRMIZI };
  if (v.kimde.ajanId === 'koordinator' && v.adimlar.filter((a) => a.tip === 'is').length === 1) return { ad: 'cevaplandı', renk: MUTED };
  return { ad: 'bitti', renk: OK };
}

/**
 * İşler listesi (İşler sekmesi, sol): süzgeç çipleri · gün · mükellef arama; satır = avatar · mükellef · konu · rozet · saat.
 * Tıklanan iş sağdaki panelde açılır. 8'er 8'er "Daha fazla göster".
 */
export function IsGecmisi({ akis, isLoading, error, sayaclar, suzgec, onSuzgec, gun, onGun, taxpayerId, onTaxpayerId, mukellefler, seciliVakaId, onSec, ajanAd }: {
  akis: Akis | undefined;
  isLoading: boolean;
  error: unknown;
  sayaclar: AkisSayaclari | undefined;
  suzgec: AkisFiltre;
  onSuzgec: (f: AkisFiltre) => void;
  gun: AkisGun;
  onGun: (g: AkisGun) => void;
  taxpayerId: string;
  onTaxpayerId: (id: string) => void;
  mukellefler: MukellefOzet[];
  seciliVakaId: string | null;
  onSec: (v: Vaka) => void;
  ajanAd: (id: string) => string;
}) {
  const qc = useQueryClient();
  const yenileniyor = useIsFetching({ queryKey: ['ekip-akis'] }) > 0;
  const vakalar = useMemo(() => [...(akis?.vakalar || [])].sort(vakaSirasi), [akis?.vakalar]);
  const omurgaYok = isOmurgaYok(error);
  const toplam = sayaclar ? sayaclar.suruyor + sayaclar.onay + sayaclar.istek + sayaclar.bitti : vakalar.length;
  const bittiN = vakalar.filter((v) => v.kutu === 'bitti' && v.durum !== 'hata').length;
  const hataN = vakalar.filter((v) => v.durum === 'hata').length;
  const [gorunen, setGorunen] = useState(SAYFA);
  useEffect(() => setGorunen(SAYFA), [suzgec, gun, taxpayerId]);
  useEffect(() => {
    if (!seciliVakaId) return;
    const i = vakalar.findIndex((v) => v.vakaId === seciliVakaId);
    if (i >= 0 && i >= gorunen) setGorunen(Math.ceil((i + 1) / SAYFA) * SAYFA);
  }, [seciliVakaId, vakalar, gorunen]);
  const liste = vakalar.slice(0, gorunen);

  return (
    <section aria-label="İşler" className="relative min-w-0 rounded-[18px] px-4 pb-5 pt-[18px] sm:px-6"
      style={{ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.065)', boxShadow: '0 18px 44px rgba(0,0,0,0.24)' }}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}73, transparent)` }} />
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold" style={{ color: TEXT }}>İşler</h3>
          <p className="mt-1 text-[11.5px]" style={{ color: MUTED }}>
            {akis ? `${gun === 1 ? 'Bugün' : `Son ${gun} gün`} · ${vakalar.length} iş · ${bittiN} bitti${hataN ? ` · ${hataN} yarım` : ''}` : 'Verilen görevler'}
          </p>
        </div>
        <Dugme tur="sade" onClick={() => qc.invalidateQueries({ queryKey: ['ekip-akis'] })}>
          <RefreshCw size={12} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
        </Dugme>
      </header>
      {/* Süzgeçler */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="İş durumu">
          {KUTULAR.map((k) => {
            const sayi = k.id === 'tumu' ? toplam : k.sayacAnahtari ? sayaclar?.[k.sayacAnahtari] ?? 0 : null;
            const dikkat = (k.id === 'onay' || k.id === 'istek') && !!sayi;
            return (
              <IsFiltresi key={k.id} aktif={suzgec === k.id} onClick={() => onSuzgec(k.id)} sayi={sayi} dikkat={dikkat}>
                {k.id === 'onay' ? 'Onay' : k.id === 'istek' ? 'Sizden istenen' : k.ad}
              </IsFiltresi>
            );
          })}
          {!!sayaclar?.gecikti && <Rozet metin={`${sayaclar.gecikti} gecikti`} renk={KIRMIZI} />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([1, 7, 30] as AkisGun[]).map((g) => (
            <IsFiltresi key={g} aktif={gun === g} onClick={() => onGun(g)}>
              {g === 1 ? 'Bugün' : `${g} gün`}
            </IsFiltresi>
          ))}
          <span className="inline-flex h-8 min-w-[150px] flex-1 items-center gap-2 rounded-[10px] px-3 text-[12px]" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${ROW_SEP}` }}>
            <Search size={12} style={{ color: MUTED }} />
            <span className="min-w-0 flex-1">
              <MukellefSecici sade yerTutucu="Mükellef ara…" mukellefler={mukellefler} value={taxpayerId} onChange={onTaxpayerId} renk={GOLD} />
            </span>
          </span>
        </div>
      </div>

      {/* Satırlar */}
      <div className="mt-3">
        {omurgaYok ? (
          <OmurgaYokBilgi kucuk />
        ) : error ? (
          <div className="py-3 text-[12.5px]" style={{ color: KIRMIZI }}>
            Geçmiş alınamadı: {(error as any)?.message || 'hata'}
          </div>
        ) : isLoading && !akis ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px]" style={{ color: MUTED }}>
            <Loader2 size={13} className="animate-spin" /> Geçmiş yükleniyor…
          </div>
        ) : !vakalar.length ? (
          <Bos metin={suzgec === 'tumu' ? 'Bu pencerede iş yok.' : 'Bu kutuda iş yok.'} />
        ) : (
          liste.map((v, i) => {
            const secili = seciliVakaId === v.vakaId;
            const siz = v.kimde.ajanId === 'siz';
            const kosuyor = v.adimlar.some((a) => a.tip === 'is' && a.durum === 'running');
            const r = vakaRozeti(v, kosuyor);
            const isAdimlari = v.adimlar.filter((a) => a.tip === 'is') as Array<{ ajanId: string }>;
            const sonPersonel = [...isAdimlari].reverse().find((a) => a.ajanId !== 'koordinator');
            const personelId = siz ? sonPersonel?.ajanId || 'koordinator' : v.kimde.ajanId;
            return (
              <button
                key={v.vakaId}
                type="button"
                onClick={() => onSec(v)}
                aria-current={secili}
                title="İşi sağdaki panelde aç"
                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition hover:bg-white/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  borderTop: i ? `1px solid ${ROW_SEP}` : undefined,
                  ...(secili ? { background: `${GOLD}0f`, boxShadow: `inset 3px 0 0 ${GOLD}` } : {}),
                }}
              >
                <Avatar kisaltma={ajanKisaltma(personelId)} renk={ajanRengi(personelId)} ton={kosuyor ? 'mavi' : personelId === 'koordinator' ? 'gold' : 'gri'} boyut={28} nabiz={kosuyor} title={ajanKisaAd(personelId, ajanAd(personelId))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold" style={{ color: TEXT }} title={v.mukellef?.ad || 'Ofis geneli'}>
                    {v.mukellef?.ad || 'Ofis geneli'}
                  </span>
                  <span className="block truncate text-[11.5px]" style={{ color: MUTED }} title={v.konu}>
                    {v.konu || 'Konu yok'}
                    {siz ? ' · sizde' : ''}
                    {!v.kuru ? <span style={{ color: KIRMIZI }}> · canlı</span> : ''}
                    {v.gecikti ? <span style={{ color: KIRMIZI }}> · gecikti</span> : ''}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px]" style={{ color: r.renk }}>
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${kosuyor ? 'animate-pulse' : ''}`} style={{ background: r.renk }} />
                  {r.ad}
                </span>
                <span className="w-10 flex-shrink-0 text-right text-[11px] tabular-nums" style={{ color: MUTED }}>
                  {tarihKisa(v.olusturuldu)}
                </span>
              </button>
            );
          })
        )}
        {vakalar.length > gorunen && (
          <div className="pt-2" style={{ borderTop: `1px solid ${ROW_SEP}` }}>
            <Dugme tur="sade" onClick={() => setGorunen((g) => g + SAYFA)} className="w-full justify-center">
              <ChevronDown size={12} /> Daha fazla göster ({vakalar.length - gorunen} iş daha)
            </Dugme>
          </div>
        )}
      </div>
    </section>
  );
}
