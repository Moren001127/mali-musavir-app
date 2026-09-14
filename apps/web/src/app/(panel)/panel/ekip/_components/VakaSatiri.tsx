'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, X, XCircle, Send, Square, MessageSquareReply, RotateCcw, ShieldAlert, ClipboardCheck, StickyNote, Wrench, FlaskConical, GraduationCap, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, iptalEt, istekKapat, onayla, reddet, type AcikKalem, type Vaka, type VakaAdim, type VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './KomutKutusu';
import type { Kosu, KosularApi } from './kosular';
import { CanliAkis } from './CanliAkis';
import { OnayTeyit } from './OnayBekleyenler';
import { DurumKelimesi } from './Kart';
import { SAKIN, ajanKisaAd, ajanKisaltma, aracAdi, cevapAyristir, goreliSaat, kutuRozeti, saatKisa, sakinAvatar, sakinDugme, sureKisa } from './ortak';

/** Küçük ajan avatarı (20/28px) — SAKİN: nötr daire, 2 harf; 'siz' → kehribar kenar "MB". */
export function MiniAvatar({ ajanId, boyut = 28, title, durum = 'bos' }: { ajanId: string; boyut?: 20 | 28; title?: string; durum?: 'bos' | 'calisiyor' | 'hata' }) {
  const siz = ajanId === 'siz';
  const px = boyut === 20 ? 'h-5 w-5 text-[8px]' : 'h-7 w-7 text-[9.5px]';
  return (
    <span className={`flex ${px} flex-shrink-0 items-center justify-center rounded-full font-bold tracking-wide`} style={sakinAvatar(siz ? 'siz' : durum)} title={title}>
      {siz ? 'MB' : ajanKisaltma(ajanId)}
    </span>
  );
}

function adimSuresi(a: VakaAdimIs): string {
  if (!a.baslangic || !a.bitis) return '';
  const ms = new Date(a.bitis).getTime() - new Date(a.baslangic).getTime();
  return isNaN(ms) || ms < 0 ? '' : sureKisa(ms);
}

function DurumIkonu({ durum }: { durum: VakaAdimIs['durum'] }) {
  if (durum === 'running') return <Loader2 size={11} className="animate-spin" style={{ color: SAKIN.vurguAcik }} />;
  if (durum === 'done') return <Check size={11} style={{ color: SAKIN.yesil }} />;
  if (durum === 'failed') return <X size={11} style={{ color: SAKIN.kirmiziAcik }} />;
  return <Clock size={11} style={{ color: SAKIN.gri }} />;
}

