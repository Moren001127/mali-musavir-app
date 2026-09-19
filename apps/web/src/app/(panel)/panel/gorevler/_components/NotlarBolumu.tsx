'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useState } from 'react';
import { ChevronDown, ChevronRight, Edit3, Pin, PinOff, StickyNote, Trash2 } from 'lucide-react';
import type { Task } from '@/lib/tasks';
import { Kart, BosDurum } from '../../ekip/_components/Kart';
import { IkonDugme } from './AcilirMenu';
import type { GorevEylemleri } from './eylemler';
import { KaynakRozeti, MukellefCipi } from './Rozetler';
import { IKINCIL, KENAR, KIRMIZI, METIN, NOT_RENK, SONUK, tarihSaat } from './ortak';

/**
 * Notlar — tur NOT kayıtları; sabitlenenler üstte (sarı iğne). Satır tek tıkla genişler (açıklama + eylemler).
 */
export function NotlarBolumu({ notlar, eylemler, acikId, basliksiz }: { notlar: Task[]; eylemler: GorevEylemleri; acikId?: string | null; basliksiz?: boolean }) {
  const [acik, setAcik] = useState<Record<string, boolean>>({});
  const sirali = [...notlar].sort((a, b) => (!!b.pinned !== !!a.pinned ? (b.pinned ? 1 : -1) : (b.updatedAt || '').localeCompare(a.updatedAt || '')));

  return (
    <Kart renk={NOT_RENK} dolguYok className="gorev-notlar">
      {!basliksiz && (
        <div className="flex items-center gap-2 px-4 py-3" style={portalStyle({ borderBottom: `1px solid ${KENAR}` })}>
          <StickyNote size={14} style={portalStyle({ color: NOT_RENK })} />
          <h3 className="text-[12.5px] font-bold" style={portalStyle({ color: METIN })}>
            Notlar
          </h3>
          <span className="rounded-md px-1.5 text-[10.5px] font-extrabold tabular-nums leading-4" style={portalStyle({ background: NOT_RENK, color: '#0b1218' })}>
            {notlar.length}
          </span>
          <span className="text-[11px]" style={portalStyle({ color: IKINCIL })}>
            · sabitlenenler üstte · satıra tıklayınca açılır
          </span>
        </div>
      )}
      {sirali.length === 0 ? (
        <BosDurum ikon={<StickyNote size={18} />} metin="Not yok — giriş satırında “Not olarak kaydet” anahtarını açıp yazın" renk={NOT_RENK} />
      ) : (
        <div>
          {sirali.map((n, i) => {
            const genis = !!acik[n.id];
            return (
              <div key={n.id} data-not-secili={acikId === n.id} data-not-sabit={!!n.pinned} style={portalStyle({ borderTop: i === 0 ? undefined : `1px solid ${KENAR}`, background: acikId === n.id ? 'rgba(125,211,252,0.06)' : n.pinned ? `${NOT_RENK}0a` : undefined })}>
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setAcik((s) => ({ ...s, [n.id]: !genis }))}
                    title={genis ? 'Daralt' : 'Genişlet'}
                    aria-expanded={genis}
                    className="mt-0.5 flex-shrink-0 rounded p-0.5 hover:bg-white/10"
                    style={portalStyle({ color: IKINCIL })}
                  >
                    {genis ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <Pin size={13} className="mt-1 flex-shrink-0" style={portalStyle({ color: n.pinned ? '#fbbf24' : 'rgba(255,255,255,0.18)' })} />
                  <button type="button" onClick={() => setAcik((s) => ({ ...s, [n.id]: !genis }))} className="min-w-0 flex-1 text-left">
                    <div className={`text-[13px] font-semibold leading-5 ${genis ? '' : 'truncate'}`} style={portalStyle({ color: METIN })}>
                      {n.title}
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <MukellefCipi taxpayer={n.taxpayer} />
                      {n.kaynak && n.kaynak !== 'MANUEL' && <KaynakRozeti value={n.kaynak} />}
                      <span className="text-[10.5px]" style={portalStyle({ color: SONUK })}>
                        {tarihSaat(n.updatedAt || n.createdAt)}
                      </span>
                      {!genis && n.description && (
                        <span className="min-w-0 truncate text-[11px]" style={portalStyle({ color: IKINCIL, maxWidth: 480 })}>
                          — {n.description}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <IkonDugme
                      ikon={n.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                      title={n.pinned ? 'Sabitlemeyi kaldır' : 'Üste sabitle'}
                      renk="#fbbf24"
                      aktif={!!n.pinned}
                      onClick={() => eylemler.sabitle(n.id, !n.pinned)}
                    />
                    <IkonDugme ikon={<Edit3 size={13} />} title="Düzenle" renk="#a8a29e" onClick={() => eylemler.ac(n.id)} />
                    <IkonDugme
                      ikon={<Trash2 size={13} />}
                      title="Sil"
                      renk={KIRMIZI}
                      onClick={() => {
                        if (confirm('Bu not silinsin mi?')) eylemler.sil(n.id);
                      }}
                    />
                  </div>
                </div>
                {genis && (
                  <div className="px-3 pb-3 pl-[52px]">
                    {n.description ? (
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed" style={portalStyle({ color: 'rgba(250,250,249,0.8)' })}>
                        {n.description}
                      </p>
                    ) : (
                      <p className="text-[12px]" style={portalStyle({ color: SONUK })}>
                        Açıklama yok — “Düzenle” ile ekleyebilirsiniz.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Kart>
  );
}
