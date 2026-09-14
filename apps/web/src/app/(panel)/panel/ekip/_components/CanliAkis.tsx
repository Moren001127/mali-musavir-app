'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, FlaskConical, ShieldAlert, XCircle, Send, MessageSquareReply, GraduationCap, Sunrise, X } from 'lucide-react';
import { toast } from 'sonner';
import { onayla, reddet, sabahOzetiUret, isZamanAsimi } from '@/lib/ekip';
import { DURDURULDU_METNI, type Adim, type Kosu, type KosularApi } from './kosular';
import { OnayTeyit } from './OnayBekleyenler';
import { SAKIN, aracAdi, cevapAyristir, saatKisa, sakinDugme, sayacMetni, sureKisa } from './ortak';

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
      <li className="flex items-center gap-2 py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${calisiyor ? SAKIN.vurgu : SAKIN.cizgi}` }}>
        <span className="tabular-nums" style={{ color: SAKIN.soluk }}>{saat}</span>
        {calisiyor ? <Loader2 size={11} className="animate-spin" style={{ color: SAKIN.vurguAcik }} /> : <Check size={11} style={{ color: SAKIN.yesil }} />}
        <span className={calisiyor ? 'animate-pulse' : ''} style={{ color: SAKIN.metin }}>
          {aracAdi(adim.ad)} <span className="text-[10px]" style={{ color: SAKIN.soluk }}>({adim.ad})</span>
        </span>
      </li>
    );
  }
  if (adim.tip === 'kuruTest') {
    return (
      <li className="flex items-center gap-2 py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${SAKIN.cizgi}` }}>
        <span className="tabular-nums" style={{ color: SAKIN.soluk }}>{saat}</span>
        <FlaskConical size={11} style={{ color: SAKIN.yesil }} />
        <span style={{ color: SAKIN.ikincil }}>kuru test — yapılmadı: {aracAdi(adim.ad)}</span>
      </li>
    );
  }
  if (adim.tip === 'red') {
    return (
      <li className="flex items-center gap-2 py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${SAKIN.cizgi}` }}>
        <span className="tabular-nums" style={{ color: SAKIN.soluk }}>{saat}</span>
        <XCircle size={11} style={{ color: SAKIN.kirmiziAcik }} />
        <span style={{ color: SAKIN.kirmiziAcik }}>
          reddedildi: {aracAdi(adim.ad)}
          {adim.neden ? ` — ${adim.neden}` : ''}
        </span>
      </li>
    );
  }
  // onay — kehribar
  return (
    <li className="py-0.5 pl-2 text-xs" style={{ borderLeft: `2px solid ${SAKIN.kehribar}66` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums" style={{ color: SAKIN.soluk }}>{saat}</span>
        <ShieldAlert size={11} style={{ color: SAKIN.kehribar }} />
        <span style={{ color: SAKIN.kehribar }}>
          onay bekliyor {adim.previewId ? `#${adim.previewId}` : ''} · {aracAdi(adim.ad)}
        </span>
        {adim.sonuc ? (
          <span style={{ color: adim.sonuc.startsWith('Hata') ? SAKIN.kirmiziAcik : SAKIN.yesil }}>{adim.sonuc}</span>
        ) : (
          adim.previewId && (
            <>
              <button type="button" disabled={mesgul || teyit} onClick={() => setTeyit(true)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold disabled:opacity-50" style={sakinDugme('birincil')}>
                <Send size={10} /> Onayla ve gönder
              </button>
              <button type="button" disabled={mesgul} onClick={redGercek} className="rounded-md px-2 py-1 text-[11px] font-semibold disabled:opacity-50" style={sakinDugme('tehlike')}>
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
  const renk = SAKIN.vurgu;
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
    <div className="flex min-w-0 flex-col gap-2.5 rounded-lg px-3 py-2.5" style={{ background: SAKIN.alan, border: `1px solid ${SAKIN.kilcal}` }}>
      {/* Tek başlık satırı: koşu kimliği · mod (yalnız canlı yazılır) · süre · durum */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]" style={{ color: SAKIN.ikincil }}>
        {sabahOzetiMi ? (
          <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SAKIN.metin }}>
            <Sunrise size={12} style={{ color: SAKIN.vurguAcik }} />{' '}
            {calisiyor ? 'Sabah özeti üretiliyor' : `Sabah özeti (şimdi üretildi) · ${kosu.gonderildi ? `${kosu.gonderildi} numaraya gönderildi` : 'gönderilmedi'}`}
          </span>
        ) : (
          <span className="font-semibold" style={{ color: SAKIN.metin }}>
            Koşu {kosu.isId ? `#${kosu.isId.slice(0, 8)}` : ''}
          </span>
        )}
        {!kosu.dryRun && (
          <span className="text-[10.5px] font-semibold" style={{ color: SAKIN.kirmiziAcik }}>
            canlı
          </span>
        )}
        <span className="tabular-nums">{sure}</span>
        {calisiyor ? (
          <span className="inline-flex items-center gap-1" style={{ color: SAKIN.vurguAcik }}>
            <Loader2 size={11} className="animate-spin" /> çalışıyor
          </span>
        ) : kosu.hata ? (
          <span style={{ color: SAKIN.kirmiziAcik }}>{kosu.hata === DURDURULDU_METNI ? 'Durduruldu' : 'Hata'}</span>
        ) : (
          <span className="inline-flex items-center gap-1" style={{ color: SAKIN.yesil }}>
            <Check size={11} /> Bitti · {aracSayisi} araç
          </span>
        )}
        {kosu.bitti && onKapat && (
          <button type="button" onClick={onKapat} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px]" style={{ border: `1px solid ${SAKIN.cizgi}`, color: SAKIN.ikincil }} title="Bu canlı kaydı kapat">
            <X size={10} /> kapat
          </button>
        )}
      </div>

      <div className="truncate text-[12px]" style={{ color: SAKIN.ikincil }} title={kosu.gorev}>
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
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: SAKIN.vurguAcik }}>
          <Loader2 size={11} className="animate-spin" /> Düşünüyor…
        </div>
      )}

      {kosu.hata && (
        <div className="rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(214,69,69,0.08)', border: `1px solid ${SAKIN.kirmizi}66`, color: SAKIN.metin }}>
          {kosu.hata === DURDURULDU_METNI ? 'Durduruldu — koşu sunucuda iptal edildi; iş dosyası "iptal edildi (Muzaffer Bey)" olarak kapandı' : kosu.hata}
        </div>
      )}

      {/* Cevap */}
      {!kosu.bitti && kosu.cevap && (
        <div ref={cevapRef} className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg px-4 py-3 text-[13px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${SAKIN.kilcal}`, color: SAKIN.metin }}>
          {kosu.cevap}
        </div>
      )}
      {kosu.bitti && ayrisik && (
        <>
          {(ayrisik.rapor || (!ayrisik.sorular.length && !ayrisik.ogrenilen.length && ayrisik.ham)) && (
            <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg px-4 py-3 text-[13px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${SAKIN.kilcal}`, color: SAKIN.metin }}>
              {ayrisik.rapor || ayrisik.ham}
            </div>
          )}
          {ayrisik.sorular.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: `${SAKIN.kehribar}0f`, border: `1px solid ${SAKIN.kehribar}55` }}>
              <div className="font-semibold" style={{ color: SAKIN.kehribar }}>Koordinatör soruyor</div>
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
            className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={sakinDugme('birincil')}
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
