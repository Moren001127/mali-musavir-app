'use client';

import { useState } from 'react';
import { ShieldAlert, ChevronDown, ChevronUp, Wrench, Zap } from 'lucide-react';
import type { Ajan, IsDosyasi } from '@/lib/ekip';
import { EKIP_ACCENT, RENK, ajanKisaltma, ajanRengi, ajanYuzeyRengi, aracAdi, goreliSaat, ikonStili, isDurumu, kartArkaPlan, modelRengi, seritStili } from './ortak';

/**
 * Seçili ajanın kimlik kartı: açıklama, kademe dökümü, onay noktaları, tetikler, son 5 koşu, araç listesi.
 * Mobilde başlığa tık ile katlanır (varsayılan kapalı).
 */
export function AjanDetayKarti({ ajan, isler, onIsAc }: { ajan: Ajan | undefined; isler: IsDosyasi[]; onIsAc: (isId: string) => void }) {
  const [mobilAcik, setMobilAcik] = useState(false);
  const [aciklamaAcik, setAciklamaAcik] = useState(false);
  const [araclarAcik, setAraclarAcik] = useState(false);

  if (!ajan) return null;
  // Kart/şerit/unvan/'devamı'/Tetikler/Araçlar → yüzey rengi (§0.3/§8); yalnız 36px ikon ajan rengi.
  const renk = ajanYuzeyRengi(ajan.id);
  const ikonRenk = ajanRengi(ajan.id);
  const k = ajan.kademeOzeti || { oku: 0, portal_yaz: 0, luca_yaz: 0, disari_gonder: 0 };
  const toplam = Math.max(1, k.oku + k.portal_yaz + k.luca_yaz + k.disari_gonder);
  const son5 = isler.filter((i) => i.ajanId === ajan.id).slice(0, 5);
  const kademeler = [
    { ad: 'oku', sayi: k.oku, renk: EKIP_ACCENT },
    { ad: 'portal yaz', sayi: k.portal_yaz, renk: RENK.yesil },
    { ad: 'Luca yaz', sayi: k.luca_yaz, renk: RENK.mor },
    { ad: 'dışarı gönder', sayi: k.disari_gonder, renk: RENK.turuncu },
  ];

  return (
    <section className="relative min-w-0 overflow-hidden rounded-2xl" style={kartArkaPlan(renk)}>
      <div className="h-1 w-full" style={seritStili(renk)} />

      {/* Başlık — mobilde katlama düğmesi */}
      <button type="button" onClick={() => setMobilAcik((a) => !a)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left lg:cursor-default" aria-expanded={mobilAcik}>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-black" style={ikonStili(ikonRenk)}>
          {ajanKisaltma(ajan.id, ajan.ad)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-bold" style={{ color: RENK.metin }}>{ajan.ad}</span>
            <span className="rounded-full px-1.5 text-[9px] font-bold leading-4" style={{ background: `${modelRengi(ajan.model)}1a`, border: `1px solid ${modelRengi(ajan.model)}44`, color: modelRengi(ajan.model) }}>
              {ajan.model}
            </span>
          </span>
          <span className="block truncate text-[11px]" style={{ color: `${renk}cc` }}>{ajan.unvan}</span>
          {ajan.modelKimligi && <span className="block truncate text-[10px]" style={{ color: RENK.sonuk }}>{ajan.modelKimligi}</span>}
        </span>
        <span className="lg:hidden" style={{ color: RENK.ikincil }}>
          {mobilAcik ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      <div className={`${mobilAcik ? 'flex' : 'hidden lg:flex'} flex-col gap-3 px-3 pb-3`}>
        {/* Açıklama */}
        {ajan.aciklama && (
          <div>
            <p className={`${aciklamaAcik ? '' : 'line-clamp-3'} text-xs leading-relaxed`} style={{ color: 'rgba(250,250,249,0.75)' }}>
              {ajan.aciklama}
            </p>
            <button type="button" onClick={() => setAciklamaAcik((a) => !a)} className="mt-0.5 text-[10px]" style={{ color: renk }}>
              {aciklamaAcik ? 'kısalt' : 'devamı'}
            </button>
          </div>
        )}

        {/* Kademe dökümü */}
        <div className="flex flex-col gap-1">
          {kademeler.map((kd) => (
            <div key={kd.ad} className="flex items-center gap-2 text-[10px]">
              <span className="w-[76px] flex-shrink-0" style={{ color: RENK.ikincil }}>{kd.ad}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.round((kd.sayi / toplam) * 100)}%`, background: `linear-gradient(90deg, ${kd.renk}, ${kd.renk}88)` }} />
              </span>
              <span className="w-5 text-right tabular-nums" style={{ color: RENK.metin }}>{kd.sayi}</span>
            </div>
          ))}
          <span className="text-[10px]" style={{ color: RENK.sonuk }}>dışarı gönderim kuru testte kapalı, canlıda onaylı</span>
        </div>

        {/* Onay noktaları */}
        {ajan.onayNoktalari?.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: RENK.turuncu }}>Onay noktaları</div>
            <ul className="space-y-0.5 text-[11px]" style={{ color: 'rgba(250,250,249,0.8)' }}>
              {ajan.onayNoktalari.map((o) => (
                <li key={o} className="flex items-start gap-1.5">
                  <ShieldAlert size={11} className="mt-0.5 flex-shrink-0" style={{ color: RENK.turuncu }} />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tetikler */}
        {ajan.tetikler?.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: renk }}>
              <Zap size={10} /> Tetikler
            </div>
            <div className="flex flex-wrap gap-1">
              {ajan.tetikler.map((t) => (
                <span key={t} className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: `${renk}12`, border: `1px solid ${renk}33`, color: 'rgba(250,250,249,0.8)' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Son 5 koşu */}
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: RENK.ikincil }}>Son 5 koşu</div>
          {!son5.length ? (
            <div className="text-[11px]" style={{ color: RENK.sonuk }}>{isler.length >= 200 ? 'son 200 işte yok' : 'hiç koşmadı'}</div>
          ) : (
            <ul className="space-y-0.5">
              {son5.map((is) => {
                const d = isDurumu(is);
                return (
                  <li key={is.id}>
                    <button type="button" onClick={() => onIsAc(is.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-white/[0.04]" title={is.gorev}>
                      <span className="w-[68px] flex-shrink-0 tabular-nums" style={{ color: RENK.ikincil }}>{goreliSaat(is.createdAt)}</span>
                      <span className="rounded px-1 text-[9px] font-bold" style={is.dryRun ? { background: 'rgba(74,222,128,0.12)', color: '#86efac' } : { background: 'rgba(248,113,113,0.16)', color: '#fca5a5' }}>
                        {is.dryRun ? 'KURU' : 'CANLI'}
                      </span>
                      <span className="min-w-0 flex-1 truncate" style={{ color: 'rgba(250,250,249,0.8)' }}>{is.gorev}</span>
                      <span className="flex-shrink-0 text-[10px] font-bold" style={{ color: d.renk }}>{d.ad}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Araçlar */}
        <div>
          <button type="button" onClick={() => setAraclarAcik((a) => !a)} className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: renk }}>
            <Wrench size={11} /> Araçlar ({ajan.araclar?.length ?? ajan.aracSayisi ?? 0}) — {araclarAcik ? 'gizle' : 'göster'}
          </button>
          {araclarAcik && (
            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-[11px]">
              {(ajan.araclar || []).map((a) => (
                <li key={a} className="flex items-baseline gap-1.5">
                  <span style={{ color: 'rgba(250,250,249,0.85)' }}>{aracAdi(a)}</span>
                  <span className="truncate font-mono text-[9px]" style={{ color: RENK.sonuk }}>{a}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
