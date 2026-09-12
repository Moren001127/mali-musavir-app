'use client';

import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2, Send, XCircle, RefreshCw, ChevronDown, ChevronUp, FolderOpen, History } from 'lucide-react';
import { onayla, reddet, isOmurgaYok, type EkipOnay } from '@/lib/ekip';
import { SORGU } from './kosular';
import { BosDurum, Kart } from './Kart';
import { ajanRengi, ajanKisaltma, aracAdi, ikonStili, kalanSure, RENK, tarihKisa, telefonMaskele, telefonMu } from './ortak';

const ALTIN = RENK.altin; // Onay = altın (yalnız şerit + sekme sayacı)

/**
 * Kart içi iki adımlı teyit — tarayıcı onay penceresi kullanılmaz.
 * 5 sn sonra kendiliğinden kapanır; `mesgul` çift tıkı keser. CanliAkis ve OnayKuyrugu ortak kullanır.
 */
export function OnayTeyit({
  metin,
  evetEtiketi = 'Evet, gönder',
  mesgul,
  onEvet,
  onVazgec,
}: {
  metin: ReactNode;
  evetEtiketi?: string;
  mesgul: boolean;
  onEvet: () => void;
  onVazgec: () => void;
}) {
  const [kalan, setKalan] = useState(5);
  // Üst bileşen saniyede bir yeniden çizilse de (canlı sayaç) geri sayım sıfırlanmasın: sayaç render'dan bağımsız
  const vazgecRef = useRef(onVazgec);
  vazgecRef.current = onVazgec;
  useEffect(() => {
    if (mesgul) return;
    const t = setInterval(() => setKalan((k) => k - 1), 1000);
    return () => clearInterval(t);
  }, [mesgul]);
  useEffect(() => {
    if (kalan <= 0 && !mesgul) vazgecRef.current();
  }, [kalan, mesgul]);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl px-3 py-2 text-[12.5px]" style={{ background: 'rgba(248,113,113,0.10)', border: `1px solid ${RENK.kirmizi}`, color: '#fecaca' }}>
      <span className="min-w-0 leading-snug">{metin}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={mesgul}
          onClick={onEvet}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-bold disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#dc2626,#f87171)', color: '#fff' }}
        >
          {mesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {evetEtiketi}
        </button>
        <button
          type="button"
          disabled={mesgul}
          onClick={onVazgec}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: RENK.metin }}
        >
          Vazgeç {!mesgul && <span className="opacity-60">({kalan})</span>}
        </button>
      </div>
    </div>
  );
}

/** Hedef: telefon ise maskeli, taxpayerId ise mükellef adı (backend #7 `mukellefAd` varsa o). */
export function hedefMetni(o: EkipOnay, mukellefAd: (id?: string | null) => string | undefined): string {
  if (o.mukellefAd) return o.mukellefAd;
  if (!o.hedef) return '';
  if (telefonMu(o.hedef)) return telefonMaskele(o.hedef);
  return mukellefAd(o.hedef) || o.hedef;
}

