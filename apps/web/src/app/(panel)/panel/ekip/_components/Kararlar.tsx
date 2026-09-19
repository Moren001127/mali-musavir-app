'use client';
import './genel-redesign.css';
import { portalStyle } from '@/lib/portal-theme';


import { useMemo, useState } from 'react';
import { Check, Loader2, MessageSquareReply, Send, XCircle } from 'lucide-react';
import { istekKapat, onayla, reddet, type AcikKalem, type EkipOnay, type Vaka } from '@/lib/ekip';
import type { Adim, Kosu, KosularApi } from './kosular';
import { OnayTeyit, hedefMetni } from './OnayBekleyenler';
import { Alinti, Avatar, CARD_BORDER, Dugme, GOLD, KIRMIZI, MUTED, OK, ROW_SEP, TEXT } from './Tema';
import { SADE_AYRAC } from './GenelBakis';
import { ajanKisaltma, ajanTamAd, aracAdi, kalanSure } from './ortak';

/* ─────────────────────────── açık kalem (onay / karar / istek) ─────────────────────────── */

/**
 * Açık kalem — üç tür:
 *  - PRV onayı (dışarı mesaj): Onayla ve gönder / Reddet (kart içi teyit).
 *  - KARAR (bildirim, tur 'onay'): personel "karar sizde" dedi → kararınızı yazıp gönderirsiniz ya da kapatırsınız.
 *  - İSTEK (bildirim, tur 'istek'): sizden belge/işlem → Yapıldı; isterseniz not da yazarsınız.
 * Görünüm: satır (avatar · başlık · sağda kimlik/kalan süre) → altın alıntı (mesaj metni) → düğmeler.
 */
