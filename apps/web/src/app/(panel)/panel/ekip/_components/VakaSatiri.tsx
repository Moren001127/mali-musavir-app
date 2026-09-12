'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, X, XCircle, Send, Square, MessageSquareReply, RotateCcw, ShieldAlert, ClipboardCheck, StickyNote, Wrench, FlaskConical, GraduationCap, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, iptalEt, istekKapat, onayla, reddet, type AcikKalem, type Vaka, type VakaAdim, type VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './KomutKutusu';
import type { Kosu, KosularApi } from './kosular';
import { CanliAkis } from './CanliAkis';
import { OnayTeyit } from './OnayBekleyenler';
import { EKIP_ACCENT, RENK, ajanKisaAd, ajanKisaltma, ajanRengi, aracAdi, avatarHalkaStili, cevapAyristir, goreliSaat, kutuRozeti, saatKisa, sureKisa } from './ortak';

/** Küçük ajan avatarı (20/28px) — 'siz' → altın halka, "MB". */
export function MiniAvatar({ ajanId, boyut = 28, title }: { ajanId: string; boyut?: 20 | 28; title?: string }) {
  const siz = ajanId === 'siz';
  const renk = siz ? RENK.altin : ajanRengi(ajanId);
  const px = boyut === 20 ? 'h-5 w-5 text-[8px]' : 'h-7 w-7 text-[9.5px]';
  return (
    <span className={`relative flex ${px} flex-shrink-0 items-center justify-center rounded-full p-[1.5px]`} style={avatarHalkaStili(renk, false)} title={title}>
      <span className="flex h-full w-full items-center justify-center rounded-full font-black tracking-wide" style={{ background: 'linear-gradient(160deg, #1a1815, #0b0a08)', color: renk }}>
        {siz ? 'MB' : ajanKisaltma(ajanId)}
      </span>
    </span>
  );
}

function adimSuresi(a: VakaAdimIs): string {
  if (!a.baslangic || !a.bitis) return '';
  const ms = new Date(a.bitis).getTime() - new Date(a.baslangic).getTime();
  return isNaN(ms) || ms < 0 ? '' : sureKisa(ms);
}

function DurumIkonu({ durum }: { durum: VakaAdimIs['durum'] }) {
  if (durum === 'running') return <Loader2 size={11} className="animate-spin" style={{ color: EKIP_ACCENT }} />;
  if (durum === 'done') return <Check size={11} style={{ color: RENK.yesil }} />;
  if (durum === 'failed') return <X size={11} style={{ color: RENK.kirmizi }} />;
  return <Clock size={11} style={{ color: RENK.gri }} />;
}

