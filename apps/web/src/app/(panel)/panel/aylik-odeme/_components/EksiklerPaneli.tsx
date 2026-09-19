'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, UserMinus } from 'lucide-react';
import { BEYAN_ETIKETLER } from '@/lib/beyanname-takip';
import { donemAdi, type EksikSatiri } from '@/lib/aylik-odeme';
import { AMBER, AMBER_KENAR, Cip, IKINCIL, METIN } from './ortak';

/** Sebep metnini beyanname adı + dönemle birlikte okunur hâle getirir */
function eksikMetni(e: EksikSatiri): string {
  const ad = e.beyanTipi ? (BEYAN_ETIKETLER as Record<string, string>)[e.beyanTipi] || e.beyanTipi : null;
  const donem = e.donem ? donemAdi(e.donem) : null;
  if (ad && donem) return `${ad} (${donem}) — ${e.sebep}`;
  if (ad) return `${ad} — ${e.sebep}`;
  if (donem) return `${donem} — ${e.sebep}`;
  return e.sebep;
}

/**
 * LİSTEDE NEDEN YOK — iki grup (listede hiç yok / listede var ama eksiği var), kapalı başlar.
 * SGK satırında "SGK'sı yok → beklentiden çıkar" küçük düğme (onay sorusu → POST sgk-yok → eksikler yenilenir).
 */
export function EksiklerPaneli({ eksikler, onSgkYok, sgkYokIsleniyor }: { eksikler: EksikSatiri[]; onSgkYok: (e: EksikSatiri) => void; sgkYokIsleniyor: string | null }) {
  const [acik, setAcik] = useState(false);
  const listeDisi = useMemo(() => eksikler.filter((e) => !e.listedeVar), [eksikler]);
  const listedeAmaEksik = useMemo(() => eksikler.filter((e) => e.listedeVar), [eksikler]);
  if (listeDisi.length === 0 && listedeAmaEksik.length === 0) return null;

  return (
    <div className="rounded-2xl" style={portalStyle({ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)' })} data-testid="eksikler-paneli">
      <button type="button" onClick={() => setAcik((v) => !v)} aria-expanded={acik} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-semibold" style={portalStyle({ color: METIN })}>
          <span>Listede görünmeyen {new Set(listeDisi.map((e) => e.taxpayerId)).size} mükellef</span>
          {listedeAmaEksik.length > 0 && (
            <span className="text-[12px] font-medium" style={portalStyle({ color: IKINCIL })}>
              · listede olup eksiği olan {new Set(listedeAmaEksik.map((e) => e.taxpayerId)).size}
            </span>
          )}
        </span>
        <ChevronDown size={16} style={portalStyle({ color: IKINCIL, transform: acik ? 'rotate(180deg)' : 'none', transition: 'transform .15s' })} />
      </button>
      {acik && (
        <div className="max-h-[420px] overflow-x-auto overflow-y-auto px-4 py-3" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.08)' })}>
          {([
            ['Listede hiç yok', listeDisi],
            ['Listede var, ama eksiği var', listedeAmaEksik],
          ] as Array<[string, EksikSatiri[]]>).map(([baslik, grup]) =>
            grup.length === 0 ? null : (
              <div key={baslik} className="mb-3 last:mb-0">
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider" style={portalStyle({ color: IKINCIL })}>
                  {baslik} ({grup.length} kalem)
                </div>
                {/* Sabit sütunlu ızgara: unvan · kaynak çipi · sebep · eylem (SGK'da düğme, vergide boş) — hizalar kaymasın */}
                {grup.map((e, i) => {
                  const sgk = e.kaynak === 'SGK';
                  const isleniyor = sgkYokIsleniyor === e.taxpayerId;
                  return (
                    <div
                      key={`${e.taxpayerId}-${e.kaynak}-${i}`}
                      className="grid items-center gap-x-3 py-1.5 text-[12.5px]"
                      style={portalStyle({ gridTemplateColumns: 'minmax(150px,1fr) 52px minmax(200px,1.4fr) 218px', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined })}
                    >
                      <span className="min-w-0 truncate" style={portalStyle({ color: METIN })} title={e.unvan}>{e.unvan}</span>
                      <Cip className="justify-center">{sgk ? 'SGK' : 'Vergi'}</Cip>
                      <span className="min-w-0 truncate text-[12px]" style={portalStyle({ color: IKINCIL })} title={eksikMetni(e)}>{eksikMetni(e)}</span>
                      <span className="flex justify-end">
                        {sgk ? (
                          <button
                            type="button"
                            disabled={isleniyor}
                            onClick={() => onSgkYok(e)}
                            title="Bu mükellefin SGK'sı yok — bundan sonra SGK eksiği olarak beklenmesin"
                            className="inline-flex h-6 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold transition hover:brightness-125 disabled:opacity-50"
                            style={portalStyle({ border: `1px solid ${AMBER_KENAR}`, color: AMBER, background: 'rgba(226,181,99,0.06)' })}
                          >
                            {isleniyor ? <Loader2 size={11} className="animate-spin" /> : <UserMinus size={11} />} SGK'sı yok → beklentiden çıkar
                          </button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