export function AcikKalemKarti({
  kalem,
  onBitti,
  onCevapla,
  calisiyor,
  ustBaslik,
  ajanId,
  ajanAd,
  onay,
  mukellefAd,
}: {
  kalem: AcikKalem;
  onBitti: () => void;
  onCevapla: (metin: string) => boolean | void;
  calisiyor: boolean;
  /** Genel bakışta mükellef adı (iş panelinde gerek yok). */
  ustBaslik?: string | null;
  ajanId?: string;
  ajanAd?: (id: string) => string;
  /** PRV kaydı (kalan süre, hedef) — varsa. */
  onay?: EkipOnay | null;
  mukellefAd?: (id?: string | null) => string | undefined;
}) {
  const [teyit, setTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [cevap, setCevap] = useState('');
  const onayMi = kalem.tip === 'onay';
  const kararMi = onayMi && kalem.kaynak === 'bildirim';
  const cevapGonder = () => {
    if (!cevap.trim()) return;
    if (onCevapla(cevap.trim()) === false) return;
    setCevap('');
    setSonuc(calisiyor ? 'Cevabınız iş bitince gönderilmek üzere sıraya alındı' : 'Cevabınız işleme alındı');
  };
  const yap = async (fn: () => Promise<{ ok: boolean; error?: string; zatenKapali?: boolean }>, okMetin: string) => {
    if (mesgul) return;
    setMesgul(true);
    try {
      const r = await fn();
      setSonuc(r.ok ? (r.zatenKapali ? 'Zaten kapalıydı' : okMetin) : `Hata: ${r.error || 'olmadı'}`);
    } catch (e: any) {
      setSonuc(`Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      setTeyit(false);
      onBitti();
    }
  };
  const kalan = onay?.expiresAt ? kalanSure(onay.expiresAt) : null;
  const hedef = onay && mukellefAd ? hedefMetni(onay, mukellefAd) : '';
  const turAd = kararMi ? 'kararınız bekleniyor' : onayMi ? 'onayınız bekleniyor' : 'sizden istenen';
  const baslik = `${ustBaslik ? `${ustBaslik} — ` : ''}${kararMi ? 'kararınız bekleniyor' : onayMi ? `${onay?.arac ? aracAdi(onay.arac) : 'dışarı mesaj'} için onayınız` : 'sizden istenen'}`;
  const altSatir = onayMi && !kararMi ? (hedef ? `→ ${hedef}` : '') : kalem.baslik;

  return (
    <div className="eg-karar py-3" style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
      <div className="flex items-start gap-2.5">
        {ajanId && <Avatar kisaltma={ajanKisaltma(ajanId)} ton="gold" boyut={26} title={ajanAd ? ajanTamAd(ajanId, ajanAd(ajanId)) : ajanId} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 text-[12.8px] font-semibold" style={portalStyle({ color: TEXT })} title={kalem.baslik}>
              {baslik}
            </span>
            <span className="ml-auto text-[11px] tabular-nums" style={portalStyle({ color: MUTED })}>
              {onayMi && !kararMi ? `#PRV-${kalem.id.slice(0, 8)}` : ''}
              {kalan && kalan.ms > 0 ? ` · ${kalan.metin} kaldı` : ''}
            </span>
          </div>
          {altSatir && (
            <div className="mt-0.5 text-[12px] leading-relaxed" style={portalStyle({ color: onayMi && !kararMi ? MUTED : TEXT })}>
              {altSatir}
            </div>
          )}
          {kalem.confirmationText && !sonuc && <Alinti className="eg-karar-alinti mt-2">{kalem.confirmationText}</Alinti>}
          {!onayMi && !sonuc && <div className="mt-1 text-[11.5px]" style={portalStyle({ color: MUTED })}>Yapınca “Yapıldı”ya basın; Koordinatör işe kaldığı yerden devam eder.</div>}
          {sonuc ? (
            <div className="mt-2 text-[12.5px] font-semibold" style={portalStyle({ color: sonuc.startsWith('Hata') ? KIRMIZI : OK })}>
              {sonuc}
            </div>
          ) : (
            <div className="mt-2.5 flex flex-col gap-2">
              {kalem.kaynak === 'bildirim' && (
                <input
                  value={cevap}
                  onChange={(e) => setCevap(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && cevap.trim()) {
                      e.preventDefault();
                      cevapGonder();
                    }
                  }}
                  placeholder={kararMi ? 'Kararınızı yazın (ör. "kilitle", "beklet")…' : 'İsterseniz not yazın (ör. "görselleri yükledim, devam et")…'}
                  aria-label={kararMi ? 'Kararınız' : 'İş için notunuz'}
                  className="eg-karar-cevap h-9 min-w-0 rounded-[10px] px-3 text-[12.5px] outline-none"
                  style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: `1px solid ${CARD_BORDER}`, color: TEXT })}
                />
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {kararMi ? (
                  <>
                    <Dugme className="eg-karar-birincil" tur="birincil" disabled={!cevap.trim()} onClick={cevapGonder}>
                      <MessageSquareReply size={13} /> {calisiyor ? 'Kararı bitince gönder' : 'Kararı gönder'}
                    </Dugme>
                    <Dugme tur="sade" disabled={mesgul} onClick={() => yap(() => istekKapat(kalem.id), 'Kapatıldı')}>
                      <Check size={12} /> Kapat
                    </Dugme>
                  </>
                ) : onayMi ? (
                  <>
                    <Dugme className="eg-karar-birincil" tur="birincil" disabled={mesgul || teyit} onClick={() => setTeyit(true)}>
                      {mesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Onayla ve gönder
                    </Dugme>
                    <Dugme tur="tehlike" disabled={mesgul} onClick={() => yap(() => reddet(kalem.id, 'Ekip ekranından reddedildi'), 'Reddedildi')}>
                      <XCircle size={12} /> Reddet
                    </Dugme>
                  </>
                ) : (
                  <>
                    <Dugme className="eg-karar-birincil" tur="birincil" disabled={mesgul} onClick={() => yap(() => istekKapat(kalem.id), 'Yapıldı ✓')}>
                      {mesgul ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Yapıldı
                    </Dugme>
                    {cevap.trim() && (
                      <Dugme onClick={cevapGonder}>
                        <MessageSquareReply size={13} /> Notu gönder
                      </Dugme>
                    )}
                    <Dugme tur="sade" disabled={mesgul} onClick={() => yap(() => istekKapat(kalem.id), 'Kapatıldı')}>
                      Kapat
                    </Dugme>
                  </>
                )}
                <span className="ml-auto text-[10.5px]" style={portalStyle({ color: MUTED })}>
                  {turAd}
                </span>
              </div>
              {teyit && <OnayTeyit metin={<>Bu mesaj <b>GERÇEKTEN</b> gidecek → #{kalem.id}</>} mesgul={mesgul} onEvet={() => yap(() => onayla(kalem.id), 'Gönderildi ✓')} onVazgec={() => setTeyit(false)} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Yerel koşu içinde açılan onay (SSE 'onay' olayı) — kart içi teyitle onayla/reddet. */
export function YerelOnay({ adim, kosu, kosular, onBitti }: { adim: Adim; kosu: Kosu; kosular: KosularApi; onBitti: () => void }) {
  const [teyit, setTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const sonucYaz = (sonuc: string) => {
    kosular.guncelle(kosu.ajanId, (k) => ({ ...k, adimlar: k.adimlar.map((a) => (a.previewId === adim.previewId ? { ...a, sonuc } : a)) }));
    onBitti();
  };
  const yap = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMetin: string) => {
    if (mesgul) return;
    setMesgul(true);
    try {
      const r = await fn();
      sonucYaz(r.ok ? okMetin : `Hata: ${r.error || 'olmadı'}`);
    } catch (e: any) {
      sonucYaz(`Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      setTeyit(false);
    }
  };
  return (
    <div className="eg-karar py-3" style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
      <div className="flex items-baseline gap-2">
        <span className="text-[12.8px] font-semibold" style={portalStyle({ color: TEXT })}>
          Onayınızı bekliyor — {aracAdi(adim.ad)}
        </span>
        <span className="ml-auto text-[11px] tabular-nums" style={portalStyle({ color: MUTED })}>
          #{adim.previewId}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Dugme className="eg-karar-birincil" tur="birincil" disabled={mesgul || teyit} onClick={() => setTeyit(true)}>
          <Send size={12} /> Onayla ve gönder
        </Dugme>
        <Dugme tur="tehlike" disabled={mesgul} onClick={() => yap(() => reddet(adim.previewId!, 'Ekip ekranından reddedildi'), 'Reddedildi')}>
          Reddet
        </Dugme>
      </div>
      {teyit && <OnayTeyit metin={<>Bu mesaj <b>GERÇEKTEN</b> gidecek → #{adim.previewId}</>} mesgul={mesgul} onEvet={() => yap(() => onayla(adim.previewId!), 'Gönderildi ✓')} onVazgec={() => setTeyit(false)} />}
    </div>
  );
}

/* ─────────────────────────── Genel bakış: "Sizden beklenen" kutusu ─────────────────────────── */

export interface BekleyenKalem {
  vaka: Vaka;
  kalem: AcikKalem;
  ajanId: string;
}

/** Tüm vakalardaki açık kalemler (onay + istek), en yeni önce. */
export function bekleyenKalemler(vakalar: Vaka[] | undefined): BekleyenKalem[] {
  const out: BekleyenKalem[] = [];
  for (const v of vakalar || []) {
    if (!v.acikKalemler?.length) continue;
    const isAdimlari = v.adimlar.filter((a) => a.tip === 'is') as Array<{ ajanId: string }>;
    const sonPersonel = [...isAdimlari].reverse().find((a) => a.ajanId !== 'koordinator');
    const ajanId = sonPersonel?.ajanId || (v.kimde.ajanId !== 'siz' ? v.kimde.ajanId : 'koordinator');
    for (const k of v.acikKalemler) out.push({ vaka: v, kalem: k, ajanId });
  }
  return out.sort((a, b) => new Date(b.vaka.guncellendi).getTime() - new Date(a.vaka.guncellendi).getTime());
}

export function SizdenBeklenenKutu({
  kalemler,
  onaylar,
  ajanAd,
  mukellefAd,
  onBitti,
  onCevapla,
  calisiyor,
  yukleniyor,
  hata,
  className = '',
}: {
  kalemler: BekleyenKalem[];
  onaylar: EkipOnay[];
  ajanAd: (id: string) => string;
  mukellefAd: (id?: string | null) => string | undefined;
  onBitti: () => void;
  onCevapla: (vaka: Vaka, metin: string) => boolean | void;
  calisiyor: boolean;
  yukleniyor: boolean;
  hata?: unknown;
  className?: string;
}) {
  const onayHaritasi = useMemo(() => new Map(onaylar.map((o) => [o.previewId, o])), [onaylar]);
  return (
    <section aria-label="Sizden beklenen" className={`eg-kararlar mt-3.5 ${className}`}>
      {!!hata && <p role="alert" className="mb-2 text-[12px]" style={portalStyle({ color: KIRMIZI })}>Kararlar yenilenemedi. {hata instanceof Error ? hata.message : 'Lütfen yeniden deneyin.'}</p>}
      {kalemler.length > 0 && <div className="eg-kararlar-baslik mb-3 flex items-center justify-between border-t pt-3 text-[13px]" style={portalStyle({ color: GOLD, borderColor: SADE_AYRAC })}><span>Sizden beklenen</span><span>{kalemler.length} bekliyor</span></div>}
      {yukleniyor && !kalemler.length ? (
        <div className="py-4 text-[12px]" style={portalStyle({ color: MUTED })}>
          Yükleniyor…
        </div>
      ) : !kalemler.length ? (
        <div className="flex items-center gap-2.5 text-[12.5px]" style={portalStyle({ color: MUTED })}>
          {!hata && <Check size={18} className="rounded-full p-0.5" style={portalStyle({ color: OK, background: `${OK}1f`, border: `1px solid ${OK}4d` })} />}
          {hata ? 'Bekleyen karar bilgisi alınamadı.' : 'Sizden beklenen karar yok.'}
        </div>
      ) : (
        <div className="-mt-3">
          {kalemler.map(({ vaka, kalem, ajanId }) => (
            <details key={`${vaka.vakaId}-${kalem.tip}-${kalem.id}`} className="eg-karar-detay group border-t py-1" style={portalStyle({ borderColor: ROW_SEP })}>
              <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={portalStyle({ background: GOLD })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium" style={portalStyle({ color: TEXT })} title={vaka.mukellef?.ad || 'Ofis geneli'}>{vaka.mukellef?.ad || 'Ofis geneli'}</span>
                  <span className="block truncate text-[11.5px]" style={portalStyle({ color: MUTED })} title={kalem.baslik}>{kalem.baslik}</span>
                </span>
                <span className="shrink-0 text-[11px]" style={portalStyle({ color: GOLD })}><span className="group-open:hidden">İncele</span><span className="hidden group-open:inline">Gizle</span></span>
              </summary>
            <AcikKalemKarti
              kalem={kalem}
              ustBaslik={vaka.mukellef?.ad || 'Ofis geneli'}
              ajanId={ajanId}
              ajanAd={ajanAd}
              onay={kalem.kaynak === 'PRV' ? onayHaritasi.get(kalem.id) || null : null}
              mukellefAd={mukellefAd}
              onBitti={onBitti}
              onCevapla={(m) => onCevapla(vaka, m)}
              calisiyor={calisiyor}
            />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
