'use client';

import { Wrench, ShieldAlert, Play } from 'lucide-react';
import type { Ajan } from '@/lib/ekip';
import { ajanRengi, ajanKisaltma, kartArkaPlan, modelRengi } from './ortak';

/**
 * Tek ajan kartı — gradyan + radial parıltı, üstte renk şeridi.
 * "Görev ver" düğmesi HER ZAMAN görünür (hover'a saklanmaz).
 */
export function AjanKarti({
  ajan,
  secili,
  onSec,
}: {
  ajan: Ajan;
  secili: boolean;
  onSec: () => void;
}) {
  const renk = ajanRengi(ajan.id);
  const k = ajan.kademeOzeti || { oku: 0, portal_yaz: 0, luca_yaz: 0, disari_gonder: 0 };
  const aracSayisi = ajan.araclar?.length ?? k.oku + k.portal_yaz + k.luca_yaz + k.disari_gonder;

  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-2xl transition-transform"
      style={kartArkaPlan(renk, secili)}
    >
      {/* Üst renk şeridi */}
      <div
        className="h-1 w-full"
        style={{ background: `linear-gradient(90deg, ${renk}, ${renk}55 55%, transparent)` }}
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-[12px] font-black tracking-wider"
            style={{
              background: `linear-gradient(135deg, ${renk}, ${renk}88)`,
              color: '#0f0d0b',
              boxShadow: `0 0 18px ${renk}33, inset 0 1px 0 rgba(255,255,255,0.3)`,
            }}
          >
            {ajanKisaltma(ajan.id, ajan.ad)}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-bold leading-tight" style={{ color: '#fafaf9' }}>
              {ajan.ad}
            </h3>
            <p className="truncate text-[11px]" style={{ color: `${renk}cc` }}>
              {ajan.unvan}
            </p>
          </div>
          <span
            className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: `${modelRengi(ajan.model)}1a`,
              border: `1px solid ${modelRengi(ajan.model)}44`,
              color: modelRengi(ajan.model),
            }}
            title={`Model: ${ajan.model}`}
          >
            {ajan.model || '—'}
          </span>
        </div>

        <p className="line-clamp-3 text-xs leading-relaxed" style={{ color: 'rgba(250,250,249,0.7)' }}>
          {ajan.aciklama}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-2 text-[10px]">
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.7)' }}
            title={`Oku ${k.oku} · Portal yaz ${k.portal_yaz} · Luca yaz ${k.luca_yaz} · Dışarı gönder ${k.disari_gonder}`}
          >
            <Wrench size={10} /> {aracSayisi} araç
          </span>
          {ajan.onayNoktalari?.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
              style={{ background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.30)', color: '#fdba74' }}
              title={ajan.onayNoktalari.join(' · ')}
            >
              <ShieldAlert size={10} /> {ajan.onayNoktalari.length} onay noktası
            </span>
          )}
        </div>

        {ajan.onayNoktalari?.length > 0 && (
          <ul className="space-y-0.5 text-[10px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            {ajan.onayNoktalari.slice(0, 2).map((o) => (
              <li key={o} className="truncate">• {o}</li>
            ))}
          </ul>
        )}

        <button
          onClick={onSec}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
          style={
            secili
              ? { background: `linear-gradient(135deg, ${renk}, ${renk}aa)`, color: '#0f0d0b' }
              : { background: `${renk}18`, border: `1px solid ${renk}44`, color: renk }
          }
        >
          <Play size={12} /> {secili ? 'Görev paneli açık' : 'Görev ver'}
        </button>
      </div>
    </div>
  );
}