/** Zaman çizelgesi satırı — is / onay / bildirim. */
function CizelgeSatiri({ adim, ajanAd }: { adim: VakaAdim; ajanAd: (id: string) => string }) {
  const saat = saatKisa(adim.baslangic).slice(0, 5);
  if (adim.tip === 'is') {
    const renk = ajanRengi(adim.ajanId);
    return (
      <li className="flex min-w-0 items-start gap-2 py-1 pl-3 text-xs" style={{ borderLeft: `2px solid ${renk}` }}>
        <span className="mt-0.5 flex-shrink-0 tabular-nums" style={{ color: RENK.sonuk }}>{saat}</span>
        <MiniAvatar ajanId={adim.ajanId} boyut={20} title={ajanAd(adim.ajanId)} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-semibold" style={{ color: RENK.metin }}>{ajanKisaAd(adim.ajanId)}</span>
            <span className={`truncate ${adim.durum === 'running' ? 'animate-pulse' : ''}`} style={{ color: 'rgba(250,250,249,0.85)' }} title={adim.baslik}>
              {adim.baslik}
            </span>
            <DurumIkonu durum={adim.durum} />
            {adimSuresi(adim) && <span className="tabular-nums" style={{ color: RENK.sonuk }}>{adimSuresi(adim)}</span>}
            {adim.devir != null && (
              <span className="rounded-full px-1.5 text-[9.5px] font-bold leading-4" style={{ background: `${RENK.mor}1a`, border: `1px solid ${RENK.mor}55`, color: '#c4b5fd' }} title="Ajanlar arası devir">
                → devir #{adim.devir}
              </span>
            )}
            <span className="rounded-full px-1.5 text-[9.5px] font-bold leading-4" style={adim.kuru ? { background: 'rgba(74,222,128,0.12)', color: '#86efac' } : { background: 'rgba(248,113,113,0.16)', color: '#fca5a5' }}>
              {adim.kuru ? 'KURU' : 'CANLI'}
            </span>
          </span>
          {adim.durum === 'failed' && adim.hata && (
            <span className="mt-0.5 block truncate text-[11px]" style={{ color: RENK.kirmizi }} title={adim.hata}>
              {adim.hata}
            </span>
          )}
        </span>
      </li>
    );
  }
  if (adim.tip === 'onay') {
    const renk = adim.durum === 'EXECUTED' ? RENK.yesil : adim.durum === 'PENDING' ? RENK.turuncu : RENK.gri;
    return (
      <li className="flex min-w-0 items-start gap-2 py-1 pl-3 text-xs" style={{ borderLeft: `2px solid ${RENK.altin}` }}>
        <span className="mt-0.5 flex-shrink-0 tabular-nums" style={{ color: RENK.sonuk }}>{saat}</span>
        <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" style={{ color: RENK.altin }} />
        <span className="min-w-0 flex-1 truncate" style={{ color: 'rgba(250,250,249,0.85)' }} title={adim.confirmationText || adim.baslik}>
          Onay kaydı <span className="font-mono text-[10.5px]">PRV-{adim.id.slice(0, 8)}</span> · <span style={{ color: renk }}>{adim.durum}</span>
          {adim.baslik ? ` · ${adim.baslik}` : ''}
          {adim.hedef ? ` → ${adim.hedef}` : ''}
        </span>
      </li>
    );
  }
  return (
    <li className="flex min-w-0 items-start gap-2 py-1 pl-3 text-xs" style={{ borderLeft: `2px solid ${ajanRengi('koordinator')}` }}>
      <span className="mt-0.5 flex-shrink-0 tabular-nums" style={{ color: RENK.sonuk }}>{saat}</span>
      <StickyNote size={14} className="mt-0.5 flex-shrink-0" style={{ color: adim.tur === 'istek' ? RENK.turuncu : adim.tur === 'onay' ? RENK.altin : RENK.ikincil }} />
      <span className="min-w-0 flex-1" style={{ color: 'rgba(250,250,249,0.85)' }}>
        <span className="font-semibold" style={{ color: RENK.metin }}>Koordinatör notu:</span> {adim.baslik}
        {adim.durum === 'kapandi' && <span style={{ color: RENK.yesil }}> · kapandı</span>}
        {adim.govde && (
          <span className="mt-0.5 block whitespace-pre-wrap text-[11.5px]" style={{ color: RENK.ikincil }}>
            {adim.govde}
          </span>
        )}
      </span>
    </li>
  );
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

function argsKisa(args: any): string {
  if (args == null) return '';
  try {
    const s = typeof args === 'string' ? args : JSON.stringify(args);
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  } catch {
    return '';
  }
}

/** Rapor alanı — son biten adımın tam raporu (GET /ekip/isler/:id tembel); RAPOR/SORU/ÖĞRENDİM ayrımı; Tekrar çalıştır (kuru). */
function RaporAlani({ adim, vaka, onTaslak, onCevapla }: { adim: VakaAdimIs; vaka: Vaka; onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void; onCevapla: (metin: string) => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['ekip-is', adim.isId], queryFn: () => getIs(adim.isId), staleTime: 15_000, retry: 1 });
  const [cevapMetni, setCevapMetni] = useState('');
  const renk = ajanRengi(adim.ajanId);
  const r = data?.result;
  const rapor = r?.rapor || adim.raporOzet || '';
  const ayrisik = useMemo(() => cevapAyristir(rapor), [rapor]);

  const tekrar = (
    <button
      type="button"
      onClick={() => onTaslak({ gorev: data?.gorev || adim.baslik || vaka.konu, taxpayerId: vaka.mukellef?.id, dryRun: true, kaynak: 'tekrar', vakaId: vaka.vakaId })}
      className="inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold transition-[transform] duration-150 hover:-translate-y-px"
      style={{ background: `${renk}14`, border: `1px solid ${renk}55`, color: RENK.metin }}
      title="Komut kutusunu aynı görevle doldurur (kuru, aynı vakada); çalıştırmaz"
    >
      <RotateCcw size={11} style={{ color: renk }} /> Tekrar çalıştır (kuru)
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]" style={{ color: RENK.ikincil }}>
        <span className="font-bold uppercase tracking-wider">Rapor</span>
        <span>· {ajanKisaAd(adim.ajanId)}</span>
        {(r?.model || data?.model) && <span>· {r?.model || data?.model}</span>}
        {(r?.durationMs ?? data?.durationMs) != null && <span>· {sureKisa(r?.durationMs ?? data?.durationMs)}</span>}
        {isLoading && !data && (
          <span className="inline-flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> tam metin yükleniyor
          </span>
        )}
        {!!error && <span style={{ color: RENK.turuncu }}>· tam metin alınamadı (özet gösteriliyor)</span>}
        <span className="ml-auto">{tekrar}</span>
      </div>
      {(data?.hata || adim.hata) && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}>
          ⚠️ {data?.hata || adim.hata}
        </div>
      )}
      {(ayrisik.rapor || (!ayrisik.sorular.length && !ayrisik.ogrenilen.length && ayrisik.ham)) && (
        <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${renk}33`, color: 'rgba(250,250,249,0.92)' }}>
          {ayrisik.rapor || ayrisik.ham}
        </div>
      )}
      {!rapor && !isLoading && (
        <div className="text-xs" style={{ color: RENK.ikincil }}>
          Henüz rapor yok{adim.durum === 'running' ? ' — iş sürüyor' : ''}.
        </div>
      )}
      {ayrisik.sorular.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: `${RENK.turuncu}12`, border: `1px solid ${RENK.turuncu}55` }}>
          <div className="font-bold" style={{ color: RENK.turuncu }}>{ajanKisaAd(adim.ajanId)} soruyor</div>
          {ayrisik.sorular.map((s, i) => (
            <div key={i} className="whitespace-pre-wrap" style={{ color: RENK.metin }}>{s}</div>
          ))}
          <div className="flex gap-2">
            <input
              value={cevapMetni}
              onChange={(e) => setCevapMetni(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cevapMetni.trim()) {
                  e.preventDefault();
                  onCevapla(cevapMetni.trim());
                  setCevapMetni('');
                }
              }}
              placeholder="Cevabını yaz…"
              className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
              style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${RENK.turuncu}44`, color: RENK.metin }}
            />
            <button
              type="button"
              disabled={!cevapMetni.trim()}
              onClick={() => {
                onCevapla(cevapMetni.trim());
                setCevapMetni('');
              }}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${RENK.turuncu}, ${RENK.turuncu}aa)`, color: '#0f0d0b' }}
              title="Komut kutusunu 'Cevap: …' ile doldurur (aynı vakada); çalıştırmaz"
            >
              <MessageSquareReply size={12} /> Cevapla
            </button>
          </div>
        </div>
      )}
      {ayrisik.ogrenilen.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <GraduationCap size={12} style={{ color: RENK.mor }} />
          {ayrisik.ogrenilen.map((o, i) => (
            <span key={i} className="rounded-md px-2 py-0.5 text-[11px]" style={{ background: `${RENK.mor}1a`, border: `1px solid ${RENK.mor}55`, color: '#c4b5fd' }}>
              {o}
            </span>
          ))}
        </div>
      )}
      {r && (
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
      )}
    </div>
  );
}

/** Satır içi açık kalem — onay (Onayla/Reddet + OnayTeyit) ya da istek (Yüklendi / Yapıldı). Hover'a saklanmaz. */
function AcikKalemSatiri({ kalem, onBitti }: { kalem: AcikKalem; onBitti: () => void }) {
  const [teyit, setTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [sonuc, setSonuc] = useState<string | null>(null);

  const onayGercek = async () => {
    if (mesgul) return;
    setMesgul(true);
    try {
      const r = await onayla(kalem.id);
      setSonuc(r.ok ? 'Gönderildi ✓' : `Hata: ${r.error || 'gönderilemedi'}`);
    } catch (e: any) {
      setSonuc(`Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      setTeyit(false);
      onBitti();
    }
  };
  const redGercek = async () => {
    if (mesgul) return;
    setMesgul(true);
    try {
      const r = await reddet(kalem.id, 'Akıştan reddedildi');
      setSonuc(r.ok ? 'Reddedildi' : `Hata: ${r.error || ''}`);
    } catch (e: any) {
      setSonuc(`Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      onBitti();
    }
  };
  const istekBitir = async () => {
    if (mesgul) return;
    setMesgul(true);
    try {
      const r = await istekKapat(kalem.id);
      if (r.ok) {
        setSonuc(r.zatenKapali ? 'Zaten kapalıydı' : 'Yapıldı ✓');
        toast.success('İstek kapatıldı', { description: 'Koordinatör vakayı sürdürür.' });
      } else setSonuc(`Hata: ${r.error || 'kapatılamadı'}`);
    } catch (e: any) {
      setSonuc(`Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      onBitti();
    }
  };

  const onayMi = kalem.tip === 'onay';
  const renk = onayMi ? RENK.altin : RENK.turuncu;
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: `${renk}0f`, border: `1px solid ${renk}55` }}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {onayMi ? <ShieldAlert size={13} style={{ color: renk }} /> : <ClipboardCheck size={13} style={{ color: renk }} />}
        <span className="font-bold" style={{ color: renk }}>{onayMi ? 'Onayınızı bekliyor' : 'Sizden istenen'}</span>
        <span className="min-w-0 flex-1 truncate" style={{ color: RENK.metin }} title={kalem.confirmationText || kalem.baslik}>
          {kalem.baslik}
        </span>
        {sonuc ? (
          <span className="text-[11px] font-semibold" style={{ color: sonuc.startsWith('Hata') ? RENK.kirmizi : RENK.yesil }}>{sonuc}</span>
        ) : onayMi ? (
          <>
            <button
              type="button"
              disabled={mesgul || teyit}
              onClick={() => setTeyit(true)}
              className="flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-bold transition-[transform] duration-150 hover:-translate-y-px disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#16a34a,#4ade80)', color: '#052e16' }}
            >
              {mesgul ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Onayla ve gönder
            </button>
            <button
              type="button"
              disabled={mesgul}
              onClick={redGercek}
              className="flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-semibold disabled:opacity-50"
              style={{ background: 'rgba(248,113,113,0.15)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.35)' }}
            >
              <XCircle size={11} /> Reddet
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={mesgul}
            onClick={istekBitir}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-bold transition-[transform] duration-150 hover:-translate-y-px disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${RENK.turuncu}, ${RENK.turuncu}aa)`, color: '#0f0d0b' }}
            title="Fiş yüklendi / istenen yapıldı → kalem kapanır, Koordinatör devam eder"
          >
            {mesgul ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Yüklendi / Yapıldı
          </button>
        )}
      </div>
      {kalem.confirmationText && !sonuc && (
        <div className="mt-1.5 line-clamp-3 whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', color: 'rgba(250,250,249,0.85)' }}>
          {kalem.confirmationText}
        </div>
      )}
      {teyit && !sonuc && (
        <OnayTeyit
          metin={
            <>
              Bu mesaj <b>GERÇEKTEN</b> gidecek → #{kalem.id}
            </>
          }
          mesgul={mesgul}
          onEvet={onayGercek}
          onVazgec={() => setTeyit(false)}
        />
      )}
    </div>
  );
}

/**
 * Vaka satırı — iş dosyası zinciri. Kapalı: mükellef · konu · kimde · durum rozeti · gecikti · göreli saat · kuru/canlı.
 * Açık: (a) zaman çizelgesi (b) son biten adımın raporu (c) satır içi eylemler (her zaman görünür) (d) çalışan koşunun SSE'si.
 */
export function VakaSatiri({
  vaka,
  acik,
  onToggle,
  kosu,
  kosular,
  ajanAd,
  onTaslak,
}: {
  vaka: Vaka;
  acik: boolean;
  onToggle: () => void;
  /** Bu vakayla eşleşen yerel koşu (SSE) — varsa satır içinde canlı akar. */
  kosu?: Kosu;
  kosular: KosularApi;
  ajanAd: (id: string) => string;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
}) {
  const qc = useQueryClient();
  const [durduruluyor, setDurduruluyor] = useState(false);
  const rozet = kutuRozeti(vaka);
  const siz = vaka.kimde.ajanId === 'siz';
  const kosuyor = (!!kosu && !kosu.bitti) || vaka.adimlar.some((a) => a.tip === 'is' && a.durum === 'running');
  const nabiz = rozet.nabiz && kosuyor;

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
  };

  const isAdimlari = vaka.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
  const kosanAdim = isAdimlari.find((a) => a.durum === 'running');
  const sonBiten = [...isAdimlari].reverse().find((a) => a.durum === 'done' || a.durum === 'failed');
  const yerelKosuyor = !!kosu && !kosu.bitti;

  const durdur = async () => {
    if (durduruluyor) return;
    setDurduruluyor(true);
    try {
      if (yerelKosuyor) await kosular.durdur(kosu!.ajanId);
      else if (kosanAdim) {
        const r = await iptalEt(kosanAdim.isId);
        if (r.ok) toast.success('Durduruldu', { description: 'İş dosyası "iptal edildi (Muzaffer Bey)" olarak kapandı.' });
        else toast.error('Durdurulamadı', { description: r.error });
      }
    } finally {
      setDurduruluyor(false);
      tazele();
    }
  };

  const cevapla = (metin: string) => onTaslak({ gorev: `Cevap: ${metin}`, taxpayerId: vaka.mukellef?.id, dryRun: true, kaynak: 'cevap', vakaId: vaka.vakaId });

  return (
    <li
      className="overflow-hidden rounded-xl transition-[border-color,background-color] duration-150"
      style={{
        background: acik ? `${rozet.renk}0c` : 'rgba(255,255,255,0.025)',
        border: `1px solid ${acik ? `${rozet.renk}55` : vaka.gecikti ? `${RENK.kirmizi}66` : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      {/* Kapalı satır (tık → açılır) */}
      <button type="button" onClick={onToggle} className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left" aria-expanded={acik}>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="max-w-[46%] truncate text-[12.5px] font-bold" style={{ color: RENK.metin }} title={vaka.mukellef?.ad || 'Ofis geneli'}>
              {vaka.mukellef?.ad || '—'}
            </span>
            <span className="text-[11px]" style={{ color: RENK.sonuk }}>·</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: 'rgba(250,250,249,0.85)' }} title={vaka.konu}>
              {vaka.konu || 'Konu yok'}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]" style={{ color: RENK.ikincil }}>
            <span className="inline-flex items-center gap-1">
              kimde: <MiniAvatar ajanId={vaka.kimde.ajanId} boyut={20} title={siz ? 'Muzaffer Bey' : ajanAd(vaka.kimde.ajanId)} />
              <span style={{ color: siz ? RENK.altin : RENK.metin }}>{siz ? 'Siz' : ajanKisaAd(vaka.kimde.ajanId, vaka.kimde.ad)}</span>
            </span>
            <span className="tabular-nums">{goreliSaat(vaka.guncellendi)}</span>
            {vaka.adimlar.length > 1 && <span>{vaka.adimlar.length} adım</span>}
          </span>
        </span>

        <span className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
          {vaka.gecikti && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ border: `1px solid ${RENK.kirmizi}`, color: RENK.kirmizi }} title="2 devirden fazla dolaştı ya da 24 saatte çözülmedi">
              <AlertTriangle size={10} /> gecikti
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${rozet.renk}1a`, border: `1px solid ${rozet.renk}55`, color: rozet.renk }}>
            {nabiz && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: rozet.renk, boxShadow: `0 0 6px ${rozet.renk}` }} />}
            {rozet.ad}
          </span>
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={vaka.kuru ? { background: 'rgba(74,222,128,0.12)', color: '#86efac' } : { background: 'rgba(248,113,113,0.16)', color: '#fca5a5' }}>
            {vaka.kuru ? 'KURU' : 'CANLI'}
          </span>
          <ChevronDown size={13} className="transition-transform" style={{ color: RENK.sonuk, transform: acik ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        </span>
      </button>

      {acik && (
        <div className="flex min-w-0 flex-col gap-3 px-3 pb-3 pt-1">
          {/* (c) Satır içi eylemler — açık kalemler her zaman görünür */}
          {vaka.acikKalemler.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {vaka.acikKalemler.map((k) => (
                <AcikKalemSatiri key={`${k.tip}-${k.id}`} kalem={k} onBitti={tazele} />
              ))}
            </div>
          )}

          {/* (a) Zaman çizelgesi */}
          {vaka.adimlar.length > 0 && (
            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {vaka.adimlar.map((a, i) => (
                <CizelgeSatiri key={`${a.tip}-${(a as any).isId || (a as any).id || i}`} adim={a} ajanAd={ajanAd} />
              ))}
            </ul>
          )}

          {/* (d) Çalışan koşunun SSE akışı satır içinde */}
          {kosu && <CanliAkis kosu={kosu} kosular={kosular} onCevapla={cevapla} />}

          {/* (b) Rapor — son biten adım (yerel koşu bitmişse zaten rapor CanliAkis'te) */}
          {sonBiten && !(kosu && kosu.bitti && kosu.isId === sonBiten.isId) && <RaporAlani adim={sonBiten} vaka={vaka} onTaslak={onTaslak} onCevapla={cevapla} />}

          {/* Alt eylem çubuğu */}
          <div className="flex flex-wrap items-center gap-2">
            {(yerelKosuyor || kosanAdim) && (
              <button
                type="button"
                onClick={durdur}
                disabled={durduruluyor}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold disabled:opacity-50"
                style={{ background: 'rgba(248,113,113,0.10)', border: `1px solid ${RENK.kirmizi}`, color: '#fca5a5' }}
                title="Koşu sunucuda durdurulur; iş dosyası 'iptal edildi (Muzaffer Bey)' olarak kapanır"
              >
                {durduruluyor ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />} Durdur
              </button>
            )}
            <button
              type="button"
              onClick={() => onTaslak({ gorev: '', taxpayerId: vaka.mukellef?.id, dryRun: true, kaynak: 'cevap', vakaId: vaka.vakaId })}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold transition-[transform] duration-150 hover:-translate-y-px"
              style={{ background: `${EKIP_ACCENT}12`, border: `1px solid ${EKIP_ACCENT}44`, color: RENK.metin }}
              title="Komut kutusunu bu vakaya bağlar; Koordinatör aynı zincirde devam eder"
            >
              <MessageSquareReply size={11} style={{ color: EKIP_ACCENT }} /> Cevapla
            </button>
            <span className="ml-auto font-mono text-[10px]" style={{ color: RENK.sonuk }} title="Vaka kimliği">
              #{vaka.vakaId.slice(0, 8)} · açıldı {goreliSaat(vaka.olusturuldu)}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
