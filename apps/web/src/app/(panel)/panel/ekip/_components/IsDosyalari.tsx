'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Loader2, Wrench, ShieldAlert, GraduationCap, FlaskConical, ChevronDown, RefreshCw } from 'lucide-react';
import { getIsler, getIs, isOmurgaYok, type Ajan, type IsDosyasi, type IsDurumu } from '@/lib/ekip';
import { ajanRengi, ajanKisaltma, kartArkaPlan, tarihKisa, sureKisa, EKIP_ACCENT } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

const DURUM: Record<IsDurumu, { ad: string; renk: string }> = {
  pending: { ad: 'Bekliyor', renk: '#a3a3a3' },
  running: { ad: 'Çalışıyor', renk: '#7dd3fc' },
  done: { ad: 'Bitti', renk: '#4ade80' },
  failed: { ad: 'Hata', renk: '#f87171' },
};

function argsKisa(args: any): string {
  if (args == null) return '';
  try {
    const s = typeof args === 'string' ? args : JSON.stringify(args);
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  } catch {
    return '';
  }
}

function Liste({ baslik, ikon, renk, ogeler }: { baslik: string; ikon: ReactNode; renk: string; ogeler: ReactNode[] }) {
  if (!ogeler.length) return null;
  return (
    <div className="rounded-xl p-3" style={{ background: `${renk}0d`, border: `1px solid ${renk}2a` }}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: renk }}>
        {ikon} {baslik} <span className="opacity-70">({ogeler.length})</span>
      </div>
      <ul className="space-y-1 text-xs" style={{ color: 'rgba(250,250,249,0.8)' }}>
        {ogeler.map((o, i) => (
          <li key={i} className="break-words">{o}</li>
        ))}
      </ul>
    </div>
  );
}

