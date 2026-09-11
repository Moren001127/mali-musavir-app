'use client';

import { Fragment, forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Loader2, Wrench, ShieldAlert, GraduationCap, FlaskConical, ChevronDown, RefreshCw, RotateCcw, X } from 'lucide-react';
import { getIs, isOmurgaYok, type Ajan, type IsDosyasi } from '@/lib/ekip';
import type { KomutTaslak } from './KomutKutusu';
import { EKIP_ACCENT, RENK, ajanKisaltma, ajanRengi, aracAdi, bugunMu, ikonStili, isDurumu, kartArkaPlan, kaynakEtiketi, seritStili, sureKisa, tarihKisa } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

type Gun = 'bugun' | '7' | 'tumu';
type Durum = 'tumu' | 'running' | 'failed' | 'onay';
type Mod = 'kuru' | 'canli' | 'hepsi';

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

/** İş detayı: rapor, Araçlar, Kuru testte yapılacaktı, Onay bekleyen, Öğrenilen + Tekrar çalıştır (kuru). */
function IsDetay({
  id,
  ozet,
  mukellefAd,
  onTaslak,
}: {
  id: string;
  ozet: IsDosyasi;
  mukellefAd: (id?: string | null) => string | undefined;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
}) {
  const { data, isLoading } = useQuery({ queryKey: ['ekip-is', id], queryFn: () => getIs(id), staleTime: 15_000 });
  const is = data || ozet;
  const r = is.result;
  const renk = ajanRengi(is.ajanId);

  const tekrar = (
    <button
      type="button"
      onClick={() => onTaslak({ ajanId: is.ajanId, gorev: is.gorev, taxpayerId: is.taxpayerId || undefined, dryRun: true, kaynak: 'tekrar' })}
      className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
      style={{ background: `${renk}14`, border: `1px solid ${renk}55`, color: RENK.metin }}
      title="Komut kutusunu aynı görevle doldurur (kuru); çalıştırmaz"
    >
      <RotateCcw size={12} style={{ color: renk }} /> Tekrar çalıştır (kuru)
    </button>
  );

  if (isLoading && !data) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs" style={{ color: RENK.ikincil }}>
        <Loader2 size={12} className="animate-spin" /> Detay yükleniyor…
      </div>
    );
  }
  if (!r) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3 text-xs" style={{ color: RENK.ikincil }}>
        <span>Henüz sonuç yok{is.status === 'running' ? ' — iş sürüyor' : ''}.</span>
        {is.hata && <span style={{ color: '#fca5a5' }}>{is.hata}</span>}
        {tekrar}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
      <div className="flex flex-wrap items-center gap-2 text-[10px]" style={{ color: RENK.ikincil }}>
        {r.model && <span>{r.model}</span>}
        {r.durationMs != null && <span>{sureKisa(r.durationMs)}</span>}
        {is.taxpayerId && <span>Mükellef: {mukellefAd(is.taxpayerId) || is.taxpayerId.slice(0, 8)}</span>}
        {is.kaynak && <span>kaynak: {kaynakEtiketi(is.kaynak).ad}</span>}
        <span className="ml-auto">{tekrar}</span>
      </div>
      {is.hata && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}>
          ⚠️ {is.hata}
        </div>
      )}
      {r.rapor && (
        <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${renk}22`, color: 'rgba(250,250,249,0.92)' }}>
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
              <b>{aracAdi(t.name)}</b> <span className="opacity-60">{argsKisa(t.args)}</span>
            </span>
          ))}
        />
        <Liste
          baslik="Kuru test — yapacaktı"
          ikon={<FlaskConical size={11} />}
          renk="#86efac"
          ogeler={(r.kuruTestYapilacaktilar || []).map((t, i) => (
            <span key={i}>
              <b>{aracAdi(t.name)}</b> <span className="opacity-60">{argsKisa(t.args)}</span>
            </span>
          ))}
        />
        <Liste
          baslik="Onay bekleyen"
          ikon={<ShieldAlert size={11} />}
          renk={RENK.turuncu}
          ogeler={(r.onayBekleyen || []).map((o, i) => (
            <span key={i}>{typeof o === 'string' ? o : o?.previewId ? `#${o.previewId} · ${aracAdi(o.name)}` : o?.aciklama || o?.name || argsKisa(o)}</span>
          ))}
        />
        <Liste baslik="Öğrenilen" ikon={<GraduationCap size={11} />} renk="#c4b5fd" ogeler={(r.ogrenilen || []).map((o, i) => <span key={i}>{o}</span>)} />
      </div>
    </div>
  );
}

