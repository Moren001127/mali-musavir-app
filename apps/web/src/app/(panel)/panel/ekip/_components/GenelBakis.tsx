'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Eye, Square } from 'lucide-react';
import type { Ajan, Pano, Vaka, VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import type { Kosu } from './kosular';
import { CARD_BG, GOLD, Ilerleme, KIRMIZI, MAVI, MUTED, OK, Rozet, TEXT, ajanRengi } from './Tema';
import { AJAN_UNVAN, ASAMALAR, SABLONLAR, adimAciklamasi, ajanKisaAd, ajanKisaltma, ajanTamAd, bugunMu, konuKisalt, sablonDoldur, saatKisa, sayacMetni, sonrakiAdim, sureKisa } from './ortak';

/* ─────────────────────────── Sade kart dili ───────────────────────────
 * Muzaffer Bey'in onayladığı taslak: _previews/ekip-sade (2026-09-19). Kutu sayısı 10 → 4; kutu içinde kutu YOK,
 * bölümler ince çizgiyle ayrılır. Renkler Bütçe / Cari Kasa paleti (Tema.tsx); altın yalnız başlık çizgisi, düğme ve bağlantı.
 */

/** Kart kenarı · bölüm ayracı · soluk etiket rengi (taslaktaki --border / --sep / --dim). */
export const SADE_KENAR = 'rgba(255,255,255,0.065)';
export const SADE_AYRAC = 'rgba(255,255,255,0.055)';
export const SOLUK = '#62626b';

const HEX = /^#([0-9a-f]{6})$/i;

/** Hex rengi verilen oranda beyazla karıştırır (gradyanın açık ucu); hex değilse tarayıcının color-mix'ine bırakır. */
export function acikTon(renk: string, beyaz = 0.45): string {
  const m = HEX.exec(renk.trim());
  if (!m) return `color-mix(in srgb, ${renk} ${Math.round((1 - beyaz) * 100)}%, #fff)`;
  const n = parseInt(m[1], 16);
  const kanal = (k: number) => Math.round(k + (255 - k) * beyaz).toString(16).padStart(2, '0');
  return `#${kanal(n >> 16)}${kanal((n >> 8) & 255)}${kanal(n & 255)}`;
}

/** Hex rengi verilen oranda siyahla karıştırır (altın düğmenin koyu ucu). */
export function koyuTon(renk: string, siyah = 0.14): string {
  const m = HEX.exec(renk.trim());
  if (!m) return `color-mix(in srgb, ${renk} ${Math.round((1 - siyah) * 100)}%, #000)`;
  const n = parseInt(m[1], 16);
  const kanal = (k: number) => Math.round(k * (1 - siyah)).toString(16).padStart(2, '0');
  return `#${kanal(n >> 16)}${kanal((n >> 8) & 255)}${kanal(n & 255)}`;
}

/** Hex renge saydamlık ekler ("#rrggbb" + "59"); hex değilse rengi olduğu gibi döndürür. */
function saydam(renk: string, alfa: string): string {
  return HEX.test(renk.trim()) ? `${renk}${alfa}` : renk;
}

/**
 * Sade kart: koyu zemin · 18px köşe · 1px ince kenar · yumuşak gölge · üstte kenarlardan 24px içeride ince altın çizgi.
 * Başlık 14px yarı kalın, sağda soluk açıklama ya da bağlantı; iç boşluk 24px yatay. `dolguYok` → bölümler (Bolum) kendi boşluğunu getirir.
 */
export function SadeKart({
  baslik,
  sag,
  renk = GOLD,
  dolguYok = false,
  className = '',
  style,
  children,
}: {
  baslik?: ReactNode;
  sag?: ReactNode;
  /** Üst çizginin rengi (Görev kartı canlı modda kırmızıya döner). */
  renk?: string;
  dolguYok?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section className={`relative min-w-0 overflow-hidden rounded-[18px] ${className}`} style={{ background: CARD_BG, border: `1px solid ${SADE_KENAR}`, boxShadow: '0 18px 44px rgba(0,0,0,0.24)', ...style }}>
      <div className="pointer-events-none absolute left-6 right-6 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${saydam(renk, '73')}, transparent)` }} />
      {baslik && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-6 pb-1.5 pt-[18px]">
          <h3 className="text-[14px] font-semibold" style={{ color: TEXT }}>
            {baslik}
          </h3>
          {sag}
        </header>
      )}
      {dolguYok ? children : <div className={baslik ? 'px-6 pb-5 pt-2' : 'px-6 py-5'}>{children}</div>}
    </section>
  );
}