function DurumRozeti({ o }: { o: EkipOnay }) {
  const m: Record<string, { ad: string; renk: string }> = {
    EXECUTED: { ad: `Gönderildi ${tarihKisa(o.approvedAt || o.createdAt)}`, renk: RENK.yesil },
    REJECTED: { ad: 'Reddedildi', renk: RENK.gri },
    EXPIRED: { ad: 'Süresi doldu', renk: RENK.turuncu },
    PENDING: { ad: 'Bekliyor', renk: RENK.turuncu },
  };
  const d = m[o.status] || m.PENDING;
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${d.renk}1a`, border: `1px solid ${d.renk}44`, color: d.renk }}>
      {d.ad}
    </span>
  );
}

/** Onay/ret mekaniği — şerit ve sekme aynı kancayı kullanır. */
function useOnayIslemleri() {
  const qc = useQueryClient();
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [teyit, setTeyit] = useState<string | null>(null); // previewId
  const [sonuc, setSonuc] = useState<Record<string, string>>({});

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-isler'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] }); // kadro[].bekleyenOnay rozeti eski sayıda kalmasın
  };

  const onaylaGercek = async (o: EkipOnay) => {
    if (mesgul) return;
    setMesgul(o.previewId);
    try {
      const r = await onayla(o.previewId);
      setSonuc((s) => ({ ...s, [o.previewId]: r.ok ? 'Gönderildi.' : `Hata: ${r.error || 'gönderilemedi'}` }));
    } catch (e: any) {
      setSonuc((s) => ({ ...s, [o.previewId]: `Hata: ${e?.message || e}` }));
    } finally {
      setMesgul(null);
      setTeyit(null);
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

  return { mesgul, teyit, setTeyit, sonuc, tazele, onaylaGercek, reddetTikla };
}

/** Bekleyen onay satırı — ajan · araç → hedef · mesaj · kalan süre · Onayla / Reddet (+ kart içi teyit). */
function BekleyenSatir({
  o,
  mukellefAd,
  onIsAc,
  islem,
}: {
  o: EkipOnay;
  mukellefAd: (id?: string | null) => string | undefined;
  onIsAc: (isId: string) => void;
  islem: ReturnType<typeof useOnayIslemleri>;
}) {
  const [mesajAcik, setMesajAcik] = useState(false);
  const renk = ajanRengi(o.ajanId);
  const mesgulMu = islem.mesgul === o.previewId;
  const hedef = hedefMetni(o, mukellefAd);
  const kalan = kalanSure(o.expiresAt);
  const azKaldi = kalan.ms > 0 && kalan.ms < 2 * 3_600_000;
  const mesaj = o.mesaj || (o.payload ? JSON.stringify(o.payload) : '');
  return (
    <li className="rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${renk}3d` }}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md text-[9px] font-black" style={ikonStili(renk)}>
          {ajanKisaltma(o.ajanId, o.ajanAd)}
        </span>
        <span className="font-semibold" style={{ color: RENK.metin }}>{o.ajanAd}</span>
        <span style={{ color: RENK.ikincil }}>· {aracAdi(o.arac)}</span>
        {hedef && (
          <span className="truncate" style={{ color: RENK.metin }} title={o.hedef || ''}>
            → {hedef}
          </span>
        )}
        <span className="font-mono text-[10px]" style={{ color: RENK.sonuk }}>#{o.previewId}</span>
        {o.isId && (
          <button type="button" onClick={() => onIsAc(o.isId!)} className="inline-flex items-center gap-0.5 text-[10px] underline-offset-2 hover:underline" style={{ color: RENK.ikincil }} title="İş dosyasını aç">
            <FolderOpen size={10} /> iş ▸
          </button>
        )}
        <span className="ml-auto text-[10.5px]" style={{ color: kalan.ms <= 0 || azKaldi ? RENK.turuncu : RENK.ikincil }}>{kalan.metin}</span>
      </div>
      {mesaj && (
        <div className="mt-1.5">
          <div className={`${mesajAcik ? 'max-h-40 overflow-y-auto' : 'line-clamp-2'} whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[12.5px] leading-relaxed`} style={{ background: 'rgba(0,0,0,0.25)', color: 'rgba(250,250,249,0.88)' }}>
            {mesaj}
          </div>
          <button type="button" onClick={() => setMesajAcik((a) => !a)} className="mt-0.5 inline-flex items-center gap-0.5 text-[10px]" style={{ color: RENK.ikincil }}>
            {mesajAcik ? <ChevronUp size={10} /> : <ChevronDown size={10} />} {mesajAcik ? 'kısalt' : 'tamamını gör'}
          </button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!islem.mesgul || islem.teyit === o.previewId}
          onClick={() => islem.setTeyit(o.previewId)}
          className="flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition-[transform] duration-150 hover:-translate-y-px disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#16a34a,#4ade80)', color: '#052e16' }}
        >
          {mesgulMu ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Onayla ve gönder
        </button>
        <button
          type="button"
          disabled={!!islem.mesgul}
          onClick={() => islem.reddetTikla(o)}
          className="flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-50"
          style={{ background: 'rgba(248,113,113,0.15)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.35)' }}
        >
          <XCircle size={12} /> Reddet
        </button>
        {islem.sonuc[o.previewId] && (
          <span className="text-[11px]" style={{ color: islem.sonuc[o.previewId].startsWith('Hata') ? RENK.kirmizi : RENK.yesil }}>{islem.sonuc[o.previewId]}</span>
        )}
      </div>
      {islem.teyit === o.previewId && (
        <OnayTeyit
          metin={
            <>
              Bu mesaj <b>GERÇEKTEN</b> gidecek → {hedef || 'hedef'}
            </>
          }
          mesgul={mesgulMu}
          onEvet={() => islem.onaylaGercek(o)}
          onVazgec={() => islem.setTeyit(null)}
        />
      )}
    </li>
  );
}

/**
 * Onay kuyruğu — ajanların dışarı göndermek istediği mesajlar. Muzaffer Bey onaylamadan gitmez; kuru testte hiç düşmez.
 * mod='serit' → komut kartının ÜSTÜNDE ince altın şerit-kart; yalnız bekleyen > 0 ise render edilir.
 * mod='sekme' → "Onaylar" sekme içeriği (dış kart EkipEkrani'da): bekleyenler + geçmiş.
 */
