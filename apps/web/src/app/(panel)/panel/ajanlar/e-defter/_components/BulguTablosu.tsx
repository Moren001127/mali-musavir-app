'use client';
import { portalStyle } from '@/lib/portal-theme';


import { Fragment, useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, EyeOff, ExternalLink, HelpCircle, RotateCcw } from 'lucide-react';
import { ALAN_IKON, ESKI_ETIKET, alanSira, type KuralTanimi } from './katalog';
import { GRAY, NAVY, NAVY_SOFT, OK, TEXT, sevColor, sevLabel, sevRank } from './tema';

// ─────────────────────────────────────────────────────────────────────────────
//  BULGU TABLOSU — alan → kural → satır. Bulgular sekmesi ve Mizan Denetimi sekmesi aynı tabloyu kullanır.
//
//  RENK KURALI (Muzaffer Bey 2026-09-14: "çok renkli tablo kafa karıştırıyor, renk uyumu yok"):
//    • Yapı TEK renk ailesi: alan başlığı + tablo başlığı lacivert tonunda, şiddete göre DEĞİŞMEZ.
//    • Kural satırları nötr (hepsi aynı gri zemin); şiddet yalnız küçük rozette (renkli yazı + hafif dolgu).
//    • Bulgu satırları nötr zebra; şiddet yalnız üst süzgeçteki gibi küçük NOKTA ile.
//    • Sol renk şeridi YOK, işlem düğmeleri tek nötr biçim (görünür kalır, saklanmaz).
// ─────────────────────────────────────────────────────────────────────────────
const KENAR = 'rgba(255,255,255,.14)';
const ALAN_ZEMIN = 'linear-gradient(90deg, rgba(91,141,239,.16), rgba(255,255,255,.03) 60%)';
const BASLIK_ZEMIN = 'rgba(91,141,239,.12)';
const KURAL_ZEMIN = 'rgba(255,255,255,.055)';
const ZEBRA = 'rgba(255,255,255,.035)';
const YAZI_SOLUK = 'rgba(250,250,249,.62)';
const HUCRE: CSSProperties = { border: `1px solid ${KENAR}`, padding: '8px 12px', verticalAlign: 'middle' };
const HUCRE_BASLIK: CSSProperties = { ...HUCRE, fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#bfd4ff', textAlign: 'left' };
const NOKTA: CSSProperties = { width: 7, height: 7, borderRadius: 999, flexShrink: 0, display: 'inline-block' };

export type KuralGrubu = { kod: string; items: any[]; enYuksek: string; tanim?: KuralTanimi };
export type AlanGrubu = { alan: string; kurallar: KuralGrubu[]; sayim: { error: number; warn: number; info: number }; toplam: number };

// Kural kodu → ekran adı (katalog > eski etiket > kodun kendisi)
export function kuralAdi(kod: string, katalog: Map<string, KuralTanimi>) {
  if (kod.startsWith('MANUEL:') && !katalog.has(kod)) return 'Silinmiş ofis kuralı'; // kural silindi, eski oturumun bulgusu duruyor
  return katalog.get(kod)?.ad || ESKI_ETIKET[kod] || kod.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
}

// Bulguları alan → kural → satır düzenine gruplar. Hata içeren alanlar önce, sonra katalog sırası.
export function alanlaraGrupla(findings: any[], katalog: Map<string, KuralTanimi>): AlanGrubu[] {
  const map = new Map<string, { alan: string; kurallar: Map<string, any[]> }>();
  for (const f of findings) {
    const alan = katalog.get(f.category)?.alan || 'Diğer';
    if (!map.has(alan)) map.set(alan, { alan, kurallar: new Map() });
    const k = map.get(alan)!.kurallar;
    if (!k.has(f.category)) k.set(f.category, []);
    k.get(f.category)!.push(f);
  }
  return [...map.values()]
    .map((a) => {
      const kurallar: KuralGrubu[] = [...a.kurallar.entries()]
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
      for (const k of kurallar) for (const f of k.items) {
        if (f.severity === 'ERROR') sayim.error += 1; else if (f.severity === 'WARN') sayim.warn += 1; else sayim.info += 1;
      }
      return { alan: a.alan, kurallar, sayim, toplam: sayim.error + sayim.warn + sayim.info };
    })
    .sort((a, b) => {
      const ea = a.sayim.error ? 0 : a.sayim.warn ? 1 : 2;
      const eb = b.sayim.error ? 0 : b.sayim.warn ? 1 : 2;
      if (ea !== eb) return ea - eb;
      return alanSira(a.alan) - alanSira(b.alan);
    });
}

// "Daralt": tüm kural bloklarını kapat (yalnız kural başlıkları kalır)
export function tumKurallariDaralt(alanlar: AlanGrubu[]): Record<string, boolean> {
  return Object.fromEntries(alanlar.flatMap((a) => a.kurallar.map((k) => [k.kod, true])));
}

// Bulgu mesajını satır düzenine ayır: "KOD AD: olgu. ayrıntı/öneri" → hesap adı + kısa olgu + ayrıntı.
//   Satırda yalnız OLGU görünür (tek satır); ayrıntı tıklayınca açılır. Kural düzeyindeki "ne demek / ne yapmalı" başlıkta.
function mesajParcala(f: any): { ad: string; olgu: string; ayrinti: string } {
  let msg = String(f.message || '').trim();
  let ad = String(f.detail?.hesapAdi || '').trim();
  const kod = f.hesapKodu ? String(f.hesapKodu) : '';
  // Özellikli hesap kataloğu bulguları adı detail.hesap'ta taşır ("549 Ozel Fonlar") — kod öneki atılıp hesap sütununa yazılır
  if (!ad && kod && typeof f.detail?.hesap === 'string' && f.detail.hesap.startsWith(kod)) ad = f.detail.hesap.slice(kod.length).trim();
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
  // tutar yoksa bakiye (özellikli hesap kataloğu) — mutlak değer
  const t = Number(f.detail?.tutar) > 0 ? Number(f.detail.tutar) : Math.abs(Number(f.detail?.bakiye || 0));
  if (!Number.isFinite(t) || t <= 0) return '';
  return `${t.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

export type BulguTablosuProps = {
  alanlar: AlanGrubu[];
  katalog: Map<string, KuralTanimi>;
  kapaliKurallar: Record<string, boolean>;
  setKapaliKurallar: Dispatch<SetStateAction<Record<string, boolean>>>;
  focusFinding: (f: any) => void;
  handleStatusChange: (f: any, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => void;
};

export function BulguTablosu(p: BulguTablosuProps) {
  const { alanlar, katalog, kapaliKurallar, setKapaliKurallar } = p;
  const [kapaliAlanlar, setKapaliAlanlar] = useState<Record<string, boolean>>({});
  const [acikKurallar, setAcikKurallar] = useState<Record<string, boolean>>({}); // açıklama/öneri açık mı
  const [acikMesajlar, setAcikMesajlar] = useState<Record<string, boolean>>({}); // uzun mesaj tam açık mı
  const statusColor = (s: string) => (s === 'RESOLVED' ? OK : s === 'IGNORED' ? GRAY : NAVY);
  const hesapliMi = useMemo(() => new Map(alanlar.map((a) => [a.alan, a.kurallar.some((k) => k.items.some((f: any) => f.hesapKodu && !f.detail?.ozet))])), [alanlar]);

  return (
    <div className="space-y-3">
      {alanlar.map((a) => {
        const acik = !kapaliAlanlar[a.alan];
        const hesapli = Boolean(hesapliMi.get(a.alan));
        return (
          <div key={a.alan} className="ed-findings rounded-xl overflow-hidden" style={portalStyle({ border: `1px solid ${KENAR}`, background: 'rgba(255,255,255,.02)' })}>
            {/* Alan başlığı — lacivert aile, şiddete göre boyanmaz */}
            <button className="ed-area-heading w-full flex items-center gap-2.5 px-3.5 py-3 text-left" aria-expanded={acik} onClick={() => setKapaliAlanlar((st) => ({ ...st, [a.alan]: acik }))} style={portalStyle({ background: ALAN_ZEMIN, borderLeft: '3px solid rgba(91,141,239,.75)', borderBottom: `1px solid ${KENAR}` })}>
              <span className="text-[16px] w-5 text-center">{ALAN_IKON[a.alan] || '•'}</span>
              <span className="text-[14px] font-bold" style={portalStyle({ color: TEXT })}>{a.alan}</span>
              <span className="text-[11px] tabular-nums px-2 py-0.5 rounded-md" style={portalStyle({ background: 'rgba(255,255,255,.07)', color: 'rgba(250,250,249,.78)' })}>{a.kurallar.length} kural · {a.toplam} bulgu</span>
              <span className="ml-auto flex items-center gap-3">
                {a.sayim.error > 0 && <Sayac n={a.sayim.error} renk={sevColor('ERROR')} ad="hata" />}
                {a.sayim.warn > 0 && <Sayac n={a.sayim.warn} renk={sevColor('WARN')} ad="uyarı" />}
                {a.sayim.info > 0 && <Sayac n={a.sayim.info} renk={sevColor('INFO')} ad="bilgi" />}
                {acik ? <ChevronDown size={15} style={portalStyle({ color: YAZI_SOLUK })} /> : <ChevronRight size={15} style={portalStyle({ color: YAZI_SOLUK })} />}
              </span>
            </button>

            {acik && (
              <table data-ops-table="true" className="w-full" style={portalStyle({ borderCollapse: 'collapse', tableLayout: 'fixed' })}>
                <colgroup>
                  {hesapli && <col style={portalStyle({ width: 250 })} />}
                  <col />
                  <col style={portalStyle({ width: 150 })} />
                  <col style={portalStyle({ width: 118 })} />
                </colgroup>
                <thead>
                  <tr style={portalStyle({ background: BASLIK_ZEMIN })}>
                    {hesapli && <th style={portalStyle(HUCRE_BASLIK)}>Hesap</th>}
                    <th style={portalStyle(HUCRE_BASLIK)}>Bulgu</th>
                    <th style={portalStyle({ ...HUCRE_BASLIK, textAlign: 'right' })}>Tutar</th>
                    <th style={portalStyle({ ...HUCRE_BASLIK, textAlign: 'center' })}>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {a.kurallar.map((k) => {
                    const renk = sevColor(k.enYuksek);
                    const bilgiAcik = Boolean(acikKurallar[k.kod]);
                    const daraltildi = Boolean(kapaliKurallar[k.kod]);
                    const ozet = k.items.find((f: any) => f.detail?.ozet);
                    const satirlar = k.items.filter((f: any) => !f.detail?.ozet).slice(0, 300);
                    const sutun = hesapli ? 4 : 3;
                    return (
                      <Fragment key={k.kod}>
                        {/* Kural başlığı satırı — nötr zemin; şiddet yalnız rozette */}
                        <tr className="ed-rule-row" style={portalStyle({ background: KURAL_ZEMIN })}>
                          <td colSpan={sutun} style={portalStyle({ ...HUCRE, padding: '9px 12px' })}>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setKapaliKurallar((st) => ({ ...st, [k.kod]: !daraltildi }))} className="flex items-center gap-2 min-w-0 flex-1 text-left" title={daraltildi ? 'Satırları göster' : 'Satırları gizle'}>
                                <span className="text-[13px] font-bold truncate" style={portalStyle({ color: TEXT })}>{kuralAdi(k.kod, katalog)}</span>
                                <span className="text-[10.5px] font-extrabold tabular-nums px-2 py-0.5 rounded-md shrink-0" style={portalStyle({ background: `${renk}1f`, color: renk, border: `1px solid ${renk}40` })}>{sevLabel(k.enYuksek)} · {satirlar.length}</span>
                              </button>
                              {k.tanim?.mevzuat && <span className="text-[10.5px] whitespace-nowrap hidden md:inline" style={portalStyle({ color: YAZI_SOLUK })}>{k.tanim.mevzuat}</span>}
                              {k.tanim && (
                                <button onClick={() => setAcikKurallar((st) => ({ ...st, [k.kod]: !bilgiAcik }))} className="h-6 w-6 rounded-md inline-flex items-center justify-center shrink-0" style={portalStyle({ color: bilgiAcik ? NAVY : 'rgba(250,250,249,.75)', background: bilgiAcik ? NAVY_SOFT : 'rgba(255,255,255,.08)' })} title="Bu kural ne demek, ne yapılmalı?">
                                  <HelpCircle size={13} />
                                </button>
                              )}
                              <button onClick={() => setKapaliKurallar((st) => ({ ...st, [k.kod]: !daraltildi }))} className="h-6 w-6 rounded-md inline-flex items-center justify-center shrink-0" style={portalStyle({ color: 'rgba(250,250,249,.75)', background: 'rgba(255,255,255,.08)' })} title={daraltildi ? 'Satırları göster' : 'Satırları gizle'}>
                                {daraltildi ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {bilgiAcik && k.tanim && (
                          <tr>
                            <td colSpan={sutun} style={portalStyle({ ...HUCRE, background: 'rgba(91,141,239,.08)', color: 'rgba(250,250,249,.82)', fontSize: 12, lineHeight: 1.55 })}>
                              <div><span className="font-semibold" style={portalStyle({ color: '#bfd4ff' })}>Ne demek: </span>{k.tanim.aciklama}</div>
                              {k.tanim.oneri && <div className="mt-1"><span className="font-semibold" style={portalStyle({ color: '#bfd4ff' })}>Ne yapmalı: </span>{k.tanim.oneri}</div>}
                            </td>
                          </tr>
                        )}
                        {!daraltildi && satirlar.map((f: any, idx: number) => {
                          const fStatus = f.status || 'OPEN';
                          const c = sevColor(f.severity);
                          const kapali = fStatus !== 'OPEN';
                          const parca = mesajParcala(f);
                          const tutar = tutarYazi(f);
                          const acikSatir = Boolean(acikMesajlar[f.id]);
                          const ayrintiVar = Boolean(parca.ayrinti);
                          const zemin = idx % 2 ? ZEBRA : 'transparent';
                          const saltGorunum = Boolean(f.saltGorunum);
                          return (
                            <Fragment key={f.id}>
                              <tr style={portalStyle({ background: zemin, opacity: kapali ? 0.5 : 1 })} className="hover:bg-white/[.06]">
                                {hesapli && (
                                  <td style={portalStyle(HUCRE)}>
                                    <div className="flex items-start gap-2 min-w-0">
                                      <span style={portalStyle({ ...NOKTA, background: c, marginTop: 5 })} title={sevLabel(f.severity)} />
                                      {f.hesapKodu ? (
                                        <div className="min-w-0">
                                          <div className="text-[12.5px] font-bold tabular-nums" style={portalStyle({ color: TEXT })}>{f.hesapKodu}</div>
                                          {parca.ad && <div className="text-[11px] truncate" style={portalStyle({ color: YAZI_SOLUK })} title={parca.ad}>{parca.ad}</div>}
                                        </div>
                                      ) : (
                                        <span className="text-[11.5px]" style={portalStyle({ color: 'rgba(250,250,249,.55)' })}>{f.rowIndex ? `Satır ${f.rowIndex}` : '—'}</span>
                                      )}
                                    </div>
                                  </td>
                                )}
                                <td style={portalStyle(HUCRE)}>
                                  <div className="flex items-baseline gap-2 min-w-0">
                                    {!hesapli && <span style={portalStyle({ ...NOKTA, background: c, alignSelf: 'center' })} title={sevLabel(f.severity)} />}
                                    {!hesapli && f.rowIndex && <span className="text-[10.5px] tabular-nums px-1.5 py-px rounded shrink-0" style={portalStyle({ background: 'rgba(255,255,255,.08)', color: 'rgba(250,250,249,.75)' })}>Satır {f.rowIndex}</span>}
                                    <span className={`text-[12.5px] leading-snug ${ayrintiVar ? 'cursor-pointer' : ''}`} style={portalStyle({ color: 'rgba(250,250,249,.9)', textDecoration: fStatus === 'RESOLVED' ? 'line-through' : 'none', display: '-webkit-box', WebkitLineClamp: acikSatir ? 'unset' as any : 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' })} onClick={() => ayrintiVar && setAcikMesajlar((st) => ({ ...st, [f.id]: !acikSatir }))} title={ayrintiVar ? (acikSatir ? 'Ayrıntıyı gizle' : 'Ayrıntı için tıklayın') : undefined}>
                                      {parca.olgu}
                                    </span>
                                  </div>
                                  {kapali && (
                                    <div className="mt-1 text-[10.5px] font-semibold inline-flex items-center gap-1" style={portalStyle({ color: statusColor(fStatus) })}>
                                      <span className="w-1.5 h-1.5 rounded-full" style={portalStyle({ background: statusColor(fStatus) })} />{fStatus === 'RESOLVED' ? 'Çözüldü' : 'Görmezden gelindi'}{f.detail?.note ? ` · ${f.detail.note}` : ''}
                                    </div>
                                  )}
                                </td>
                                <td style={portalStyle({ ...HUCRE, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: tutar ? TEXT : 'rgba(250,250,249,.35)', fontSize: 12.5, fontWeight: 600 })}>{tutar || '—'}</td>
                                <td style={portalStyle({ ...HUCRE, padding: '4px 8px' })}>
                                  {saltGorunum ? (
                                    <div className="text-center text-[10.5px]" style={portalStyle({ color: 'rgba(250,250,249,.45)' })} title="Mizan modülünün kendi kontrolü; işaretleme yapılmaz">Mizan</div>
                                  ) : (
                                    <div className="flex items-center justify-center gap-1">
                                      {(f.rowIndex || f.voucherKey) && (
                                        <IkonDugme title="Fiş satırını incele" onClick={() => p.focusFinding(f)}><ExternalLink size={13} /></IkonDugme>
                                      )}
                                      {fStatus !== 'RESOLVED' && <IkonDugme title="Çözüldü olarak işaretle" onClick={() => p.handleStatusChange(f, 'RESOLVED')}><CheckCircle2 size={13} /></IkonDugme>}
                                      {fStatus !== 'IGNORED' && <IkonDugme title="Görmezden gel" onClick={() => p.handleStatusChange(f, 'IGNORED')}><EyeOff size={13} /></IkonDugme>}
                                      {fStatus !== 'OPEN' && <IkonDugme title="Yeniden aç" onClick={() => p.handleStatusChange(f, 'OPEN')}><RotateCcw size={13} /></IkonDugme>}
                                    </div>
                                  )}
                                </td>
                              </tr>
                              {acikSatir && ayrintiVar && (
                                <tr style={portalStyle({ background: zemin })}>
                                  <td colSpan={sutun} style={portalStyle({ ...HUCRE, color: 'rgba(250,250,249,.72)', fontSize: 12, lineHeight: 1.55, paddingTop: 4 })}>{parca.ayrinti}</td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {!daraltildi && ozet && (
                          <tr>
                            <td colSpan={sutun} style={portalStyle({ ...HUCRE, background: 'rgba(0,0,0,.25)', color: 'rgba(250,250,249,.6)', fontSize: 11.5 })}>
                              {ozet.detail?.toplam != null && ozet.detail?.kalan != null
                                ? `Toplam ${ozet.detail.toplam} · en büyük ${Number(ozet.detail.toplam) - Number(ozet.detail.kalan)} tanesi gösterildi, ${ozet.detail.kalan} tanesi daha var`
                                : ozet.message}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Alan başlığı sayacı: renkli nokta + soluk yazı (renkli hap yok)
function Sayac({ n, renk, ad }: { n: number; renk: string; ad: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,.78)' })}>
      <span style={portalStyle({ ...NOKTA, background: renk })} />{n} {ad}
    </span>
  );
}

// İşlem düğmesi: tek nötr biçim; anlam ikonda
function IkonDugme({ title, onClick, children }: { title: string; onClick: () => void; children: any }) {
  return (
    <button onClick={onClick} title={title} className="h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors bg-white/[.07] hover:bg-white/[.14] border border-white/[.12]" style={portalStyle({ color: 'rgba(250,250,249,.82)' })}>
      {children}
    </button>
  );
}
