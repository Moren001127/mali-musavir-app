'use client';

import { useState, type ReactNode } from 'react';
import { ShieldAlert, Wrench, Zap, X } from 'lucide-react';
import type { Ajan, IsDosyasi } from '@/lib/ekip';
import { Kart } from './Kart';
import { EKIP_ACCENT, RENK, ajanKisaltma, ajanRengi, ajanYuzeyRengi, aracAdi, avatarHalkaStili, goreliSaat, isDurumu, modelRengi } from './ortak';

/**
 * Seçili ajanın kimlik kartı — komut kartının altında açılır/kapanır ("bilgi" düğmesi).
 * Açıklama · kademe dökümü · onay noktaları · tetikler · son 5 koşu · araç listesi.
 */
export function AjanDetayKarti({ ajan, isler, onIsAc, onKapat }: { ajan: Ajan | undefined; isler: IsDosyasi[]; onIsAc: (isId: string) => void; onKapat: () => void }) {
  const [aciklamaAcik, setAciklamaAcik] = useState(false);
  const [araclarAcik, setAraclarAcik] = useState(false);

  if (!ajan) return null;
  const renk = ajanYuzeyRengi(ajan.id);
  const ikonRenk = ajanRengi(ajan.id);
  const modelR = modelRengi(ajan.model);
  const k = ajan.kademeOzeti || { oku: 0, portal_yaz: 0, luca_yaz: 0, disari_gonder: 0 };
  const toplam = Math.max(1, k.oku + k.portal_yaz + k.luca_yaz + k.disari_gonder);
  const son5 = isler.filter((i) => i.ajanId === ajan.id).slice(0, 5);
  const kademeler = [
    { ad: 'oku', sayi: k.oku, renk: EKIP_ACCENT },
    { ad: 'portal yaz', sayi: k.portal_yaz, renk: RENK.yesil },
    { ad: 'Luca yaz', sayi: k.luca_yaz, renk: RENK.mor },
    { ad: 'dışarı gönder', sayi: k.disari_gonder, renk: RENK.turuncu },
  ];

  const bolumBaslik = (metin: string, r: string = RENK.ikincil, ikon?: ReactNode) => (
    <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: r }}>
      {ikon} {metin}
    </div>
  );

  return (
    <Kart renk={renk} className="p-5">
      {/* Başlık */}
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full p-[2px]" style={avatarHalkaStili(ikonRenk, false)}>
          <span className="flex h-full w-full items-center justify-center rounded-full text-[10.5px] font-black" style={{ background: 'linear-gradient(160deg, #1a1815, #0b0a08)', color: ikonRenk }}>
            {ajanKisaltma(ajan.id, ajan.ad)}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[14px] font-bold" style={{ color: RENK.metin }}>{ajan.ad}</span>
            <span className="rounded-full px-1.5 text-[9.5px] font-bold leading-4" style={{ background: `${modelR}16`, border: `1px solid ${modelR}44`, color: modelR }}>
              {ajan.model}
            </span>
          </div>
          <div className="truncate text-[11.5px]" style={{ color: RENK.ikincil }}>{ajan.unvan}</div>
          {ajan.modelKimligi && <div className="truncate text-[10px]" style={{ color: RENK.sonuk }}>{ajan.modelKimligi}</div>}
        </div>
        <button
          type="button"
          onClick={onKapat}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-[background-color] duration-150 hover:bg-white/10"
          style={{ color: RENK.ikincil, border: '1px solid rgba(255,255,255,0.10)' }}
          title="Bilgiyi kapat"
        >
          <X size={13} />
        </button>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          {ajan.aciklama && (
            <div>
              <p className={`${aciklamaAcik ? '' : 'line-clamp-3'} text-[13px] leading-relaxed`} style={{ color: 'rgba(250,250,249,0.78)' }}>
                {ajan.aciklama}
              </p>
              <button type="button" onClick={() => setAciklamaAcik((a) => !a)} className="mt-0.5 text-[10.5px]" style={{ color: renk }}>
                {aciklamaAcik ? 'kısalt' : 'devamı'}
              </button>
            </div>
          )}

          <div>
            {bolumBaslik('Kademeler')}
            <div className="flex flex-col gap-1">
              {kademeler.map((kd) => (
                <div key={kd.ad} className="flex items-center gap-2 text-[10.5px]">
                  <span className="w-[80px] flex-shrink-0" style={{ color: RENK.ikincil }}>{kd.ad}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${Math.round((kd.sayi / toplam) * 100)}%`, background: `linear-gradient(90deg, ${kd.renk}, ${kd.renk}88)` }} />
                  </span>
                  <span className="w-5 text-right tabular-nums" style={{ color: RENK.metin }}>{kd.sayi}</span>
                </div>
              ))}
              <span className="text-[10px]" style={{ color: RENK.sonuk }}>dışarı gönderim kuru testte kapalı, canlıda onaylı</span>
            </div>
          </div>

          {ajan.onayNoktalari?.length > 0 && (
            <div>
              {bolumBaslik('Onay noktaları', RENK.turuncu)}
              <ul className="space-y-0.5 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.8)' }}>
                {ajan.onayNoktalari.map((o) => (
                  <li key={o} className="flex items-start gap-1.5">
                    <ShieldAlert size={11} className="mt-0.5 flex-shrink-0" style={{ color: RENK.turuncu }} />
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ajan.tetikler?.length > 0 && (
            <div>
              {bolumBaslik('Tetikler', renk, <Zap size={10} />)}
              <div className="flex flex-wrap gap-1">
                {ajan.tetikler.map((t) => (
                  <span key={t} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: `${renk}12`, border: `1px solid ${renk}33`, color: 'rgba(250,250,249,0.8)' }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            {bolumBaslik('Son 5 koşu')}
            {!son5.length ? (
              <div className="text-[11.5px]" style={{ color: RENK.sonuk }}>{isler.length >= 200 ? 'son 200 işte yok' : 'hiç koşmadı'}</div>
            ) : (
              <ul className="space-y-0.5">
                {son5.map((is) => {
                  const d = isDurumu(is);
                  return (
                    <li key={is.id}>
                      <button type="button" onClick={() => onIsAc(is.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11.5px] transition-[background-color] duration-150 hover:bg-white/[0.04]" title={is.gorev}>
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

          <div>
            <button type="button" onClick={() => setAraclarAcik((a) => !a)} className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: renk }}>
              <Wrench size={11} /> Araçlar ({ajan.araclar?.length ?? ajan.aracSayisi ?? 0}) — {araclarAcik ? 'gizle' : 'göster'}
            </button>
            {araclarAcik && (
              <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto text-[11.5px]">
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
      </div>
    </Kart>
  );
}
