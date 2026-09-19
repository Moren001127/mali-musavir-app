'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import { ALAN_IKON, DURUM_ETIKET, alanSira, type KontrolOzeti, type KuralDurumu, type KuralTanimi } from './katalog';
import { BORDER, GRAY, MUTED, MUTED2, OK, PANEL, TEXT, WARN, sevColor } from './tema';

// DENETİM KAPSAMI — "her kurala bakıldı mı?" kanıtı. Tek satır özet + açılır kontrol listesi (alan alan).
//   Durum renkleri: temiz yeşil · bulgu şiddet rengi · uygulanmaz/veri yok gri · kapalı soluk.
export function KapsamPaneli({ ozet, katalog, bulguSiddeti }: {
  ozet: KontrolOzeti | null | undefined;
  katalog: Map<string, KuralTanimi>;
  bulguSiddeti: Map<string, string>; // kod → en yüksek şiddet (açık bulgulardan)
}) {
  const [acik, setAcik] = useState(false);

  const alanlar = useMemo(() => {
    if (!ozet?.kapsam?.length) return [];
    const map = new Map<string, { alan: string; kurallar: Array<{ kod: string; ad: string; durum: KuralDurumu; bulgu: number; not?: string }> }>();
    for (const k of ozet.kapsam) {
      const tanim = katalog.get(k.kod);
      const alan = tanim?.alan || 'Diğer';
      if (!map.has(alan)) map.set(alan, { alan, kurallar: [] });
      map.get(alan)!.kurallar.push({ kod: k.kod, ad: tanim?.ad || k.kod, durum: k.durum, bulgu: k.bulgu, not: k.not });
    }
    const sira: Record<KuralDurumu, number> = { BULGU: 0, TEMIZ: 1, VERI_YOK: 2, UYGULANMAZ: 3, PASIF: 4 };
    return [...map.values()]
      .map((a) => ({ ...a, kurallar: a.kurallar.sort((x, y) => sira[x.durum] - sira[y.durum] || x.ad.localeCompare(y.ad, 'tr')) }))
      .sort((a, b) => alanSira(a.alan) - alanSira(b.alan));
  }, [ozet, katalog]);

  if (!ozet?.ozet) return null;
  const o = ozet.ozet;

  const durumRengi = (k: { kod: string; durum: KuralDurumu }) => {
    if (k.durum === 'TEMIZ') return OK;
    if (k.durum === 'BULGU') return sevColor(bulguSiddeti.get(k.kod) || katalog.get(k.kod)?.siddet || 'INFO');
    if (k.durum === 'PASIF') return 'rgba(250,250,249,.22)';
    return GRAY;
  };

  return (
    <div className="ed-scope rounded-2xl overflow-hidden relative" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}` })}>
      <div className="absolute inset-x-0 top-0 h-px" style={portalStyle({ background: `linear-gradient(90deg, transparent, ${OK}66, transparent)` })} />
      <button aria-expanded={acik} onClick={() => setAcik((v) => !v)} className="w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-bold" style={portalStyle({ color: TEXT })}>
          <ListChecks size={15} style={portalStyle({ color: OK })} /> Denetim kapsamı
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums" style={portalStyle({ background: 'rgba(92,191,138,.12)', color: OK })}>{o.calisti} / {o.kural} kontrol çalıştı</span>
        </span>
        <span className="inline-flex items-center gap-3 text-[11.5px] tabular-nums" style={portalStyle({ color: MUTED })}>
          <Nokta renk={OK} /> {o.temiz} temiz
          <Nokta renk={WARN} /> {o.bulgulu} bulgulu
          <Nokta renk={GRAY} /> {o.uygulanmaz} uygulanmaz · {o.veriYok} veri yok
          <Nokta renk="rgba(250,250,249,.22)" /> {o.pasif} kapalı
        </span>
        <span className="ml-auto inline-flex items-center gap-2 text-[11.5px]" style={portalStyle({ color: MUTED })}>
          {o.hesap} hesap incelendi{o.hareketsizHesap ? ` · ${o.hareketsizHesap} hareketsiz` : ''}{o.mizanVar ? ' · Mizan dahil' : ' · Mizan yok'}
          {acik ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {acik && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" style={portalStyle({ borderTop: `1px solid ${BORDER}` })}>
          {alanlar.map((a) => {
            const bulgulu = a.kurallar.filter((k) => k.durum === 'BULGU').length;
            const temiz = a.kurallar.filter((k) => k.durum === 'TEMIZ').length;
            return (
              <div key={a.alan} className="rounded-xl p-3 mt-3" style={portalStyle({ background: 'rgba(255,255,255,.012)', border: `1px solid ${BORDER}` })}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13px]">{ALAN_IKON[a.alan] || '•'}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wide truncate" style={portalStyle({ color: 'rgba(250,250,249,.85)' })}>{a.alan}</span>
                  <span className="ml-auto text-[10.5px] tabular-nums whitespace-nowrap" style={portalStyle({ color: bulgulu ? WARN : temiz ? OK : MUTED2 })}>
                    {bulgulu ? `${bulgulu} bulgulu · ` : ''}{temiz} temiz
                  </span>
                </div>
                <div className="space-y-1">
                  {a.kurallar.map((k) => {
                    const renk = durumRengi(k);
                    const soluk = k.durum === 'PASIF' || k.durum === 'UYGULANMAZ' || k.durum === 'VERI_YOK';
                    return (
                      <div key={k.kod} className="flex items-center gap-2 text-[11.5px] leading-tight" title={`${k.kod} · ${DURUM_ETIKET[k.durum]}${k.not ? ` · ${k.not}` : ''}`}>
                        {k.durum === 'TEMIZ'
                          ? <CheckCircle2 size={11} style={portalStyle({ color: OK, flexShrink: 0 })} />
                          : <span className="w-[7px] h-[7px] rounded-full shrink-0" style={portalStyle({ background: renk, outline: k.durum === 'UYGULANMAZ' ? `1px dashed ${GRAY}` : 'none', outlineOffset: 1 })} />}
                        <span className="truncate" style={portalStyle({ color: soluk ? MUTED2 : 'rgba(250,250,249,.82)' })}>{k.ad}</span>
                        {k.durum === 'BULGU' && <span className="ml-auto text-[10px] font-bold tabular-nums px-1.5 rounded" style={portalStyle({ background: `${renk}22`, color: renk })}>{k.bulgu}</span>}
                        {k.durum !== 'BULGU' && k.durum !== 'TEMIZ' && <span className="ml-auto text-[9.5px] whitespace-nowrap" style={portalStyle({ color: MUTED2 })}>{k.durum === 'PASIF' ? 'kapalı' : k.durum === 'UYGULANMAZ' ? 'uygulanmaz' : 'veri yok'}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!alanlar.length && <div className="text-xs mt-3" style={portalStyle({ color: MUTED })}>Kapsam bilgisi yok — bu oturum eski sürümde analiz edilmiş; “Yeniden Analiz” çalıştırın.</div>}
        </div>
      )}
    </div>
  );
}

function Nokta({ renk }: { renk: string }) {
  return <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={portalStyle({ background: renk })} />;
}