export const OnayKuyrugu = forwardRef<
  HTMLElement,
  {
    mod: 'serit' | 'sekme';
    onaylar: EkipOnay[];
    isLoading: boolean;
    error: unknown;
    mukellefAd: (id?: string | null) => string | undefined;
    onIsAc: (isId: string) => void;
  }
>(function OnayKuyrugu({ mod, onaylar, isLoading, error, mukellefAd, onIsAc }, ref) {
  const islem = useOnayIslemleri();
  const [, setTik] = useState(0);

  // Kalan süre 60 sn'de bir yenilenir
  useEffect(() => {
    const t = setInterval(() => setTik((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const sekmeMi = mod === 'sekme';
  const gecmis = useQuery({ ...SORGU.onaylarTumu, enabled: sekmeMi });
  const yenileniyor = useIsFetching({ queryKey: ['ekip-onaylar'] }) > 0;

  if (error && isOmurgaYok(error)) return null;
  const bekleyenSayisi = onaylar.length;

  // ŞERİT: bekleyen yoksa hiç render edilmez
  if (!sekmeMi) {
    if (isLoading || bekleyenSayisi === 0) return null;
    return (
      <Kart ref={ref} renk={ALTIN} secili className="p-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <ShieldCheck size={15} style={{ color: ALTIN }} />
          <span className="text-[13px] font-bold" style={{ color: ALTIN }}>
            {bekleyenSayisi} onay bekliyor
          </span>
          <span className="text-[11.5px]" style={{ color: RENK.ikincil }}>— sen onaylamadan gitmez</span>
          <button
            type="button"
            onClick={islem.tazele}
            className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
            style={{ border: '1px solid rgba(255,255,255,0.10)', color: RENK.ikincil }}
            title="Onay listesini yenile"
          >
            <RefreshCw size={11} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
          </button>
        </div>
        <ul className="max-h-[420px] space-y-2 overflow-y-auto">
          {onaylar.map((o) => (
            <BekleyenSatir key={o.previewId} o={o} mukellefAd={mukellefAd} onIsAc={onIsAc} islem={islem} />
          ))}
        </ul>
      </Kart>
    );
  }

  // SEKME: bekleyenler + geçmiş
  const gecmisListe = (gecmis.data || []).filter((o) => o.status !== 'PENDING');
  return (
    <div ref={ref as any} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: bekleyenSayisi ? ALTIN : RENK.ikincil }}>
          Bekleyen · {bekleyenSayisi}
        </span>
        <button
          type="button"
          onClick={islem.tazele}
          className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
          style={{ border: '1px solid rgba(255,255,255,0.10)', color: RENK.ikincil }}
          title="Onay listesini yenile"
        >
          <RefreshCw size={11} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: RENK.ikincil }}>
          <Loader2 size={12} className="animate-spin" /> Yükleniyor…
        </div>
      ) : bekleyenSayisi === 0 ? (
        <BosDurum ikon={<ShieldCheck size={18} />} metin="Bekleyen onay yok — kuru testte hiç düşmez." renk={ALTIN} />
      ) : (
        <ul className="space-y-2">
          {onaylar.map((o) => (
            <BekleyenSatir key={o.previewId} o={o} mukellefAd={mukellefAd} onIsAc={onIsAc} islem={islem} />
          ))}
        </ul>
      )}

      <div className="h-px w-full" style={{ background: 'rgba(255,255,255,0.06)' }} />

      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: RENK.ikincil }}>
        <History size={11} /> Geçmiş
      </div>
      {gecmis.isLoading ? (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: RENK.ikincil }}>
          <Loader2 size={12} className="animate-spin" /> Geçmiş yükleniyor…
        </div>
      ) : !gecmisListe.length ? (
        <BosDurum ikon={<History size={18} />} metin="Geçmiş onay kaydı yok." />
      ) : (
        <ul className="max-h-[480px] space-y-1.5 overflow-y-auto">
          {gecmisListe.map((o) => {
            const renk = ajanRengi(o.ajanId);
            return (
              <li key={o.previewId} className="rounded-xl px-3 py-2 text-[11.5px]" style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${renk}2a` }}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-md text-[9px] font-black" style={ikonStili(renk)}>
                    {ajanKisaltma(o.ajanId, o.ajanAd)}
                  </span>
                  <span className="font-semibold" style={{ color: RENK.metin }}>{o.ajanAd}</span>
                  <span style={{ color: RENK.ikincil }}>· {aracAdi(o.arac)}</span>
                  {hedefMetni(o, mukellefAd) && <span style={{ color: RENK.ikincil }}>→ {hedefMetni(o, mukellefAd)}</span>}
                  <span className="ml-auto"><DurumRozeti o={o} /></span>
                </div>
                {o.responseText && (
                  <div className="mt-1 truncate text-[10.5px]" style={{ color: RENK.ikincil }} title={o.responseText}>
                    {o.responseText}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
