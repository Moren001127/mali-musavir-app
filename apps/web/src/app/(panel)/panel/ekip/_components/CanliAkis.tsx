'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, FlaskConical, ShieldAlert, XCircle, Send, MessageSquareReply, GraduationCap, Sunrise, X } from 'lucide-react';
import { toast } from 'sonner';
import { onayla, reddet, sabahOzetiUret, isZamanAsimi } from '@/lib/ekip';
import { DURDURULDU_METNI, type Adim, type Kosu, type KosularApi } from './kosular';
import { OnayTeyit } from './OnayBekleyenler';
import { EKIP_ACCENT, RENK, aracAdi, cevapAyristir, saatKisa, sayacMetni, sureKisa } from './ortak';

function AdimSatiri({ adim, renk, onOnaylandi }: { adim: Adim; renk: string; onOnaylandi: (previewId: string, sonuc: string) => void }) {
  const [teyit, setTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const saat = saatKisa(adim.zaman);

  const onayGercek = async () => {
    if (!adim.previewId || mesgul) return;
    setMesgul(true);
    try {
      const r = await onayla(adim.previewId);
      onOnaylandi(adim.previewId, r.ok ? 'Gönderildi ✓' : `Hata: ${r.error || 'gönderilemedi'}`);
    } catch (e: any) {
      onOnaylandi(adim.previewId, `Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      setTeyit(false);
    }
  };
  const redGercek = async () => {
    if (!adim.previewId || mesgul) return;
    setMesgul(true);
    try {
      const r = await reddet(adim.previewId, 'Akıştan reddedildi');
      onOnaylandi(adim.previewId, r.ok ? 'Reddedildi' : `Hata: ${r.error || ''}`);
    } catch (e: any) {
      onOnaylandi(adim.previewId, `Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
    }
  };

  if (adim.tip === 'arac') {
    const calisiyor = adim.durum === 'calisiyor';
    return (
      <li className="flex items-center gap-2 py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${renk}` }}>
        <span className="tabular-nums" style={{ color: RENK.sonuk }}>{saat}</span>
        {calisiyor ? <Loader2 size={11} className="animate-spin" style={{ color: EKIP_ACCENT }} /> : <Check size={11} style={{ color: RENK.yesil }} />}
        <span className={calisiyor ? 'animate-pulse' : ''} style={{ color: RENK.metin }}>
          {aracAdi(adim.ad)} <span className="text-[10px]" style={{ color: RENK.sonuk }}>({adim.ad})</span>
        </span>
      </li>
    );
  }
  if (adim.tip === 'kuruTest') {
    return (
      <li className="flex items-center gap-2 py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${renk}` }}>
        <span className="tabular-nums" style={{ color: RENK.sonuk }}>{saat}</span>
        <FlaskConical size={11} style={{ color: RENK.yesil }} />
        <span style={{ color: '#86efac' }}>kuru test — yapılmadı: {aracAdi(adim.ad)}</span>
      </li>
    );
  }
  if (adim.tip === 'red') {
    return (
      <li className="flex items-center gap-2 py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${renk}` }}>
        <span className="tabular-nums" style={{ color: RENK.sonuk }}>{saat}</span>
        <XCircle size={11} style={{ color: RENK.kirmizi }} />
        <span style={{ color: '#fca5a5' }}>
          reddedildi: {aracAdi(adim.ad)}
          {adim.neden ? ` — ${adim.neden}` : ''}
        </span>
      </li>
    );
  }
  // onay — turuncu (altın değil)
  return (
    <li className="py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${renk}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums" style={{ color: RENK.sonuk }}>{saat}</span>
        <ShieldAlert size={11} style={{ color: RENK.turuncu }} />
        <span style={{ color: RENK.turuncu }}>
          onay bekliyor {adim.previewId ? `#${adim.previewId}` : ''} · {aracAdi(adim.ad)}
        </span>
        {adim.sonuc ? (
          <span style={{ color: adim.sonuc.startsWith('Hata') ? RENK.kirmizi : RENK.yesil }}>{adim.sonuc}</span>
        ) : (
          adim.previewId && (
            <>
              <button
                type="button"
                disabled={mesgul || teyit}
                onClick={() => setTeyit(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#16a34a,#4ade80)', color: '#052e16' }}
              >
                <Send size={10} /> Onayla ve gönder
              </button>
              <button
                type="button"
                disabled={mesgul}
                onClick={redGercek}
                className="rounded-md px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
                style={{ background: 'rgba(248,113,113,0.15)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.35)' }}
              >
                Reddet
              </button>
            </>
          )
        )}
      </div>
      {teyit && !adim.sonuc && (
        <OnayTeyit
          metin={
            <>
              Bu mesaj <b>GERÇEKTEN</b> gidecek → #{adim.previewId}
            </>
          }
          mesgul={mesgul}
          onEvet={onayGercek}
          onVazgec={() => setTeyit(false)}
        />
      )}
    </li>
  );
}

/**
 * Canlı akış — SATIR İÇİ: Koordinatör koşusunun SSE akışı (vaka satırının çizelgesinin altında).
 * Başlık (sayaç), adımlar, cevap (RAPOR/SORU/ÖĞRENDİM), akış içi onay, sabah özeti → "Muzaffer Bey’e gönder" teyidi.
 * Koşu bitince üst bileşen akışı tazeler; satır adım kaydına dönüşür (bu bileşen o zaman "kapat" ile kalkabilir).
 */
export function CanliAkis({
  kosu,
  onCevapla,
  kosular,
  onKapat,
}: {
  kosu: Kosu;
  onCevapla: (metin: string) => void;
  kosular: KosularApi;
  /** Bitmiş koşuyu haritadan kaldır (yalnız eşleşmemiş geçici satırda gösterilir). */
  onKapat?: () => void;
}) {
  const renk = EKIP_ACCENT;
  const qc = useQueryClient();
  const [simdi, setSimdi] = useState(() => Date.now());
  const [cevapMetni, setCevapMetni] = useState('');
  const [gonderTeyit, setGonderTeyit] = useState(false);
  const [gonderMesgul, setGonderMesgul] = useState(false);
  const cevapRef = useRef<HTMLDivElement>(null);

  const calisiyor = !kosu.bitti;
  useEffect(() => {
    if (!calisiyor) return;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [calisiyor]);

  useEffect(() => {
    if (cevapRef.current && calisiyor) cevapRef.current.scrollTop = cevapRef.current.scrollHeight;
  }, [kosu.cevap, calisiyor]);

  const ayrisik = useMemo(() => (kosu.bitti ? cevapAyristir(kosu.cevap) : null), [kosu.bitti, kosu.cevap]);

  const onOnaylandi = (previewId: string, sonuc: string) => {
    kosular.guncelle(kosu.ajanId, (k) => ({ ...k, adimlar: k.adimlar.map((a) => (a.previewId === previewId ? { ...a, sonuc } : a)) }));
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
  };

  /**
   * Sabah özeti → Muzaffer Bey’e GERÇEK WhatsApp: koordinatörü yeniden üretir ve gönderir.
   * Koşu BAŞLARKEN haritaya `bitti:false` yazılır → tek aktif koşu kilidi sabah özetini de kapsar.
   */
  const sahibeGonder = async () => {
    if (gonderMesgul || kosular.aktifKosu) return;
    setGonderMesgul(true);
    const basladi = Date.now();
    kosular.ayarla('koordinator', {
      ajanId: 'koordinator',
      gorev: 'Sabah özeti — yeniden üretiliyor ve Muzaffer Bey’e gönderiliyor',
      dryRun: false,
      cevap: '',
      adimlar: [],
      bitti: false,
      basladi,
      kaynak: 'sabahOzeti',
    });
    try {
      const r = await sabahOzetiUret({ gonder: true });
      kosular.ayarla('koordinator', {
        ajanId: 'koordinator',
        gorev: 'Sabah özeti (yeniden üretildi ve gönderildi)',
        dryRun: false,
        isId: r.isId,
        vakaId: r.isId,
        model: r.model,
        cevap: r.rapor || '',
        adimlar: (r.toolUses || []).map((t) => ({ tip: 'arac' as const, ad: t.name, zaman: Date.now(), durum: 'bitti' as const })),
        bitti: true,
        hata: r.hata,
        durationMs: r.durationMs ?? Date.now() - basladi,
        basladi,
        kaynak: 'sabahOzeti',
        gonderildi: r.gonderildi,
      });
      toast.success(`Sabah özeti ${r.gonderildi} numaraya gönderildi`);
    } catch (e: any) {
      const hata = isZamanAsimi(e) ? 'Sürüyor — akışta görünecek' : e?.message || 'Gönderilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      toast.error(hata);
    } finally {
      setGonderMesgul(false);
      setGonderTeyit(false);
      qc.invalidateQueries({ queryKey: ['ekip-akis'] });
      qc.invalidateQueries({ queryKey: ['ekip-durum'] });
      qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    }
  };

  const sabahOzetiMi = kosu.kaynak === 'sabahOzeti';
  const sure = kosu.bitti ? sureKisa(kosu.durationMs ?? 0) : sayacMetni(simdi - kosu.basladi);
  const aracSayisi = kosu.adimlar.filter((a) => a.tip === 'arac').length;

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl px-3 py-2.5" style={{ background: 'rgba(0,0,0,0.18)', border: `1px solid ${renk}22` }}>
      {/* Tek başlık satırı: koşu kimliği · mod · model · süre · durum */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]" style={{ color: RENK.ikincil }}>
        {sabahOzetiMi ? (
          <span className="inline-flex items-center gap-1 font-bold" style={{ color: RENK.metin }}>
            <Sunrise size={12} style={{ color: EKIP_ACCENT }} />{' '}
            {calisiyor ? 'Sabah özeti üretiliyor' : `Sabah özeti (şimdi üretildi) · ${kosu.gonderildi ? `${kosu.gonderildi} numaraya gönderildi` : 'gönderilmedi'}`}
          </span>
        ) : (
          <span className="font-bold" style={{ color: RENK.metin }}>
            Canlı koşu {kosu.isId ? `#${kosu.isId.slice(0, 8)}` : ''}
          </span>
        )}
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={kosu.dryRun ? { background: 'rgba(74,222,128,0.12)', color: '#86efac' } : { background: 'rgba(248,113,113,0.16)', color: '#fca5a5' }}>
          {kosu.dryRun ? 'KURU' : 'CANLI'}
        </span>
        {kosu.model && <span>{kosu.model}</span>}
        <span className="tabular-nums">{sure}</span>
        {calisiyor ? (
          <span className="inline-flex items-center gap-1" style={{ color: EKIP_ACCENT }}>
            <Loader2 size={11} className="animate-spin" /> çalışıyor
          </span>
        ) : kosu.hata ? (
          <span style={{ color: RENK.kirmizi }}>{kosu.hata === DURDURULDU_METNI ? 'Durduruldu' : 'Hata'}</span>
        ) : (
          <span className="inline-flex items-center gap-1" style={{ color: RENK.yesil }}>
            <Check size={11} /> Bitti · {aracSayisi} araç
          </span>
        )}
        {kosu.bitti && onKapat && (
          <button type="button" onClick={onKapat} className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]" style={{ border: '1px solid rgba(255,255,255,0.10)', color: RENK.ikincil }} title="Bu canlı kaydı kapat">
            <X size={10} /> kapat
          </button>
        )}
      </div>

      <div className="truncate text-[12px]" style={{ color: RENK.ikincil }} title={kosu.gorev}>
        {kosu.gorev}
      </div>

      {/* Adım listesi */}
      {kosu.adimlar.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {kosu.adimlar.map((a, i) => (
            <AdimSatiri key={`${a.zaman}-${i}`} adim={a} renk={renk} onOnaylandi={onOnaylandi} />
          ))}
        </ul>
      )}
      {calisiyor && !kosu.adimlar.some((a) => a.durum === 'calisiyor') && (
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: renk }}>
          <Loader2 size={11} className="animate-spin" /> Düşünüyor…
        </div>
      )}

      {kosu.hata && (
        <div className="rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}>
          ⚠️ {kosu.hata === DURDURULDU_METNI ? 'Durduruldu — koşu sunucuda iptal edildi; iş dosyası "iptal edildi (Muzaffer Bey)" olarak kapandı' : kosu.hata}
        </div>
      )}

      {/* Cevap */}
      {!kosu.bitti && kosu.cevap && (
        <div ref={cevapRef} className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl px-4 py-3 text-[13px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${renk}22`, color: 'rgba(250,250,249,0.92)' }}>
          {kosu.cevap}
        </div>
      )}
      {kosu.bitti && ayrisik && (
        <>
          {(ayrisik.rapor || (!ayrisik.sorular.length && !ayrisik.ogrenilen.length && ayrisik.ham)) && (
            <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl px-4 py-3 text-[13px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${renk}55`, color: 'rgba(250,250,249,0.92)' }}>
              {ayrisik.rapor || ayrisik.ham}
            </div>
          )}
          {ayrisik.sorular.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: `${RENK.turuncu}12`, border: `1px solid ${RENK.turuncu}55` }}>
              <div className="font-bold" style={{ color: RENK.turuncu }}>Koordinatör soruyor</div>
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
        </>
      )}

      {/* Sabah özeti → Muzaffer Bey’e gönder (kart içi teyit; yalnız burada) */}
      {sabahOzetiMi && kosu.bitti && !kosu.hata && (
        <div>
          <button
            type="button"
            disabled={gonderMesgul || gonderTeyit || !!kosular.aktifKosu}
            onClick={() => setGonderTeyit(true)}
            title={kosular.aktifKosu ? 'Bir koşu sürüyor — bitince' : 'Kart içi teyit açılır; koordinatör yeniden üretir ve gönderir'}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#16a34a,#4ade80)', color: '#052e16' }}
          >
            {gonderMesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Muzaffer Bey’e WhatsApp gönder
          </button>
          {gonderTeyit && (
            <OnayTeyit
              metin={
                <>
                  Muzaffer Bey’in numaralarına <b>GERÇEK</b> mesaj gidecek — koordinatör özeti <b>yeniden üretir ve gönderir</b> (30-90 sn).
                </>
              }
              mesgul={gonderMesgul}
              onEvet={sahibeGonder}
              onVazgec={() => setGonderTeyit(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
