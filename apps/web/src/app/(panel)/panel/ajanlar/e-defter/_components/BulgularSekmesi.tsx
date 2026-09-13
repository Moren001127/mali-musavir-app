'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, EyeOff, ExternalLink, HelpCircle, RotateCcw, Search, Sparkles } from 'lucide-react';
import { ALAN_IKON, ESKI_ETIKET, alanSira, type KontrolOzeti, type KuralTanimi } from './katalog';
import { KapsamPaneli } from './KapsamPaneli';
import { BORDER, BORDER_STRONG, ERR, GRAY, INFO, MUTED, MUTED2, NAVY, NAVY_SOFT, OK, PANEL, PANEL_HOVER, TEXT, WARN, sevColor, sevLabel, sevRank } from './tema';

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

// Kural kodu → ekran adı (katalog > eski etiket > kodun kendisi)
function kuralAdi(kod: string, katalog: Map<string, KuralTanimi>) {
  return katalog.get(kod)?.ad || ESKI_ETIKET[kod] || kod.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
}

// Bulgu mesajını satır düzenine ayır: "KOD AD: olgu. ayrıntı/öneri" → hesap adı + kısa olgu + ayrıntı.
//   Satırda yalnız OLGU görünür (tek satır); ayrıntı tıklayınca açılır. Kural düzeyindeki "ne demek / ne yapmalı" başlıkta.
function mesajParcala(f: any): { ad: string; olgu: string; ayrinti: string } {
  let msg = String(f.message || '').trim();
  let ad = String(f.detail?.hesapAdi || '').trim();
  const kod = f.hesapKodu ? String(f.hesapKodu) : '';
  if (kod && msg.startsWith(kod)) {
    const i = msg.indexOf(': ');
    if (i > 0 && i < 90) {
      const bas = msg.slice(kod.length, i).trim();
      if (!ad && bas) ad = bas;
      msg = msg.slice(i + 2);
    }
  }
  // İlk cümle sonu: "." + boşluk + büyük harf/parantez (ondalık nokta ve "md. 88" gibi kısaltmalar sayılmaz)
  const m = /(?<!\d)\.\s+(?=[A-ZÇĞİÖŞÜ(])/.exec(msg);
  if (!m || m.index == null) return { ad, olgu: msg.replace(/\.$/, ''), ayrinti: '' };
  return { ad, olgu: msg.slice(0, m.index), ayrinti: msg.slice(m.index + 1).trim() };
}
function tutarYazi(f: any): string {
  const t = Number(f.detail?.tutar);
  if (!Number.isFinite(t) || t <= 0) return '';
  return `${t.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

export function BulgularSekmesi(p: BulgularProps) {
  const { session, allFindings, visibleFindings, stats, katalog, kontrolOzeti } = p;
  const [kapaliAlanlar, setKapaliAlanlar] = useState<Record<string, boolean>>({});
  const [acikKurallar, setAcikKurallar] = useState<Record<string, boolean>>({}); // açıklama/öneri açık mı
  const [acikMesajlar, setAcikMesajlar] = useState<Record<string, boolean>>({}); // uzun mesaj tam açık mı
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
  const alanlar = useMemo(() => {
    const map = new Map<string, { alan: string; kurallar: Map<string, any[]> }>();
    for (const f of visibleFindings) {
      const alan = katalog.get(f.category)?.alan || 'Diğer';
      if (!map.has(alan)) map.set(alan, { alan, kurallar: new Map() });
      const k = map.get(alan)!.kurallar;
      if (!k.has(f.category)) k.set(f.category, []);
      k.get(f.category)!.push(f);
    }
    return [...map.values()]
      .map((a) => {
        const kurallar = [...a.kurallar.entries()]
          .map(([kod, items]) => {
            const enYuksek = items.reduce((m: string, f: any) => (sevRank(f.severity) < sevRank(m) ? f.severity : m), 'INFO');
            // Bulgular: özet satırı en sona, kalanı şiddet + tutar
            const sirali = [...items].sort((x, y) => {
              const ox = x.detail?.ozet ? 1 : 0; const oy = y.detail?.ozet ? 1 : 0;
              if (ox !== oy) return ox - oy;
              const s = sevRank(x.severity) - sevRank(y.severity);
              if (s !== 0) return s;
              return Math.abs(Number(y.detail?.tutar || 0)) - Math.abs(Number(x.detail?.tutar || 0));
            });
            return { kod, items: sirali, enYuksek, tanim: katalog.get(kod) };
          })
          .sort((x, y) => sevRank(x.enYuksek) - sevRank(y.enYuksek) || y.items.length - x.items.length);
        const sayim = { error: 0, warn: 0, info: 0 };
        for (const f of visibleFindings) {
          if ((katalog.get(f.category)?.alan || 'Diğer') !== a.alan) continue;
          if (f.severity === 'ERROR') sayim.error += 1; else if (f.severity === 'WARN') sayim.warn += 1; else sayim.info += 1;
        }
        return { alan: a.alan, kurallar, sayim, toplam: sayim.error + sayim.warn + sayim.info };
      })
      .sort((a, b) => {
        // Hata içeren alanlar önce, sonra katalog sırası
        const ea = a.sayim.error ? 0 : a.sayim.warn ? 1 : 2;
        const eb = b.sayim.error ? 0 : b.sayim.warn ? 1 : 2;
        if (ea !== eb) return ea - eb;
        return alanSira(a.alan) - alanSira(b.alan);
      });
  }, [visibleFindings, katalog]);

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
  const statusColor = (s: string) => (s === 'RESOLVED' ? OK : s === 'IGNORED' ? GRAY : NAVY);

  return (
    <div className="space-y-3">
      <KapsamPaneli ozet={kontrolOzeti} katalog={katalog} bulguSiddeti={bulguSiddeti} />

      {/* Filtre satırı: arama + şiddet + durum, hepsi bir arada */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-9 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[240px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
          <Search size={14} />
          <input value={p.findingSearch} onChange={(e) => p.setFindingSearch(e.target.value)} placeholder="Bulgu, hesap kodu, fiş veya satır ara..." className="bg-transparent outline-none text-[13px] w-full" style={{ color: TEXT }} />
        </div>
        <div className="inline-flex h-9 p-0.5 rounded-lg gap-0.5" style={{ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` }}>
          {([['ERROR', 'Hata', stats.error, ERR], ['WARN', 'Uyarı', stats.warn, WARN], ['INFO', 'Bilgi', stats.info, INFO]] as const).map(([k, ad, n, renk]) => {
            const on = p.severityFilter === k;
            return (
              <button key={k} onClick={() => p.setSeverityFilter(on ? 'ALL' : k)} className="px-2.5 rounded-md text-[11.5px] font-semibold inline-flex items-center gap-1.5 tabular-nums" style={{ background: on ? `${renk}22` : 'transparent', color: on ? renk : 'rgba(250,250,249,.7)' }}>
                <span className="w-[7px] h-[7px] rounded-full" style={{ background: renk }} />{ad} {n}
              </button>
            );
          })}
        </div>
        <div className="inline-flex h-9 p-0.5 rounded-lg gap-0.5" style={{ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` }}>
          {([['OPEN', 'Açık', stats.open], ['RESOLVED', 'Çözüldü', stats.resolved], ['IGNORED', 'Görmezden', stats.ignored], ['ALL', 'Tümü', stats.total]] as const).map(([k, ad, n]) => {
            const on = p.statusFilter === k;
            return (
              <button key={k} onClick={() => p.setStatusFilter(k)} className="px-2.5 rounded-md text-[11.5px] font-semibold tabular-nums" style={{ background: on ? NAVY_SOFT : 'transparent', color: on ? NAVY : 'rgba(250,250,249,.7)' }}>
                {ad} <span style={{ opacity: .7 }}>{n}</span>
              </button>
            );
          })}
        </div>
        <span className="text-[11.5px] tabular-nums" style={{ color: MUTED }}>{visibleFindings.length} / {stats.total}</span>
        {alanlar.length > 0 && (
          <div className="inline-flex h-9 p-0.5 rounded-lg gap-0.5" style={{ background: 'rgba(255,255,255,.035)', border: `1px solid ${BORDER}` }}>
            <button onClick={() => setKapaliKurallar({})} className="px-2.5 rounded-md text-[11px] font-semibold" style={{ color: 'rgba(250,250,249,.7)' }} title="Tüm kural bloklarını aç">Genişlet</button>
            <button onClick={() => setKapaliKurallar(Object.fromEntries(alanlar.flatMap((x) => x.kurallar.map((k) => [k.kod, true]))))} className="px-2.5 rounded-md text-[11px] font-semibold" style={{ color: 'rgba(250,250,249,.7)' }} title="Yalnız kural başlıkları kalsın">Daralt</button>
          </div>
        )}
        {filtreAktif && (
          <button onClick={() => { p.setSeverityFilter('ALL'); p.setStatusFilter('OPEN'); p.setFindingSearch(''); }} className="h-9 px-3 rounded-lg text-[11.5px] font-semibold inline-flex items-center gap-1" style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}>
            <RotateCcw size={12} /> Sıfırla
          </button>
        )}
      </div>

      {/* Boş durumlar */}
      {!session && (
        <div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}` }}>
          <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={{ background: NAVY_SOFT, color: NAVY }}><Sparkles size={26} /></div>
          <div className="text-base font-semibold mb-1" style={{ color: TEXT }}>Henüz veri yok</div>
          <div className="text-xs" style={{ color: MUTED }}>Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.</div>
        </div>
      )}
      {session && alanlar.length === 0 && (
        <div className="rounded-2xl p-10 text-center" style={{ background: stats.total === 0 ? 'rgba(92,191,138,.05)' : PANEL, border: `1px dashed ${stats.total === 0 ? 'rgba(92,191,138,.25)' : BORDER_STRONG}` }}>
          <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={{ background: stats.total === 0 ? 'rgba(92,191,138,.15)' : NAVY_SOFT, color: stats.total === 0 ? OK : NAVY }}>
            {stats.total === 0 ? <CheckCircle2 size={26} /> : <Search size={26} />}
          </div>
          <div className="text-base font-semibold mb-1" style={{ color: TEXT }}>{stats.total === 0 ? 'Bu dönem temiz görünüyor' : 'Filtreyle eşleşen bulgu yok'}</div>
          <div className="text-xs" style={{ color: MUTED }}>{stats.total === 0 ? 'Tüm kontroller çalıştı, bulgu üretmedi.' : 'Filtreleri sıfırlayarak tüm bulguları görebilirsiniz.'}</div>
        </div>
      )}

      {/* Alan → kural → bulgu satırları */}
      <div className="space-y-2.5">
        {alanlar.map((a) => {
          const acik = !kapaliAlanlar[a.alan];
          const vurgu = a.sayim.error ? ERR : a.sayim.warn ? WARN : INFO;
          return (
            <div key={a.alan} className="rounded-xl overflow-hidden relative" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
              <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${vurgu}66, transparent)` }} />
              <button onClick={() => setKapaliAlanlar((s) => ({ ...s, [a.alan]: acik }))} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left" style={{ background: PANEL_HOVER }}>
                <span className="text-[15px] w-5 text-center">{ALAN_IKON[a.alan] || '•'}</span>
                <span className="text-[12.5px] font-bold" style={{ color: TEXT }}>{a.alan}</span>
                <span className="text-[10.5px] tabular-nums px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(255,255,255,.06)', color: MUTED }}>{a.kurallar.length} kural · {a.toplam} bulgu</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {a.sayim.error > 0 && <Rozet n={a.sayim.error} renk={ERR} ad="hata" />}
                  {a.sayim.warn > 0 && <Rozet n={a.sayim.warn} renk={WARN} ad="uyarı" />}
                  {a.sayim.info > 0 && <Rozet n={a.sayim.info} renk={INFO} ad="bilgi" />}
                  {acik ? <ChevronDown size={14} style={{ color: MUTED }} /> : <ChevronRight size={14} style={{ color: MUTED }} />}
                </span>
              </button>

              {acik && (
                <div className="divide-y" style={{ borderColor: BORDER }}>
                  {a.kurallar.map((k) => {
                    const renk = sevColor(k.enYuksek);
                    const bilgiAcik = Boolean(acikKurallar[k.kod]);
                    const daraltildi = Boolean(kapaliKurallar[k.kod]);
                    const ozet = k.items.find((f: any) => f.detail?.ozet);
                    const satirlar = k.items.filter((f: any) => !f.detail?.ozet).slice(0, 300);
                    const hesapli = satirlar.some((f: any) => f.hesapKodu);
                    return (
                      <div key={k.kod} style={{ borderColor: BORDER }}>
                        {/* Kural başlığı: ad · şiddet/sayı · (sağda) dayanak · ⓘ · daralt */}
                        <div className="flex items-center gap-2 px-3.5 py-2" style={{ background: 'rgba(255,255,255,.015)' }}>
                          <button onClick={() => setKapaliKurallar((st) => ({ ...st, [k.kod]: !daraltildi }))} className="flex items-center gap-2 min-w-0 flex-1 text-left" title={daraltildi ? 'Satırları göster' : 'Satırları gizle'}>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: renk, boxShadow: `0 0 0 3px ${renk}22` }} />
                            <span className="text-[12.5px] font-semibold truncate" style={{ color: 'rgba(250,250,249,.92)' }}>{kuralAdi(k.kod, katalog)}</span>
                            <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded shrink-0" style={{ background: `${renk}1c`, color: renk }}>{sevLabel(k.enYuksek)} · {satirlar.length}</span>
                          </button>
                          {k.tanim?.mevzuat && <span className="text-[10px] whitespace-nowrap hidden md:inline" style={{ color: MUTED2 }}>{k.tanim.mevzuat}</span>}
                          {k.tanim && (
                            <button onClick={() => setAcikKurallar((st) => ({ ...st, [k.kod]: !bilgiAcik }))} className="h-6 w-6 rounded-md inline-flex items-center justify-center shrink-0" style={{ color: bilgiAcik ? NAVY : MUTED2, background: bilgiAcik ? NAVY_SOFT : 'transparent' }} title="Bu kural ne demek, ne yapılmalı?">
                              <HelpCircle size={13} />
                            </button>
                          )}
                          <button onClick={() => setKapaliKurallar((st) => ({ ...st, [k.kod]: !daraltildi }))} className="h-6 w-6 rounded-md inline-flex items-center justify-center shrink-0" style={{ color: MUTED2 }} title={daraltildi ? 'Satırları göster' : 'Satırları gizle'}>
                            {daraltildi ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </div>
                        {bilgiAcik && k.tanim && (
                          <div className="mx-3.5 my-2 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed" style={{ background: 'rgba(91,141,239,.06)', border: '1px solid rgba(91,141,239,.16)', color: 'rgba(250,250,249,.78)' }}>
                            <div><span className="font-semibold" style={{ color: '#bfd4ff' }}>Ne demek: </span>{k.tanim.aciklama}</div>
                            {k.tanim.oneri && <div className="mt-1"><span className="font-semibold" style={{ color: '#bfd4ff' }}>Ne yapmalı: </span>{k.tanim.oneri}</div>}
                          </div>
                        )}
                        {/* Bulgu satırları: hesap · olgu (tek satır) · tutar · işlem — ayrıntı tıklayınca */}
                        {!daraltildi && (
                          <div>
                            {satirlar.map((f: any, idx: number) => {
                              const fStatus = f.status || 'OPEN';
                              const c = sevColor(f.severity);
                              const kapali = fStatus !== 'OPEN';
                              const parca = mesajParcala(f);
                              const tutar = tutarYazi(f);
                              const acik = Boolean(acikMesajlar[f.id]);
                              const ayrintiVar = Boolean(parca.ayrinti);
                              return (
                                <div key={f.id} style={{ background: idx % 2 ? 'rgba(255,255,255,.012)' : 'transparent', opacity: kapali ? 0.5 : 1 }}>
                                  <div className="grid items-center gap-x-3 px-3.5 py-[6px] hover:bg-white/[.03]" style={{ gridTemplateColumns: hesapli ? '8px minmax(150px,220px) minmax(0,1fr) auto auto' : '8px minmax(0,1fr) auto auto' }}>
                                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: c }} />
                                    {hesapli && (
                                      <div className="min-w-0 flex items-baseline gap-1.5">
                                        {f.hesapKodu
                                          ? <><span className="text-[12px] font-semibold tabular-nums shrink-0" style={{ color: TEXT }}>{f.hesapKodu}</span><span className="text-[11px] truncate" style={{ color: MUTED }} title={parca.ad}>{parca.ad}</span></>
                                          : <span className="text-[11px]" style={{ color: MUTED2 }}>{f.rowIndex ? `Satır ${f.rowIndex}` : '—'}</span>}
                                      </div>
                                    )}
                                    <div className="min-w-0 text-[12.5px] leading-snug flex items-baseline gap-1.5" style={{ color: 'rgba(250,250,249,.86)', textDecoration: fStatus === 'RESOLVED' ? 'line-through' : 'none' }}>
                                      {!hesapli && f.rowIndex && <span className="text-[10.5px] tabular-nums px-1.5 py-px rounded shrink-0" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.7)' }}>Satır {f.rowIndex}</span>}
                                      <span className={`truncate ${ayrintiVar ? 'cursor-pointer' : ''}`} onClick={() => ayrintiVar && setAcikMesajlar((st) => ({ ...st, [f.id]: !acik }))} title={ayrintiVar ? (acik ? 'Ayrıntıyı gizle' : 'Ayrıntı için tıklayın') : parca.olgu}>{parca.olgu}</span>
                                    </div>
                                    <span className="text-[12px] tabular-nums whitespace-nowrap text-right" style={{ color: tutar ? 'rgba(250,250,249,.9)' : 'transparent', minWidth: 96 }}>{tutar || '·'}</span>
                                    <div className="flex items-center gap-1">
                                      {(f.rowIndex || f.voucherKey) && (
                                        <IkonDugme title="Fiş satırını incele" renk={NAVY} onClick={() => p.focusFinding(f)}><ExternalLink size={13} /></IkonDugme>
                                      )}
                                      {fStatus !== 'RESOLVED' && <IkonDugme title="Çözüldü olarak işaretle" renk={OK} onClick={() => p.handleStatusChange(f, 'RESOLVED')}><CheckCircle2 size={13} /></IkonDugme>}
                                      {fStatus !== 'IGNORED' && <IkonDugme title="Görmezden gel" renk={GRAY} onClick={() => p.handleStatusChange(f, 'IGNORED')}><EyeOff size={13} /></IkonDugme>}
                                      {fStatus !== 'OPEN' && <IkonDugme title="Yeniden aç" renk={NAVY} onClick={() => p.handleStatusChange(f, 'OPEN')}><RotateCcw size={13} /></IkonDugme>}
                                    </div>
                                  </div>
                                  {(acik || kapali) && (
                                    <div className="px-3.5 pb-2 -mt-0.5 text-[11.5px] leading-relaxed" style={{ color: 'rgba(250,250,249,.62)', paddingLeft: hesapli ? 'calc(8px + 12px + 1rem)' : '1.6rem' }}>
                                      {acik && ayrintiVar && <div>{parca.ayrinti}</div>}
                                      {kapali && (
                                        <div className="mt-0.5 text-[10.5px] font-semibold inline-flex items-center gap-1" style={{ color: statusColor(fStatus) }}>
                                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(fStatus) }} />{fStatus === 'RESOLVED' ? 'Çözüldü' : 'Görmezden gelindi'}{f.detail?.note ? ` · ${f.detail.note}` : ''}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {ozet && (
                              <div className="px-3.5 py-1.5 text-[10.5px]" style={{ color: MUTED2, borderTop: `1px dashed ${BORDER}` }}>
                                {ozet.detail?.toplam != null && ozet.detail?.kalan != null
                                  ? `Toplam ${ozet.detail.toplam} · en büyük ${Number(ozet.detail.toplam) - Number(ozet.detail.kalan)} tanesi gösterildi, ${ozet.detail.kalan} tanesi daha var`
                                  : ozet.message}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bakıldı, temiz alanlar */}
      {session && temizAlanlar.length > 0 && (
        <div className="rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5" style={{ background: 'rgba(92,191,138,.05)', border: '1px solid rgba(92,191,138,.16)' }}>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: OK }}><CheckCircle2 size={13} /> Sorun bulunmayan alanlar</span>
          {temizAlanlar.map((t) => (
            <span key={t.alan} className="text-[11px] tabular-nums px-2 py-0.5 rounded-md" style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,.72)' }}>
              {ALAN_IKON[t.alan] || '•'} {t.alan} <span style={{ color: MUTED2 }}>· {t.adet} kontrol</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Rozet({ n, renk, ad }: { n: number; renk: string; ad: string }) {
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded tabular-nums" style={{ background: `${renk}1c`, color: renk }}>{n} {ad}</span>;
}

function IkonDugme({ title, renk, onClick, children }: { title: string; renk: string; onClick: () => void; children: any }) {
  return (
    <button onClick={onClick} title={title} className="h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors" style={{ background: `${renk}14`, color: renk, border: `1px solid ${renk}2a` }}>
      {children}
    </button>
  );
}