/** Zaman çizelgesi satırı — is / onay / bildirim. Sol kenar tek renk kılcal çizgi (ajan rengi yok). */
function CizelgeSatiri({ adim, ajanAd }: { adim: VakaAdim; ajanAd: (id: string) => string }) {
  const saat = saatKisa(adim.baslangic).slice(0, 5);
  const kenar = `2px solid ${SAKIN.cizgi}`;
  if (adim.tip === 'is') {
    return (
      <li className="flex min-w-0 items-start gap-2 py-1 pl-3 text-xs" style={{ borderLeft: adim.durum === 'running' ? `2px solid ${SAKIN.vurgu}` : kenar }}>
        <span className="mt-0.5 flex-shrink-0 tabular-nums" style={{ color: SAKIN.soluk }}>{saat}</span>
        <MiniAvatar ajanId={adim.ajanId} boyut={20} title={ajanAd(adim.ajanId)} durum={adim.durum === 'running' ? 'calisiyor' : adim.durum === 'failed' ? 'hata' : 'bos'} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-semibold" style={{ color: SAKIN.metin }}>{ajanKisaAd(adim.ajanId)}</span>
            <span className={`truncate ${adim.durum === 'running' ? 'animate-pulse' : ''}`} style={{ color: SAKIN.ikincil }} title={adim.baslik}>
              {adim.baslik}
            </span>
            <DurumIkonu durum={adim.durum} />
            {adimSuresi(adim) && <span className="tabular-nums" style={{ color: SAKIN.soluk }}>{adimSuresi(adim)}</span>}
            {adim.devir != null && (
              <span className="text-[10.5px]" style={{ color: SAKIN.soluk }} title="Ajanlar arası devir">
                → devir #{adim.devir}
              </span>
            )}
            {!adim.kuru && (
              <span className="text-[10.5px] font-semibold" style={{ color: SAKIN.kirmiziAcik }}>
                canlı
              </span>
            )}
          </span>
          {adim.durum === 'failed' && adim.hata && (
            <span className="mt-0.5 block truncate text-[11px]" style={{ color: SAKIN.kirmiziAcik }} title={adim.hata}>
              {adim.hata}
            </span>
          )}
        </span>
      </li>
    );
  }
  if (adim.tip === 'onay') {
    const renk = adim.durum === 'EXECUTED' ? SAKIN.yesil : adim.durum === 'PENDING' ? SAKIN.kehribar : SAKIN.gri;
    const durumAd = adim.durum === 'EXECUTED' ? 'gönderildi' : adim.durum === 'PENDING' ? 'onay bekliyor' : adim.durum === 'REJECTED' ? 'reddedildi' : adim.durum === 'EXPIRED' ? 'süresi doldu' : adim.durum;
    return (
      <li className="flex min-w-0 items-start gap-2 py-1 pl-3 text-xs" style={{ borderLeft: kenar }}>
        <span className="mt-0.5 flex-shrink-0 tabular-nums" style={{ color: SAKIN.soluk }}>{saat}</span>
        <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" style={{ color: SAKIN.kehribar }} />
        <span className="min-w-0 flex-1 truncate" style={{ color: SAKIN.ikincil }} title={adim.confirmationText || adim.baslik}>
          Onay kaydı <span className="font-mono text-[10.5px]">PRV-{adim.id.slice(0, 8)}</span> · <span style={{ color: renk }}>{durumAd}</span>
          {adim.baslik ? ` · ${adim.baslik}` : ''}
          {adim.hedef ? ` → ${adim.hedef}` : ''}
        </span>
      </li>
    );
  }
  return (
    <li className="flex min-w-0 items-start gap-2 py-1 pl-3 text-xs" style={{ borderLeft: kenar }}>
      <span className="mt-0.5 flex-shrink-0 tabular-nums" style={{ color: SAKIN.soluk }}>{saat}</span>
      <StickyNote size={14} className="mt-0.5 flex-shrink-0" style={{ color: adim.tur === 'istek' || adim.tur === 'onay' ? SAKIN.kehribar : SAKIN.ikincil }} />
      <span className="min-w-0 flex-1" style={{ color: SAKIN.ikincil }}>
        <span className="font-semibold" style={{ color: SAKIN.metin }}>Koordinatör notu:</span> {adim.baslik}
        {adim.durum === 'kapandi' && <span style={{ color: SAKIN.yesil }}> · kapandı</span>}
        {adim.govde && (
          <span className="mt-0.5 block whitespace-pre-wrap text-[11.5px]" style={{ color: SAKIN.ikincil }}>
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
    <div className="rounded-lg p-3" style={{ background: SAKIN.zemin, border: `1px solid ${SAKIN.kilcal}` }}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: renk }}>
        {ikon} {baslik} <span className="opacity-70">({ogeler.length})</span>
      </div>
      <ul className="space-y-1 text-xs" style={{ color: SAKIN.ikincil }}>
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
  const r = data?.result;
  const rapor = r?.rapor || adim.raporOzet || '';
  const ayrisik = useMemo(() => cevapAyristir(rapor), [rapor]);

  const tekrar = (
    <button
      type="button"
      onClick={() => onTaslak({ gorev: data?.gorev || adim.baslik || vaka.konu, taxpayerId: vaka.mukellef?.id, dryRun: true, kaynak: 'tekrar', vakaId: vaka.vakaId })}
      className="inline-flex w-fit items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold"
      style={sakinDugme('ikincil')}
      title="Komut kutusunu aynı görevle doldurur (kuru, aynı vakada); çalıştırmaz"
    >
      <RotateCcw size={11} /> Tekrar çalıştır (kuru)
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]" style={{ color: SAKIN.ikincil }}>
        <span className="font-semibold uppercase tracking-wider">Rapor</span>
        <span>· {ajanKisaAd(adim.ajanId)}</span>
        {(r?.durationMs ?? data?.durationMs) != null && <span>· {sureKisa(r?.durationMs ?? data?.durationMs)}</span>}
        {isLoading && !data && (
          <span className="inline-flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> tam metin yükleniyor
          </span>
        )}
        {!!error && <span style={{ color: SAKIN.kehribar }}>· tam metin alınamadı (özet gösteriliyor)</span>}
        <span className="ml-auto">{tekrar}</span>
      </div>
      {(data?.hata || adim.hata) && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(214,69,69,0.08)', border: `1px solid ${SAKIN.kirmizi}66`, color: SAKIN.metin }}>
          {data?.hata || adim.hata}
        </div>
      )}
      {(ayrisik.rapor || (!ayrisik.sorular.length && !ayrisik.ogrenilen.length && ayrisik.ham)) && (
        <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed" style={{ background: SAKIN.alan, border: `1px solid ${SAKIN.kilcal}`, color: SAKIN.metin }}>
          {ayrisik.rapor || ayrisik.ham}
        </div>
      )}
      {!rapor && !isLoading && (
        <div className="text-xs" style={{ color: SAKIN.ikincil }}>
          Henüz rapor yok{adim.durum === 'running' ? ' — iş sürüyor' : ''}.
        </div>
      )}
      {ayrisik.sorular.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: `${SAKIN.kehribar}0f`, border: `1px solid ${SAKIN.kehribar}55` }}>
          <div className="font-semibold" style={{ color: SAKIN.kehribar }}>{ajanKisaAd(adim.ajanId)} soruyor</div>
          {ayrisik.sorular.map((s, i) => (
            <div key={i} className="whitespace-pre-wrap" style={{ color: SAKIN.metin }}>{s}</div>
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
              className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-xs outline-none focus:[border-color:#4f86c9]"
              style={{ background: SAKIN.alan, border: `1px solid ${SAKIN.cizgi}`, color: SAKIN.metin }}
            />
            <button
              type="button"
              disabled={!cevapMetni.trim()}
              onClick={() => {
                onCevapla(cevapMetni.trim());
                setCevapMetni('');
              }}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={sakinDugme('birincil')}
              title="Komut kutusunu 'Cevap: …' ile doldurur (aynı vakada); çalıştırmaz"
            >
              <MessageSquareReply size={12} /> Cevapla
            </button>
          </div>
        </div>
      )}
      {ayrisik.ogrenilen.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <GraduationCap size={12} style={{ color: SAKIN.ikincil }} />
          {ayrisik.ogrenilen.map((o, i) => (
            <span key={i} className="rounded-md px-2 py-0.5 text-[11px]" style={{ background: SAKIN.zeminAcik, border: `1px solid ${SAKIN.kilcal}`, color: SAKIN.ikincil }}>
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
            renk={SAKIN.ikincil}
            ogeler={(r.toolUses || []).map((t, i) => (
              <span key={i}>
                <b style={{ color: SAKIN.metin }}>{aracAdi(t.name)}</b> <span className="opacity-60">{argsKisa(t.args)}</span>
              </span>
            ))}
          />
          <Liste
            baslik="Kuru test — yapacaktı"
            ikon={<FlaskConical size={11} />}
            renk={SAKIN.yesil}
            ogeler={(r.kuruTestYapilacaktilar || []).map((t, i) => (
              <span key={i}>
                <b style={{ color: SAKIN.metin }}>{aracAdi(t.name)}</b> <span className="opacity-60">{argsKisa(t.args)}</span>
              </span>
            ))}
          />
          <Liste
            baslik="Onay bekleyen"
            ikon={<ShieldAlert size={11} />}
            renk={SAKIN.kehribar}
            ogeler={(r.onayBekleyen || []).map((o, i) => (
              <span key={i}>{typeof o === 'string' ? o : o?.previewId ? `#${o.previewId} · ${aracAdi(o.name)}` : o?.aciklama || o?.name || argsKisa(o)}</span>
            ))}
          />
          <Liste baslik="Öğrenilen" ikon={<GraduationCap size={11} />} renk={SAKIN.ikincil} ogeler={(r.ogrenilen || []).map((o, i) => <span key={i}>{o}</span>)} />
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
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: `${SAKIN.kehribar}0d`, border: `1px solid ${SAKIN.kehribar}55` }}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {onayMi ? <ShieldAlert size={13} style={{ color: SAKIN.kehribar }} /> : <ClipboardCheck size={13} style={{ color: SAKIN.kehribar }} />}
        <span className="font-semibold" style={{ color: SAKIN.kehribar }}>{onayMi ? 'Onayınızı bekliyor' : 'Sizden istenen'}</span>
        <span className="min-w-0 flex-1 truncate" style={{ color: SAKIN.metin }} title={kalem.confirmationText || kalem.baslik}>
          {kalem.baslik}
        </span>
        {sonuc ? (
          <span className="text-[11px] font-semibold" style={{ color: sonuc.startsWith('Hata') ? SAKIN.kirmiziAcik : SAKIN.yesil }}>{sonuc}</span>
        ) : onayMi ? (
          <>
            <button type="button" disabled={mesgul || teyit} onClick={() => setTeyit(true)} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50" style={sakinDugme('birincil')}>
              {mesgul ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Onayla ve gönder
            </button>
            <button type="button" disabled={mesgul} onClick={redGercek} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50" style={sakinDugme('tehlike')}>
              <XCircle size={11} /> Reddet
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={mesgul}
            onClick={istekBitir}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50"
            style={sakinDugme('birincil')}
            title="Fiş yüklendi / istenen yapıldı → kalem kapanır, Koordinatör devam eder"
          >
            {mesgul ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Yüklendi / Yapıldı
          </button>
        )}
      </div>
      {kalem.confirmationText && !sonuc && (
        <div className="mt-1.5 line-clamp-3 whitespace-pre-wrap rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed" style={{ background: SAKIN.alan, color: SAKIN.ikincil }}>
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
 * Vaka satırı — iş dosyası zinciri. SAKİN: kapalı satır = mükellef · konu | kimde | durum (kelime+nokta) | saat; "KURU" yazılmaz, yalnız canlı işaretlenir.
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

  const dikkat = vaka.kutu === 'onay' || vaka.kutu === 'istek';

  return (
    <li
      className="overflow-hidden rounded-lg transition-[border-color,background-color] duration-150"
      style={{
        background: acik ? SAKIN.zeminAcik : SAKIN.zemin,
        border: `1px solid ${acik ? `${SAKIN.vurgu}55` : dikkat ? `${SAKIN.kehribar}44` : vaka.gecikti ? `${SAKIN.kirmizi}55` : SAKIN.kilcal}`,
      }}
    >
      {/* Kapalı satır (tık → açılır) */}
      <button type="button" onClick={onToggle} className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left" aria-expanded={acik}>
        <MiniAvatar ajanId={vaka.kimde.ajanId} boyut={28} title={siz ? 'Muzaffer Bey' : ajanAd(vaka.kimde.ajanId)} durum={kosuyor ? 'calisiyor' : vaka.durum === 'hata' ? 'hata' : 'bos'} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-x-2">
            <span className="max-w-[46%] truncate text-[12.5px] font-semibold" style={{ color: SAKIN.metin }} title={vaka.mukellef?.ad || 'Ofis geneli'}>
              {vaka.mukellef?.ad || 'Ofis geneli'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: SAKIN.ikincil }} title={vaka.konu}>
              {vaka.konu || 'Konu yok'}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]" style={{ color: SAKIN.soluk }}>
            <span>
              kimde: <span style={{ color: siz ? SAKIN.kehribar : SAKIN.ikincil }}>{siz ? 'Siz' : ajanKisaAd(vaka.kimde.ajanId, vaka.kimde.ad)}</span>
            </span>
            <span className="tabular-nums">{goreliSaat(vaka.guncellendi)}</span>
            {vaka.adimlar.length > 1 && <span>{vaka.adimlar.length} adım</span>}
            {!vaka.kuru && (
              <span className="font-semibold" style={{ color: SAKIN.kirmiziAcik }}>
                canlı
              </span>
            )}
            {vaka.gecikti && (
              <span className="font-semibold" style={{ color: SAKIN.kirmiziAcik }} title="2 devirden fazla dolaştı ya da 24 saatte çözülmedi">
                gecikti
              </span>
            )}
          </span>
        </span>

        <span className="flex flex-shrink-0 items-center gap-3">
          <DurumKelimesi renk={rozet.renk} nabiz={nabiz}>
            {rozet.ad}
          </DurumKelimesi>
          <ChevronDown size={13} className="transition-transform" style={{ color: SAKIN.soluk, transform: acik ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        </span>
      </button>

      {acik && (
        <div className="flex min-w-0 flex-col gap-3 px-3 pb-3 pt-1" style={{ borderTop: `1px solid ${SAKIN.kilcal}` }}>
          {/* (c) Satır içi eylemler — açık kalemler her zaman görünür */}
          {vaka.acikKalemler.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-2">
              {vaka.acikKalemler.map((k) => (
                <AcikKalemSatiri key={`${k.tip}-${k.id}`} kalem={k} onBitti={tazele} />
              ))}
            </div>
          )}

          {/* (a) Zaman çizelgesi */}
          {vaka.adimlar.length > 0 && (
            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto pt-1">
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
              <button type="button" onClick={durdur} disabled={durduruluyor} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50" style={sakinDugme('tehlike')} title="Koşu sunucuda durdurulur; iş dosyası 'iptal edildi (Muzaffer Bey)' olarak kapanır">
                {durduruluyor ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />} Durdur
              </button>
            )}
            <button
              type="button"
              onClick={() => onTaslak({ gorev: '', taxpayerId: vaka.mukellef?.id, dryRun: true, kaynak: 'cevap', vakaId: vaka.vakaId })}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold"
              style={sakinDugme('ikincil')}
              title="Komut kutusunu bu vakaya bağlar; Koordinatör aynı zincirde devam eder"
            >
              <MessageSquareReply size={11} /> Cevapla
            </button>
            <span className="ml-auto font-mono text-[10px]" style={{ color: SAKIN.soluk }} title="Vaka kimliği">
              #{vaka.vakaId.slice(0, 8)} · açıldı {goreliSaat(vaka.olusturuldu)}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