/** Kart içi bölüm: 10.5px büyük harf aralıklı soluk etiket + sağda bağlantı/durum; bölümler ince çizgiyle ayrılır (ilk bölümde çizgi yok). */
export function Bolum({ baslik, sag, ilk = false, children }: { baslik: ReactNode; sag?: ReactNode; ilk?: boolean; children: ReactNode }) {
  return (
    <div className="px-6 py-3.5" style={ilk ? undefined : { borderTop: `1px solid ${SADE_AYRAC}` }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.2em]" style={{ color: SOLUK }}>
          {baslik}
        </span>
        {sag}
      </div>
      {children}
    </div>
  );
}

/** Altın metin bağlantısı ("Tümü →", "Dönem panosu →"). */
export function AltinBaglanti({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="text-[11px] font-semibold transition hover:brightness-125" style={{ color: GOLD }}>
      {children}
    </button>
  );
}

/** Küçük kenarlı düğme: renkli yazı + saydam kenar/zemin, 9px köşe (varsayılan altın; İzle mavi, Durdur kırmızı). */
export function MetinDugme({ onClick, children, renk = GOLD, title, disabled, className = '' }: { onClick: () => void; children: ReactNode; renk?: string; title?: string; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-[9px] px-2.5 py-[5px] text-[11.5px] font-semibold transition hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={{ color: renk, border: `1px solid ${saydam(renk, '47')}`, background: saydam(renk, '12') }}
    >
      {children}
    </button>
  );
}