function Cip({ aktif, onClick, children, renk = EKIP_ACCENT, title }: { aktif: boolean; onClick: () => void; children: ReactNode; renk?: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors"
      style={aktif ? { background: `${renk}22`, border: `1px solid ${renk}66`, color: renk } : { background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: RENK.ikincil }}
    >
      {children}
    </button>
  );
}

function onayBekliyorMu(is: IsDosyasi): boolean {
  return (is.onayBekleyenSayisi ?? 0) > 0 || (is.result?.onayBekleyen?.length ?? 0) > 0;
}

/**
 * İş Dosyaları — isler(200) üzerinde istemci süzgeçleri; yoğun tablo (masaüstü) / kart-satır (mobil).
 * Satır tık → IsDetay + "Tekrar çalıştır (kuru)". Dışarıdan `acikIsId` ile satır açılır (süzgeç gerekirse gevşer).
 */
export const IsDosyalari = forwardRef<
  HTMLElement,
  {
    isler: IsDosyasi[];
    isLoading: boolean;
    error: unknown;
    ajanlar: Ajan[];
    seciliAjanId: string;
    mukellefAd: (id?: string | null) => string | undefined;
    acikIsId: string | null;
    onAcikIsId: (id: string | null) => void;
    onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
    /** SabahBandi "koşu bugün" → gün süzgecini "Bugün"e alır. */
    disSuzgec: { nonce: number; gun?: Gun } | null;
  }
