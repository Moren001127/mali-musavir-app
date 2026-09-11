'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2, Send, XCircle, RefreshCw, Clock } from 'lucide-react';
import { getOnaylar, onayla, reddet, isOmurgaYok, type EkipOnay } from '@/lib/ekip';
import { ajanRengi, ajanKisaltma, kartArkaPlan, tarihKisa } from './ortak';

const RENK = '#fbbf24'; // onay = altın vurgu (tek yer)

function payloadKisa(p: any): string {
  if (!p) return '';
  try {
    const kopya = { ...p };
    delete kopya.isId;
    delete kopya.taxpayerId;
    const s = JSON.stringify(kopya);
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  } catch {
    return '';
  }
}

/**
 * Ajanların dışarı göndermek istediği mesajlar (WhatsApp / SMS / e-posta).
 * Sahip burada Onayla derse gerçekten gider; Reddet derse kapanır. Kuru testte hiç düşmez.
 */
export function OnayBekleyenler() {
  const qc = useQueryClient();
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<Record<string, string>>({});
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['ekip-onaylar'],
    queryFn: () => getOnaylar('PENDING', 50),
    refetchInterval: 20_000,
    retry: false,
  });

  if (error && isOmurgaYok(error)) return null;
  const onaylar: EkipOnay[] = data || [];

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-isler'] });
  };

  const onaylaTikla = async (o: EkipOnay) => {
    if (mesgul) return;
    const metin = `Bu mesaj GERÇEKTEN gönderilecek.\n\n${o.ajanAd} → ${o.arac}${o.hedef ? ` → ${o.hedef}` : ''}\n\nOnaylıyor musun?`;
    if (!window.confirm(metin)) return;
    setMesgul(o.previewId);
    try {
      const r = await onayla(o.previewId);
      setSonuc((s) => ({ ...s, [o.previewId]: r.ok ? 'Gönderildi.' : `Hata: ${r.error || 'gönderilemedi'}` }));
    } catch (e: any) {
      setSonuc((s) => ({ ...s, [o.previewId]: `Hata: ${e?.message || e}` }));
    } finally {
      setMesgul(null);
      tazele();
    }
  };

  const reddetTikla = async (o: EkipOnay) => {
    if (mesgul) return;
    setMesgul(o.previewId);
    try {
      const r = await reddet(o.previewId, 'Portaldan reddedildi');
      setSonuc((s) => ({ ...s, [o.previewId]: r.ok ? 'Reddedildi.' : `Hata: ${r.error || ''}` }));
    } catch (e: any) {
      setSonuc((s) => ({ ...s, [o.previewId]: `Hata: ${e?.message || e}` }));
    } finally {
      setMesgul(null);
      tazele();
    }
  };

  return (
    <section className="rounded-2xl p-4" style={kartArkaPlan(RENK)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${RENK}22`, color: RENK }}>
            <ShieldCheck size={16} />
          </span>
          <div>
            <div className="text-sm font-bold" style={{ color: 'rgba(250,250,249,0.95)' }}>Onay Bekleyenler</div>
            <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
              Ajanların dışarı göndermek istediği mesajlar — sen onaylamadan gitmez.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
          style={{ background: `${RENK}1a`, color: RENK, border: `1px solid ${RENK}44` }}
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Yenile
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
          <Loader2 size={12} className="animate-spin" /> Yükleniyor…
        </div>
      )}
      {!isLoading && !onaylar.length && (
        <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'rgba(0,0,0,0.2)', color: 'rgba(250,250,249,0.55)' }}>
          Bekleyen onay yok.
        </div>
      )}

      <ul className="space-y-2">
        {onaylar.map((o) => {
          const renk = ajanRengi(o.ajanId);
          const mesgulMu = mesgul === o.previewId;
          return (
            <li key={o.previewId} className="rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${renk}33` }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-black"
                      style={{ background: `${renk}22`, color: renk }}
                    >
                      {ajanKisaltma(o.ajanId, o.ajanAd)}
                    </span>
                    <span className="font-semibold" style={{ color: 'rgba(250,250,249,0.92)' }}>{o.ajanAd}</span>
                    <span className="rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ background: `${RENK}1a`, color: RENK }}>
                      {o.arac}
                    </span>
                    {o.hedef && <span style={{ color: 'rgba(250,250,249,0.7)' }}>→ {o.hedef}</span>}
                    <span className="font-mono text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>#{o.previewId}</span>
                  </div>
                  {o.mesaj && (
                    <div
                      className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg px-2.5 py-2 text-xs leading-relaxed"
                      style={{ background: 'rgba(0,0,0,0.25)', color: 'rgba(250,250,249,0.88)' }}
                    >
                      {o.mesaj}
                    </div>
                  )}
                  {!o.mesaj && o.payload && (
                    <div className="mt-2 break-all font-mono text-[10px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                      {payloadKisa(o.payload)}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    <span className="flex items-center gap-1"><Clock size={10} /> {tarihKisa(o.createdAt)}</span>
                    <span>son: {tarihKisa(o.expiresAt)}</span>
                    {o.isId && <span>iş: {o.isId.slice(0, 8)}</span>}
                    {sonuc[o.previewId] && (
                      <span style={{ color: sonuc[o.previewId].startsWith('Hata') ? '#f87171' : '#4ade80' }}>{sonuc[o.previewId]}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={!!mesgul}
                    onClick={() => onaylaTikla(o)}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#16a34a,#4ade80)', color: '#052e16' }}
                  >
                    {mesgulMu ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Onayla ve gönder
                  </button>
                  <button
                    type="button"
                    disabled={!!mesgul}
                    onClick={() => reddetTikla(o)}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    style={{ background: 'rgba(248,113,113,0.15)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.35)' }}
                  >
                    <XCircle size={12} /> Reddet
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