/** Gradyan avatar: koyu baş harfler, renkten açık tonuna geçiş, hafif parıltı; `halka` → 2px mavi halka (çalışıyor). */
export function GradyanAvatar({ kisaltma, renk, boyut = 28, halka = false, nabiz = false, title, className = '' }: { kisaltma: string; renk: string; boyut?: number; halka?: boolean; nabiz?: boolean; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-extrabold ${nabiz ? 'animate-pulse' : ''} ${className}`}
      style={{
        width: boyut,
        height: boyut,
        fontSize: Math.max(9.5, Math.round(boyut * 0.29 * 2) / 2),
        color: '#0f0d0b',
        background: `linear-gradient(135deg, ${renk}, ${acikTon(renk)})`,
        boxShadow: `0 0 14px ${saydam(renk, '59')}`,
        outline: halka ? `2px solid ${MAVI}` : undefined,
        outlineOffset: halka ? 3 : undefined,
      }}
    >
      {kisaltma}
    </span>
  );
}

/** Mükellef ünvanından iki baş harf ("ADEM CAN" → "AC", "ÖZ ELA" → "ÖE"). */
function basHarfler(unvan: string): string {
  const k = unvan.trim().split(/\s+/).filter(Boolean);
  const s = k.length >= 2 ? `${k[0][0]}${k[1][0]}` : (k[0] || '?').slice(0, 2);
  return s.toLocaleUpperCase('tr-TR');
}

/* ─────────────────────────── Şu an ─────────────────────────── */

type CalisanIs = {
  anahtar: string;
  vaka?: Vaka;
  kosu?: Kosu;
  mukellef: string;
  konu: string;
  ajanId: string;
  basladi: number;
  kuru: boolean;
  asama: { ad: string; no: number };
  suAn: string;
};

/**
 * Şu an çalışan işler: yerel SSE koşusu (Koordinatör) + sunucuda süren vakalar (personel).
 * Her satır: avatar (mavi, nabızlı) · mükellef — konu · personel · süre · kuru/canlı · ilerleme çubuğu · "Şu an: …" · İzle / Durdur.
 */
function SuAnBolumu({
  kosu,
  vakalar,
  ajanAd,
  mukellefAd,
  onIzle,
  onDurdur,
}: {
  kosu: Kosu | undefined;
  vakalar: Vaka[] | undefined;
  ajanAd: (id: string) => string;
  mukellefAd: (id?: string | null) => string | undefined;
  onIzle: (vakaId: string | null) => void;
  onDurdur: (hedef: { kosu?: Kosu; vaka?: Vaka }) => void;
}) {
  const [simdi, setSimdi] = useState(() => Date.now());
  const isler = useMemo<CalisanIs[]>(() => {
    const out: CalisanIs[] = [];
    const yerelVakaId = kosu && !kosu.bitti ? kosu.vakaId || kosu.isId : undefined;
    if (kosu && !kosu.bitti) {
      const calisanAdim = kosu.adimlar.find((a) => a.tip === 'arac' && a.durum === 'calisiyor');
      const devir = kosu.adimlar.some((a) => a.tip === 'arac' && a.ad === 'ekip_ajan_baslat');
      out.push({
        anahtar: 'yerel',
        kosu,
        mukellef: kosu.kaynak === 'sabahOzeti' ? 'Sabah özeti' : mukellefAd(kosu.taxpayerId) || 'Ofis geneli',
        konu: kosu.kaynak === 'sabahOzeti' ? 'Koordinatör bugünü topluyor' : konuKisalt(kosu.gorev, 80),
        ajanId: 'koordinator',
        basladi: kosu.basladi,
        kuru: kosu.dryRun,
        asama: devir ? { ad: 'Personelde', no: 3 } : kosu.adimlar.length ? { ad: 'Bilgi toplanıyor', no: 2 } : { ad: 'Görev alındı', no: 1 },
        suAn: calisanAdim ? `Koordinatör: ${adimAciklamasi(calisanAdim.ad, calisanAdim.args, mukellefAd, ajanAd).baslik}` : kosu.isId ? 'Koordinatör düşünüyor' : 'Koordinatör göreve başlıyor',
      });
    }
    for (const v of vakalar || []) {
      if (v.kutu !== 'suruyor') continue;
      if (yerelVakaId && (v.vakaId === yerelVakaId || v.adimlar.some((a) => a.tip === 'is' && a.isId === yerelVakaId))) continue;
      const isAdimlari = v.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
      const kosan = isAdimlari.find((a) => a.durum === 'running') || isAdimlari.find((a) => a.durum === 'pending');
      const ajanId = kosan?.ajanId || v.kimde.ajanId;
      const personelde = !!kosan && kosan.ajanId !== 'koordinator';
      out.push({
        anahtar: v.vakaId,
        vaka: v,
        mukellef: v.mukellef?.ad || 'Ofis geneli',
        konu: v.konu,
        ajanId,
        basladi: new Date(kosan?.baslangic || v.olusturuldu).getTime(),
        kuru: v.kuru,
        asama: personelde ? { ad: 'Personelde', no: 3 } : { ad: 'Bilgi toplanıyor', no: 2 },
        suAn: kosan ? `${ajanTamAd(kosan.ajanId, ajanAd(kosan.ajanId))} çalışıyor — ${kosan.baslik}` : 'Sırada',
      });
    }
    return out;
  }, [kosu, vakalar, ajanAd, mukellefAd]);

  useEffect(() => {
    if (!isler.length) return;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isler.length]);

  return (
    <Bolum
      ilk
      baslik="Şu an"
      sag={
        <span className="text-[11px] font-medium" style={{ color: isler.length ? MAVI : MUTED }}>
          {isler.length ? `${isler.length} sürüyor` : 'kadro boşta'}
        </span>
      }
    >
      {!isler.length ? (
        <div className="text-[12.5px]" style={{ color: MUTED }}>
          Çalışan iş yok. Görev verdiğinizde ilerleme burada görünür.
        </div>
      ) : (
        <div className="-mt-1 flex flex-col">
          {isler.map((is, i) => (
            <div key={is.anahtar} className="py-2.5" style={i ? { borderTop: `1px solid ${SADE_AYRAC}` } : undefined}>
              <div className="flex items-center gap-3">
                <GradyanAvatar kisaltma={ajanKisaltma(is.ajanId)} renk={MAVI} boyut={28} nabiz title={ajanTamAd(is.ajanId, ajanAd(is.ajanId))} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold" style={{ color: TEXT }} title={`${is.mukellef} — ${is.konu}`}>
                    {konuKisalt(is.mukellef, 32)} — {is.konu}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: MUTED }}>
                    {ajanKisaAd(is.ajanId, ajanAd(is.ajanId))} · <span className="tabular-nums" style={{ color: MAVI }}>{sayacMetni(Math.max(0, simdi - is.basladi))}</span> · {is.kuru ? 'kuru test' : <span style={{ color: KIRMIZI }}>canlı</span>}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: MUTED }}>
                <span className="w-24 flex-shrink-0">{is.asama.ad}</span>
                <Ilerleme yuzde={(is.asama.no / 4) * 100} />
                <span className="tabular-nums">{is.asama.no}/4</span>
              </div>
              <div className="mt-1.5 truncate text-[12px] leading-relaxed" style={{ color: TEXT }} title={is.suAn}>
                <b className="font-semibold" style={{ color: MAVI }}>
                  Şu an:
                </b>{' '}
                {is.suAn}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <MetinDugme renk={MAVI} onClick={() => onIzle(is.vaka?.vakaId || is.kosu?.vakaId || is.kosu?.isId || null)}>
                  <Eye size={11} /> İzle
                </MetinDugme>
                {!(is.kosu && is.kosu.kaynak === 'sabahOzeti') && (
                  <MetinDugme renk={KIRMIZI} onClick={() => onDurdur({ kosu: is.kosu, vaka: is.vaka })}>
                    <Square size={10} /> Durdur
                  </MetinDugme>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Bolum>
  );
}

/* ─────────────────────────── Bugün biten · Koordinatör öneriyor ─────────────────────────── */

export interface Oneri {
  taxpayerId: string;
  unvan: string;
  ajanId: string;
  sablonId: string;
  metin: string;
  neden: string;
  donem: string;
}

/**
 * Koordinatör'ün önerileri — dönem panosundaki sıradaki adımlardan (kontrol → hazırla → işle sırasıyla);
 * bugün zaten işi olan mükellefler atlanır. Düğme görev kutusunu doldurur, ÇALIŞTIRMAZ (pano ile aynı kural).
 */
export function onerileriCikar(pano: Pano | undefined, donem: string | null, mesgulTaxpayerIds: Set<string>, tavan = 4): Oneri[] {
  if (!pano || !donem) return [];
  const oncelik: Record<number, number> = { 3: 0, 4: 1, 2: 2, 0: 3 };
  const out: Array<Oneri & { sira: number }> = [];
  for (const s of pano.satirlar) {
    if (mesgulTaxpayerIds.has(s.taxpayerId)) continue;
    const d = s.donemler.find((x) => x.donem === donem);
    const kayitVar = s.kayitVar?.[donem] ?? !!d;
    const adim = sonrakiAdim(d?.asamalar, kayitVar);
    if (!adim.sablonId || !adim.ajanId || !(adim.sira in oncelik)) continue;
    const tamam = ASAMALAR.filter((a) => d?.asamalar?.[a.key] === 'tamam').map((a) => a.ad.toLocaleLowerCase('tr-TR'));
    const neden = adim.sira === 0 ? 'Aylık takip kaydı açılmamış' : tamam.length ? `${tamam.join(', ')} tamam` : 'Henüz aşama tamamlanmadı';
    out.push({ taxpayerId: s.taxpayerId, unvan: s.unvan, ajanId: adim.ajanId, sablonId: adim.sablonId, metin: adim.metin.replace(/^(.*?)\s*\(.*\)$/, '$1'), neden, donem, sira: oncelik[adim.sira] });
  }
  return out.sort((a, b) => a.sira - b.sira || a.unvan.localeCompare(b.unvan, 'tr')).slice(0, tavan);
}

/** Öneri düğmesinin adı — Dönem panosuyla aynı sözcükler: İşle / Kontrol et / Hazırla / Araştır. */
function oneriDugmeAdi(o: Oneri): string {
  if (o.sablonId === 'fatura-isle') return 'İşle';
  if (o.sablonId === 'kayit-yok') return 'Araştır';
  if (o.sablonId === 'kdv-kontrol') return /kontrol/i.test(o.metin) ? 'Kontrol et' : 'Hazırla';
  return 'Hazırla';
}

function bitisRozeti(v: Vaka): { ad: string; renk: string } {
  if (v.durum === 'hata') return { ad: 'yarım', renk: KIRMIZI };
  if (v.kimde.ajanId === 'koordinator' && v.adimlar.filter((a) => a.tip === 'is').length === 1) return { ad: 'cevaplandı', renk: MUTED };
  return { ad: 'bitti', renk: OK };
}

function BugunBolumu({
  vakalar,
  oneriler,
  ajanAd,
  onSec,
  onTumu,
  onTaslak,
  onPano,
  yukleniyor,
  hata,
  panoYukleniyor,
  panoHata,
}: {
  vakalar: Vaka[] | undefined;
  oneriler: Oneri[];
  ajanAd: (id: string) => string;
  onSec: (vakaId: string) => void;
  onTumu: () => void;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
  onPano: () => void;
  yukleniyor?: boolean;
  hata?: unknown;
  panoYukleniyor?: boolean;
  panoHata?: unknown;
}) {
  const bitenler = useMemo(() => (vakalar || []).filter((v) => v.kutu === 'bitti' && bugunMu(v.guncellendi)).sort((a, b) => new Date(b.guncellendi).getTime() - new Date(a.guncellendi).getTime()).slice(0, 3), [vakalar]);
  return (
    <>
      <Bolum ilk baslik="Son işler" sag={<AltinBaglanti onClick={onTumu}>Tümü →</AltinBaglanti>}>
        {!bitenler.length ? (
          <div className="text-[12.5px]" style={{ color: MUTED }}>
            {yukleniyor ? 'İş akışı yükleniyor…' : hata ? 'Biten iş bilgisi alınamadı.' : 'Bugün henüz biten iş yok.'}
          </div>
        ) : (
          <div className="-mt-1 flex flex-col">
            {bitenler.map((v, i) => {
              const isAdimlari = v.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
              const sonPersonel = [...isAdimlari].reverse().find((a) => a.ajanId !== 'koordinator');
              const ajanId = sonPersonel?.ajanId || 'koordinator';
              const r = bitisRozeti(v);
              const sonIs = isAdimlari[isAdimlari.length - 1];
              const sure = sonIs?.baslangic && sonIs?.bitis ? sureKisa(new Date(sonIs.bitis).getTime() - new Date(sonIs.baslangic).getTime()) : '';
              const ozet = v.durum === 'hata' || sonIs?.hata ? 'İş tamamlanamadı. Ayrıntılar için açın.' : sonIs?.raporOzet ? konuKisalt(sonIs.raporOzet, 70) : '';
              return (
                <button
                  key={v.vakaId}
                  type="button"
                  onClick={() => onSec(v.vakaId)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-white/[0.02]"
                  style={i ? { borderTop: `1px solid ${SADE_AYRAC}` } : undefined}
                  title="Raporu aç"
                >
                  <GradyanAvatar kisaltma={ajanKisaltma(ajanId)} renk={ajanRengi(ajanId)} boyut={28} title={ajanTamAd(ajanId, ajanAd(ajanId))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold" style={{ color: TEXT }} title={v.mukellef?.ad ? `${v.mukellef.ad} — ${v.konu}` : v.konu || 'Ofis geneli'}>
                      {v.mukellef?.ad ? konuKisalt(v.mukellef.ad, 32) : v.konu || 'Ofis geneli'}
                      {v.mukellef?.ad ? ` — ${v.konu}` : ''}
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: MUTED }}>
                      {saatKisa(v.guncellendi).slice(0, 5)}
                      {ozet ? ` · ${ozet}` : ''}
                      {sure ? ` · ${sure}` : ''}
                    </span>
                  </span>
                  <Rozet metin={r.ad} renk={r.renk} />
                </button>
              );
            })}
          </div>
        )}
      </Bolum>

      <Bolum baslik="Öneriler" sag={<AltinBaglanti onClick={onPano}>Dönem panosu →</AltinBaglanti>}>
        {!oneriler.length ? (
          <div className="text-[12.5px]" style={{ color: MUTED }}>
            {panoYukleniyor ? 'Öneriler yükleniyor…' : panoHata ? 'Öneriler alınamadı.' : 'Panoya göre sırada bekleyen adım yok.'}
          </div>
        ) : (
          <div className="-mt-1 flex flex-col">
            {oneriler.slice(0, 2).map((o, i) => {
              const sablon = SABLONLAR.find((s) => s.id === o.sablonId);
              return (
                <div key={o.taxpayerId} className="flex items-center gap-3 py-[9px]" style={i ? { borderTop: `1px solid ${SADE_AYRAC}` } : undefined}>
                  <span className="shrink-0 text-[10px] font-semibold" style={{ color: GOLD }} aria-hidden="true">{basHarfler(o.unvan)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold" style={{ color: TEXT }} title={o.unvan}>
                      {konuKisalt(o.unvan, 32)}
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: MUTED }} title={`${o.metin} · ${o.neden}`}>
                      {o.metin}
                    </span>
                  </span>
                  {sablon && (
                    <MetinDugme
                      title={`${o.unvan} için görev taslağı hazırla`}
                      onClick={() => onTaslak({ ajanId: o.ajanId, gorev: sablonDoldur(sablon.gorev, o.unvan, o.donem), taxpayerId: o.taxpayerId, dryRun: true, kaynak: 'oneri' })}
                    >
                      {oneriDugmeAdi(o)}
                    </MetinDugme>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Bolum>
    </>
  );
}

/* ─────────────────────────── Akış kartı ─────────────────────────── */

/**
 * Çalışan işler önceliklidir; çalışma sırasında son işler ve öneriler isteğe bağlı açılır.
 */
export function AkisKutu({
  kosu,
  vakalar,
  oneriler,
  ajanAd,
  mukellefAd,
  onIzle,
  onDurdur,
  onSec,
  onTumu,
  onTaslak,
  onPano,
  className = '',
  yukleniyor,
  hata,
  panoYukleniyor,
  panoHata,
}: {
  kosu: Kosu | undefined;
  vakalar: Vaka[] | undefined;
  oneriler: Oneri[];
  ajanAd: (id: string) => string;
  mukellefAd: (id?: string | null) => string | undefined;
  onIzle: (vakaId: string | null) => void;
  onDurdur: (hedef: { kosu?: Kosu; vaka?: Vaka }) => void;
  onSec: (vakaId: string) => void;
  onTumu: () => void;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
  onPano: () => void;
  className?: string;
  yukleniyor?: boolean;
  hata?: unknown;
  panoYukleniyor?: boolean;
  panoHata?: unknown;
}) {
  const calisanVar = !!(kosu && !kosu.bitti) || !!vakalar?.some((v) => v.kutu === 'suruyor');
  const digerIsler = <BugunBolumu vakalar={vakalar} oneriler={oneriler} ajanAd={ajanAd} onSec={onSec} onTumu={onTumu} onTaslak={onTaslak} onPano={onPano} yukleniyor={yukleniyor} hata={hata} panoYukleniyor={panoYukleniyor} panoHata={panoHata} />;

  return (
    <SadeKart dolguYok className={`py-1 ${className}`}>
      {!!hata && <p role="alert" className="px-6 py-3 text-[12px]" style={{ color: KIRMIZI }}>İş akışı yenilenemedi. Lütfen yeniden deneyin.</p>}
      {calisanVar ? (
        <>
          <SuAnBolumu kosu={kosu} vakalar={vakalar} ajanAd={ajanAd} mukellefAd={mukellefAd} onIzle={onIzle} onDurdur={onDurdur} />
          <details style={{ borderTop: `1px solid ${SADE_AYRAC}` }}>
            <summary className="cursor-pointer px-6 py-3 text-[12px] font-medium" style={{ color: GOLD }}>Son işler ve öneriler</summary>
            {digerIsler}
          </details>
        </>
      ) : yukleniyor ? (
        <Bolum ilk baslik="İş akışı"><p role="status" className="text-[12.5px]" style={{ color: MUTED }}>İş akışı yükleniyor…</p></Bolum>
      ) : digerIsler}
    </SadeKart>
  );
}


/** Genel bakıştaki sade kadro şeridi; tüm personel sunucudan gelir. */
export function KadroSeridi({ ajanlar, kosular, yukleniyor, onKadro }: { ajanlar: Ajan[]; kosular: Map<string, Kosu>; yukleniyor: boolean; onKadro: () => void }) {
  const calisiyor = (ajan: Ajan) => !!ajan.suAn || !!(kosular.get(ajan.id) && !kosular.get(ajan.id)?.bitti);
  const calisan = ajanlar.filter(calisiyor).length;
  return (
    <SadeKart baslik="Kadro" sag={<span className="text-[11.5px]" style={{ color: MUTED }}>{ajanlar.length} personel · {calisan ? `${calisan} çalışıyor` : ajanlar.length ? 'hepsi boşta' : 'kadro bekleniyor'} · <AltinBaglanti onClick={onKadro}>Personel kartları →</AltinBaglanti></span>}>
      {yukleniyor && !ajanlar.length ? <p role="status" className="text-[12px]" style={{ color: MUTED }}>Kadro yükleniyor…</p> : !ajanlar.length ? <p className="text-[12px]" style={{ color: MUTED }}>Gösterilecek personel yok.</p> : (
        <div className="grid grid-cols-3 gap-x-2 gap-y-4 pt-2 sm:grid-cols-6 xl:grid-cols-12">
          {ajanlar.map((ajan) => (
            <button key={ajan.id} type="button" onClick={onKadro} title={`${ajan.ad} — ${ajan.unvan}${calisiyor(ajan) ? ' · çalışıyor' : ''}`} className="flex min-w-0 flex-col items-center rounded-lg px-0.5 py-1 text-center transition hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: GOLD }}>
              <GradyanAvatar kisaltma={ajanKisaltma(ajan.id, ajan.ad)} renk={ajanRengi(ajan.id)} boyut={40} halka={calisiyor(ajan)} className="mb-2" />
              <span className="w-full break-words text-[11px] font-semibold leading-tight" style={{ color: TEXT }}>{ajanKisaAd(ajan.id, ajan.ad)}</span>
              <span className="mt-0.5 w-full break-words text-[10.5px] leading-tight" style={{ color: calisiyor(ajan) ? MAVI : MUTED }}>{calisiyor(ajan) ? 'Çalışıyor' : AJAN_UNVAN[ajan.id] || ajan.unvan}</span>
            </button>
          ))}
        </div>
      )}
    </SadeKart>
  );
}