>(function IsDosyalari({ isler, isLoading, error, ajanlar, seciliAjanId, mukellefAd, acikIsId, onAcikIsId, onTaslak, disSuzgec }, ref) {
  const qc = useQueryClient();
  const [gun, setGun] = useState<Gun>('bugun');
  const [durum, setDurum] = useState<Durum>('tumu');
  const [mod, setMod] = useState<Mod>('hepsi');
  const [kaynak, setKaynak] = useState<string>('');
  const [ajanSuzgec, setAjanSuzgec] = useState<string | null>(seciliAjanId);
  const [yenileniyor, setYenileniyor] = useState(false);

  // Ajan çipi AjanSeridi ile senkron
  useEffect(() => setAjanSuzgec(seciliAjanId), [seciliAjanId]);

  useEffect(() => {
    if (disSuzgec?.gun) setGun(disSuzgec.gun);
  }, [disSuzgec?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const ajanAd = (id: string) => ajanlar.find((a) => a.id === id)?.ad || id;

  const suzulmus = useMemo(() => {
    const simdi = Date.now();
    return isler.filter((is) => {
      if (ajanSuzgec && is.ajanId !== ajanSuzgec) return false;
      if (gun === 'bugun' && !bugunMu(is.createdAt)) return false;
      if (gun === '7' && simdi - new Date(is.createdAt).getTime() > 7 * 86_400_000) return false;
      if (durum === 'running' && is.status !== 'running') return false;
      if (durum === 'failed' && is.status !== 'failed') return false;
      if (durum === 'onay' && !onayBekliyorMu(is)) return false;
      if (mod === 'kuru' && !is.dryRun) return false;
      if (mod === 'canli' && is.dryRun) return false;
      if (kaynak && (is.kaynak || 'portal') !== kaynak) return false;
      return true;
    });
  }, [isler, ajanSuzgec, gun, durum, mod, kaynak]);

  // Dışarıdan açılan iş süzgeçte yoksa süzgeçleri gevşet; satıra kaydır
  useEffect(() => {
    if (!acikIsId) return;
    const kayit = isler.find((i) => i.id === acikIsId);
    if (kayit && !suzulmus.some((i) => i.id === acikIsId)) {
      setGun('tumu');
      setDurum('tumu');
      setMod('hepsi');
      setKaynak('');
      setAjanSuzgec(null);
    }
    const t = setTimeout(() => {
      document.getElementById(`is-${acikIsId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
    return () => clearTimeout(t);
  }, [acikIsId]); // eslint-disable-line react-hooks/exhaustive-deps

  const yenile = async () => {
    setYenileniyor(true);
    await qc.invalidateQueries({ queryKey: ['ekip-isler'] });
    setYenileniyor(false);
  };

  const Durum = ({ is }: { is: IsDosyasi }) => {
    const d = isDurumu(is);
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${d.renk}1a`, border: `1px solid ${d.renk}44`, color: d.renk }}>
        {is.status === 'running' && <Loader2 size={9} className="animate-spin" />}
        {d.ad}
      </span>
    );
  };
  const ModRozet = ({ is }: { is: IsDosyasi }) => (
    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={is.dryRun ? { background: 'rgba(74,222,128,0.12)', color: '#86efac' } : { background: 'rgba(248,113,113,0.16)', color: '#fca5a5' }}>
      {is.dryRun ? 'KURU' : 'CANLI'}
    </span>
  );
  const Kaynak = ({ is }: { is: IsDosyasi }) => {
    const k = kaynakEtiketi(is.kaynak);
    return (
      <span className="whitespace-nowrap text-[10px]" style={{ color: RENK.ikincil }}>
        {k.ikon ? `${k.ikon} ` : ''}
        {k.ad}
      </span>
    );
  };

  return (
    <section ref={ref} className="relative min-w-0 overflow-hidden rounded-2xl" style={kartArkaPlan(EKIP_ACCENT)}>
      <div className="h-1 w-full" style={seritStili(EKIP_ACCENT)} />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <FolderOpen size={15} style={{ color: EKIP_ACCENT }} />
        <h2 className="text-sm font-bold" style={{ color: RENK.metin }}>İş Dosyaları</h2>
        <span className="text-[11px]" style={{ color: RENK.sonuk }}>
          {suzulmus.length}/{isler.length}
        </span>
        <button
          type="button"
          onClick={yenile}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]"
          style={{ color: RENK.ikincil, border: '1px solid rgba(255,255,255,0.08)' }}
          title="Yenile"
        >
          <RefreshCw size={11} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
        </button>
      </div>

      {/* Süzgeç çipleri */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <Cip aktif={gun === 'bugun'} onClick={() => setGun('bugun')}>Bugün</Cip>
        <Cip aktif={gun === '7'} onClick={() => setGun('7')}>7 gün</Cip>
        <Cip aktif={gun === 'tumu'} onClick={() => setGun('tumu')}>Tümü</Cip>
        <span className="mx-0.5 hidden opacity-20 sm:inline">|</span>
        <Cip aktif={durum === 'tumu'} onClick={() => setDurum('tumu')}>Tümü</Cip>
        <Cip aktif={durum === 'running'} onClick={() => setDurum('running')}>Çalışıyor</Cip>
        <Cip aktif={durum === 'failed'} onClick={() => setDurum('failed')} renk={RENK.kirmizi}>Hata</Cip>
        <Cip aktif={durum === 'onay'} onClick={() => setDurum('onay')} renk={RENK.turuncu}>Onay bekleyen</Cip>
        <span className="mx-0.5 hidden opacity-20 sm:inline">|</span>
        <Cip aktif={mod === 'kuru'} onClick={() => setMod('kuru')} renk={RENK.yesil}>Kuru</Cip>
        <Cip aktif={mod === 'canli'} onClick={() => setMod('canli')} renk={RENK.kirmizi}>Canlı</Cip>
        <Cip aktif={mod === 'hepsi'} onClick={() => setMod('hepsi')}>Hepsi</Cip>
        <span className="mx-0.5 hidden opacity-20 sm:inline">|</span>
        <select
          value={kaynak}
          onChange={(e) => setKaynak(e.target.value)}
          className="rounded-md px-1.5 py-0.5 text-[11px] outline-none"
          style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${kaynak ? `${EKIP_ACCENT}66` : 'rgba(255,255,255,0.08)'}`, color: kaynak ? EKIP_ACCENT : RENK.ikincil }}
          title="Kaynak"
        >
          <option value="">Kaynak ▾</option>
          <option value="portal">portal</option>
          <option value="ses">🎤 ses</option>
          <option value="cron">⏰ cron</option>
          <option value="koordinator">KO koordinatör</option>
        </select>
        <span className="mx-0.5 hidden opacity-20 sm:inline">|</span>
        {ajanSuzgec ? (
          <button
            type="button"
            onClick={() => setAjanSuzgec(null)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: `${ajanRengi(ajanSuzgec)}1a`, border: `1px solid ${ajanRengi(ajanSuzgec)}66`, color: RENK.metin }}
            title="Süzgeci kaldır — tüm ajanlar"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded text-[8px] font-black" style={ikonStili(ajanRengi(ajanSuzgec))}>{ajanKisaltma(ajanSuzgec)}</span>
            {ajanAd(ajanSuzgec)} <X size={10} />
          </button>
        ) : (
          <Cip aktif={false} onClick={() => setAjanSuzgec(seciliAjanId)} title="Seçili ajana daralt">
            tüm ajanlar
          </Cip>
        )}
      </div>

      <div className="px-3 pb-3">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-xs" style={{ color: RENK.ikincil }}>
            <Loader2 size={12} className="animate-spin" /> Yükleniyor…
          </div>
        ) : error ? (
          isOmurgaYok(error) ? (
            <OmurgaYokBilgi kucuk />
          ) : (
            <div className="py-4 text-xs" style={{ color: '#fca5a5' }}>İş listesi alınamadı: {(error as any)?.message || 'hata'}</div>
          )
        ) : !isler.length ? (
          <div className="py-8 text-center text-xs" style={{ color: RENK.ikincil }}>
            Henüz iş dosyası yok — bir ajana görev verince burada görünür.
          </div>
        ) : !suzulmus.length ? (
          <div className="flex flex-wrap items-center justify-center gap-2 py-6 text-center text-xs" style={{ color: RENK.ikincil }}>
            Bu süzgeçte iş yok.
            <Cip
              aktif={false}
              onClick={() => {
                setGun('tumu');
                setDurum('tumu');
                setMod('hepsi');
                setKaynak('');
                setAjanSuzgec(null);
              }}
            >
              Süzgeçleri kaldır
            </Cip>
          </div>
        ) : (
          <>
            {/* Masaüstü/tablet: tablo (kendi içinde kayar; sayfa kaymaz) */}
            <div className="hidden max-h-[380px] overflow-auto rounded-xl lg:block" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.35)', color: 'rgba(250,250,249,0.6)' }}>
                    <th className="px-2 py-1.5 text-left font-semibold">Saat</th>
                    <th className="px-1 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-semibold">Görev</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Mükellef</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Mod</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Kaynak</th>
                    <th className="px-2 py-1.5 text-right font-semibold" title="Araç sayısı">araç</th>
                    <th className="px-2 py-1.5 text-right font-semibold">süre</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Durum</th>
                    <th className="px-1 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {suzulmus.map((is, i) => {
                    const renk = ajanRengi(is.ajanId);
                    const acik = acikIsId === is.id;
                    return (
                      <Fragment key={is.id}>
                        <tr
                          id={`is-${is.id}`}
                          onClick={() => onAcikIsId(acik ? null : is.id)}
                          className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                          style={{ background: acik ? `${renk}12` : i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.05)' }}
                        >
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums" style={{ color: RENK.ikincil }}>{tarihKisa(is.createdAt)}</td>
                          <td className="px-1 py-1.5">
                            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-[9px] font-black" style={ikonStili(renk)} title={ajanAd(is.ajanId)}>
                              {ajanKisaltma(is.ajanId)}
                            </span>
                          </td>
                          <td className="max-w-[260px] px-2 py-1.5">
                            <div className="truncate font-medium" style={{ color: RENK.metin }} title={is.gorev}>{is.gorev}</div>
                            {is.status === 'failed' && is.hata && (
                              <div className="truncate text-[11px]" style={{ color: RENK.kirmizi }} title={is.hata}>{is.hata.slice(0, 120)}</div>
                            )}
                          </td>
                          <td className="max-w-[140px] truncate px-2 py-1.5" style={{ color: RENK.ikincil }} title={is.taxpayerId || ''}>
                            {is.taxpayerId ? mukellefAd(is.taxpayerId) || is.taxpayerId.slice(0, 8) : 'ofis'}
                          </td>
                          <td className="px-2 py-1.5"><ModRozet is={is} /></td>
                          <td className="px-2 py-1.5"><Kaynak is={is} /></td>
                          <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: RENK.ikincil }}>{is.toolSayisi ?? is.result?.toolUses?.length ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" style={{ color: RENK.ikincil }}>{sureKisa(is.durationMs ?? is.result?.durationMs ?? null) || '-'}</td>
                          <td className="px-2 py-1.5"><Durum is={is} /></td>
                          <td className="px-1 py-1.5">
                            <ChevronDown size={13} className="transition-transform" style={{ color: RENK.sonuk, transform: acik ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                          </td>
                        </tr>
                        {acik && (
                          <tr style={{ background: `${renk}08` }}>
                            <td colSpan={10} className="p-0">
                              <IsDetay id={is.id} ozet={is} mukellefAd={mukellefAd} onTaslak={onTaslak} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobil: kart-satır */}
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto lg:hidden">
              {suzulmus.map((is) => {
                const renk = ajanRengi(is.ajanId);
                const acik = acikIsId === is.id;
                return (
                  <div key={is.id} id={`is-m-${is.id}`} className="overflow-hidden rounded-xl" style={{ background: acik ? `${renk}10` : 'rgba(255,255,255,0.025)', border: `1px solid ${acik ? `${renk}44` : 'rgba(255,255,255,0.06)'}` }}>
                    <button type="button" onClick={() => onAcikIsId(acik ? null : is.id)} className="flex w-full items-start gap-2.5 px-2.5 py-2 text-left">
                      <span className="mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md text-[9px] font-black" style={ikonStili(renk)}>
                        {ajanKisaltma(is.ajanId)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs font-medium" style={{ color: RENK.metin }}>{is.gorev}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: RENK.ikincil }}>
                          <span className="tabular-nums">{tarihKisa(is.createdAt)}</span>
                          <ModRozet is={is} />
                          <span>{sureKisa(is.durationMs ?? is.result?.durationMs ?? null) || '-'}</span>
                          <Durum is={is} />
                        </span>
                        {is.status === 'failed' && is.hata && <span className="mt-0.5 block truncate text-[11px]" style={{ color: RENK.kirmizi }}>{is.hata.slice(0, 120)}</span>}
                      </span>
                      <ChevronDown size={13} className="mt-1 flex-shrink-0" style={{ color: RENK.sonuk, transform: acik ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                    </button>
                    {acik && <IsDetay id={is.id} ozet={is} mukellefAd={mukellefAd} onTaslak={onTaslak} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
});
