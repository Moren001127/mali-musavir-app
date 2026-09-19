'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Search, Sparkles } from 'lucide-react';
import { ALAN_IKON, alanSira, type KontrolOzeti, type KuralTanimi } from './katalog';
import { KapsamPaneli } from './KapsamPaneli';
import { BulguTablosu, alanlaraGrupla, tumKurallariDaralt } from './BulguTablosu';
import { BORDER, BORDER_STRONG, ERR, INFO, MUTED, MUTED2, NAVY, NAVY_SOFT, OK, PANEL, TEXT, WARN, sevRank } from './tema';

type SeverityFilter = 'ALL' | 'ERROR' | 'WARN' | 'INFO';
type StatusFilter = 'OPEN' | 'ALL' | 'RESOLVED' | 'IGNORED';

export type BulgularProps = {
  session: any;
  allFindings: any[];
  visibleFindings: any[];
  stats: { total: number; open: number; resolved: number; ignored: number; error: number; warn: number; info: number };
  katalog: Map<string, KuralTanimi>;
  kontrolOzeti: KontrolOzeti | null | undefined;
  findingSearch: string;
  setFindingSearch: (v: string) => void;
  severityFilter: SeverityFilter;
  setSeverityFilter: (v: SeverityFilter) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  focusFinding: (f: any) => void;
  handleStatusChange: (f: any, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => void;
};

export function BulgularSekmesi(p: BulgularProps) {
  const { session, allFindings, visibleFindings, stats, katalog, kontrolOzeti } = p;
  const [kapaliKurallar, setKapaliKurallar] = useState<Record<string, boolean>>({}); // kural bloğu daraltıldı mı

  // Açık bulgulardan kod → en yüksek şiddet (kapsam paneli renkleri)
  const bulguSiddeti = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of allFindings) {
      if ((f.status || 'OPEN') !== 'OPEN') continue;
      const onceki = m.get(f.category);
      if (!onceki || sevRank(f.severity) < sevRank(onceki)) m.set(f.category, f.severity);
    }
    return m;
  }, [allFindings]);

  // Alan → kural → bulgular (görünür filtre uygulanmış)
  const alanlar = useMemo(() => alanlaraGrupla(visibleFindings, katalog), [visibleFindings, katalog]);

  // Bulgusu olmayan ama kontrol edilmiş alanlar (kapsamdan) — "bakıldı, temiz" güveni
  const temizAlanlar = useMemo(() => {
    if (!kontrolOzeti?.kapsam?.length) return [] as Array<{ alan: string; adet: number }>;
    const bulgulu = new Set(alanlar.map((a) => a.alan));
    const say = new Map<string, number>();
    for (const k of kontrolOzeti.kapsam) {
      if (k.durum !== 'TEMIZ') continue;
      const alan = katalog.get(k.kod)?.alan || 'Diğer';
      if (bulgulu.has(alan)) continue;
      say.set(alan, (say.get(alan) || 0) + 1);
    }
    return [...say.entries()].map(([alan, adet]) => ({ alan, adet })).sort((a, b) => alanSira(a.alan) - alanSira(b.alan));
  }, [kontrolOzeti, alanlar, katalog]);

  const filtreAktif = p.severityFilter !== 'ALL' || p.statusFilter !== 'OPEN' || Boolean(p.findingSearch);

  return (
    <div className="space-y-3">
      <KapsamPaneli ozet={kontrolOzeti} katalog={katalog} bulguSiddeti={bulguSiddeti} />

      {/* Filtre satırı: arama + şiddet + durum, hepsi bir arada */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-9 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[240px]" style={portalStyle({ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' })}>
          <Search size={14} />
          <input value={p.findingSearch} onChange={(e) => p.setFindingSearch(e.target.value)} placeholder="Bulgu, hesap kodu, fiş veya satır ara..." className="bg-transparent outline-none text-[13px] w-full" style={portalStyle({ color: TEXT })} />
        </div>
        <div className="inline-flex h-9 p-0.5 rounded-lg gap-0.5" style={portalStyle({ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` })}>
          {([['ERROR', 'Hata', stats.error, ERR], ['WARN', 'Uyarı', stats.warn, WARN], ['INFO', 'Bilgi', stats.info, INFO]] as const).map(([k, ad, n, renk]) => {
            const on = p.severityFilter === k;
            return (
              <button key={k} onClick={() => p.setSeverityFilter(on ? 'ALL' : k)} className="px-2.5 rounded-md text-[11.5px] font-semibold inline-flex items-center gap-1.5 tabular-nums" style={portalStyle({ background: on ? `${renk}22` : 'transparent', color: on ? renk : 'rgba(250,250,249,.7)' })}>
                <span className="w-[7px] h-[7px] rounded-full" style={portalStyle({ background: renk })} />{ad} {n}
              </button>
            );
          })}
        </div>
        <div className="inline-flex h-9 p-0.5 rounded-lg gap-0.5" style={portalStyle({ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` })}>
          {([['OPEN', 'Açık', stats.open], ['RESOLVED', 'Çözüldü', stats.resolved], ['IGNORED', 'Görmezden', stats.ignored], ['ALL', 'Tümü', stats.total]] as const).map(([k, ad, n]) => {
            const on = p.statusFilter === k;
            return (
              <button key={k} onClick={() => p.setStatusFilter(k)} className="px-2.5 rounded-md text-[11.5px] font-semibold tabular-nums" style={portalStyle({ background: on ? NAVY_SOFT : 'transparent', color: on ? NAVY : 'rgba(250,250,249,.7)' })}>
                {ad} <span style={portalStyle({ opacity: .7 })}>{n}</span>
              </button>
            );
          })}
        </div>
        <span className="text-[11.5px] tabular-nums" style={portalStyle({ color: MUTED })}>{visibleFindings.length} / {stats.total}</span>
        {alanlar.length > 0 && (
          <div className="inline-flex h-9 p-0.5 rounded-lg gap-0.5" style={portalStyle({ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` })}>
            <button onClick={() => setKapaliKurallar({})} className="px-2.5 rounded-md text-[11px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,.7)' })} title="Tüm kural bloklarını aç">Genişlet</button>
            <button onClick={() => setKapaliKurallar(tumKurallariDaralt(alanlar))} className="px-2.5 rounded-md text-[11px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,.7)' })} title="Yalnız kural başlıkları kalsın">Daralt</button>
          </div>
        )}
        {filtreAktif && (
          <button onClick={() => { p.setSeverityFilter('ALL'); p.setStatusFilter('OPEN'); p.setFindingSearch(''); }} className="h-9 px-3 rounded-lg text-[11.5px] font-semibold inline-flex items-center gap-1" style={portalStyle({ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` })}>
            <RotateCcw size={12} /> Sıfırla
          </button>
        )}
      </div>

      {/* Boş durumlar */}
      {!session && (
        <div className="rounded-2xl p-12 text-center" style={portalStyle({ background: PANEL, border: `1px dashed ${BORDER_STRONG}` })}>
          <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={portalStyle({ background: NAVY_SOFT, color: NAVY })}><Sparkles size={26} /></div>
          <div className="text-base font-semibold mb-1" style={portalStyle({ color: TEXT })}>Henüz veri yok</div>
          <div className="text-xs" style={portalStyle({ color: MUTED })}>Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.</div>
        </div>
      )}
      {session && alanlar.length === 0 && (
        <div className="rounded-2xl p-10 text-center" style={portalStyle({ background: stats.total === 0 ? 'rgba(92,191,138,.05)' : PANEL, border: `1px dashed ${stats.total === 0 ? 'rgba(92,191,138,.25)' : BORDER_STRONG}` })}>
          <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={portalStyle({ background: stats.total === 0 ? 'rgba(92,191,138,.15)' : NAVY_SOFT, color: stats.total === 0 ? OK : NAVY })}>
            {stats.total === 0 ? <CheckCircle2 size={26} /> : <Search size={26} />}
          </div>
          <div className="text-base font-semibold mb-1" style={portalStyle({ color: TEXT })}>{stats.total === 0 ? 'Bu dönem temiz görünüyor' : 'Filtreyle eşleşen bulgu yok'}</div>
          <div className="text-xs" style={portalStyle({ color: MUTED })}>{stats.total === 0 ? 'Tüm kontroller çalıştı, bulgu üretmedi.' : 'Filtreleri sıfırlayarak tüm bulguları görebilirsiniz.'}</div>
        </div>
      )}

      {/* Alan → kural → satır tablosu (Mizan Denetimi sekmesiyle ortak bileşen) */}
      <BulguTablosu
        alanlar={alanlar}
        katalog={katalog}
        kapaliKurallar={kapaliKurallar}
        setKapaliKurallar={setKapaliKurallar}
        focusFinding={p.focusFinding}
        handleStatusChange={p.handleStatusChange}
      />

      {/* Bakıldı, temiz alanlar */}
      {session && temizAlanlar.length > 0 && (
        <div className="rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5" style={portalStyle({ background: 'rgba(92,191,138,.05)', border: '1px solid rgba(92,191,138,.16)' })}>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold" style={portalStyle({ color: OK })}><CheckCircle2 size={13} /> Sorun bulunmayan alanlar</span>
          {temizAlanlar.map((t) => (
            <span key={t.alan} className="text-[11px] tabular-nums px-2 py-0.5 rounded-md" style={portalStyle({ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,.72)' })}>
              {ALAN_IKON[t.alan] || '•'} {t.alan} <span style={portalStyle({ color: MUTED2 })}>· {t.adet} kontrol</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