function IsDetay({ id, ozet }: { id: string; ozet: IsDosyasi }) {
  const { data, isLoading } = useQuery({ queryKey: ['ekip-is', id], queryFn: () => getIs(id), staleTime: 15_000 });
  const is = data || ozet;
  const r = is.result;
  const renk = ajanRengi(is.ajanId);

  if (isLoading && !data) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
        <Loader2 size={12} className="animate-spin" /> Detay yükleniyor…
      </div>
    );
  }
  if (!r) {
    return (
      <div className="px-3 py-3 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
        Henüz sonuç yok{is.status === 'running' ? ' — iş sürüyor' : ''}.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
      <div className="flex flex-wrap gap-2 text-[10px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
        {r.model && <span>{r.model}</span>}
        {r.durationMs != null && <span>{sureKisa(r.durationMs)}</span>}
        {is.taxpayerId && <span>Mükellef: {is.taxpayerId.slice(0, 8)}</span>}
      </div>
      {r.rapor && (
        <div
          className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed"
          style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${renk}22`, color: 'rgba(250,250,249,0.92)' }}
        >
          {r.rapor}
        </div>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        <Liste
          baslik="Araçlar"
          ikon={<Wrench size={11} />}
          renk={renk}
          ogeler={(r.toolUses || []).map((t, i) => (
            <span key={i}>
              <b>{t.name}</b> <span className="opacity-60">{argsKisa(t.args)}</span>
            </span>
          ))}
        />
        <Liste
          baslik="Kuru test — yapacaktı"
          ikon={<FlaskConical size={11} />}
          renk="#86efac"
          ogeler={(r.kuruTestYapilacaktilar || []).map((t, i) => (
            <span key={i}>
              <b>{t.name}</b> <span className="opacity-60">{argsKisa(t.args)}</span>
            </span>
          ))}
        />
        <Liste
          baslik="Onay bekleyen"
          ikon={<ShieldAlert size={11} />}
          renk="#fdba74"
          ogeler={(r.onayBekleyen || []).map((o, i) => (
            <span key={i}>{typeof o === 'string' ? o : o?.aciklama || o?.name || argsKisa(o)}</span>
          ))}
        />
        <Liste baslik="Öğrenilen" ikon={<GraduationCap size={11} />} renk="#c4b5fd" ogeler={(r.ogrenilen || []).map((o, i) => <span key={i}>{o}</span>)} />
      </div>
    </div>
  );
}

/** Son 50 iş dosyası; ajan filtresi; satıra tıkla → detay. */
export function IsDosyalari({ ajanlar }: { ajanlar: Ajan[] }) {
  const [ajanId, setAjanId] = useState('');
  const [acik, setAcik] = useState<string | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['ekip-isler', ajanId],
    queryFn: () => getIsler({ ajanId: ajanId || undefined, limit: 50 }),
    refetchInterval: 15_000,
    retry: (n, e) => !isOmurgaYok(e) && n < 2,
  });
  const ajanAd = (id: string) => ajanlar.find((a) => a.id === id)?.ad || id;

  return (
    <section className="relative overflow-hidden rounded-2xl" style={kartArkaPlan(EKIP_ACCENT)}>
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${EKIP_ACCENT}, ${EKIP_ACCENT}55 55%, transparent)` }} />
      <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <FolderOpen size={16} style={{ color: EKIP_ACCENT }} />
        <h2 className="text-sm font-bold" style={{ color: '#fafaf9' }}>İş Dosyaları</h2>
        <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>son 50 koşu</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={ajanId}
            onChange={(e) => setAjanId(e.target.value)}
            className="rounded-lg px-2 py-1.5 text-xs outline-none"
            style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${EKIP_ACCENT}3a`, color: '#fafaf9' }}
          >
            <option value="">Tüm ajanlar</option>
            {ajanlar.map((a) => (
              <option key={a.id} value={a.id}>{a.ad}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-white/5"
            style={{ color: 'rgba(250,250,249,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}
            title="Yenile"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Yenile
          </button>
        </div>
      </div>

      <div className="p-3">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={12} className="animate-spin" /> Yükleniyor…
          </div>
        ) : error ? (
          isOmurgaYok(error) ? (
            <OmurgaYokBilgi kucuk />
          ) : (
            <div className="py-4 text-xs" style={{ color: '#fca5a5' }}>İş listesi alınamadı: {(error as any)?.message || 'hata'}</div>
          )
        ) : !data?.length ? (
          <div className="py-8 text-center text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Henüz iş dosyası yok — bir ajana görev verince burada görünür.
          </div>
        ) : (
          <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
            {data.map((is) => {
              const renk = ajanRengi(is.ajanId);
              const d = DURUM[is.status] || DURUM.pending;
              const secili = acik === is.id;
              return (
                <div
                  key={is.id}
                  className="overflow-hidden rounded-xl"
                  style={{
                    background: secili ? `${renk}10` : 'rgba(255,255,255,0.025)',
                    border: `1px solid ${secili ? `${renk}44` : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <button
                    onClick={() => setAcik(secili ? null : is.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <span
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-black"
                      style={{ background: `linear-gradient(135deg, ${renk}, ${renk}88)`, color: '#0f0d0b' }}
                      title={ajanAd(is.ajanId)}
                    >
                      {ajanKisaltma(is.ajanId)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold" style={{ color: '#fafaf9' }}>{is.gorev}</div>
                      <div className="truncate text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                        {ajanAd(is.ajanId)} · {tarihKisa(is.createdAt)}
                        {is.finishedAt ? ` → ${tarihKisa(is.finishedAt)}` : ''}
                      </div>
                    </div>
                    <span
                      className="hidden rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline"
                      style={
                        is.dryRun
                          ? { background: 'rgba(74,222,128,0.12)', color: '#86efac' }
                          : { background: 'rgba(248,113,113,0.16)', color: '#fca5a5' }
                      }
                    >
                      {is.dryRun ? 'KURU' : 'CANLI'}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: `${d.renk}1a`, border: `1px solid ${d.renk}44`, color: d.renk }}
                    >
                      {is.status === 'running' && <Loader2 size={9} className="animate-spin" />}
                      {d.ad}
                    </span>
                    <ChevronDown
                      size={14}
                      className="flex-shrink-0 transition-transform"
                      style={{ color: 'rgba(250,250,249,0.35)', transform: secili ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                    />
                  </button>
                  {secili && <IsDetay id={is.id} ozet={is} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
