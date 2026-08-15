'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Send, Sparkles, User, Copy, Check, Trash2, Loader2, ShieldCheck,
  Wallet, CreditCard, TrendingDown, CalendarClock, Lightbulb,
} from 'lucide-react';
import { butceApi } from '@/lib/butce';
import {
  GOLD, MOR, OK, MAVI, TURUNCU, MUTED, TEXT, CARD_BORDER, ROW_SEP,
} from './ui';
import AiMetin from './AiMetin';

type Mesaj = {
  id: string;
  rol: 'soru' | 'cevap';
  metin: string;
  zaman: Date;
  model?: string;
  hata?: boolean;
};

/** Konu başlıklarına göre gruplanmış hazır sorular */
const SORU_GRUPLARI: Array<{ baslik: string; renk: string; ikon: any; sorular: string[] }> = [
  {
    baslik: 'Harcama',
    renk: TURUNCU,
    ikon: Wallet,
    sorular: [
      'Bu ay en çok nereye harcadım?',
      'Harcamalarımda geçen aya göre ne değişti?',
      'Hangi giderimi kısarsam en çok fark eder?',
    ],
  },
  {
    baslik: 'Borç',
    renk: MOR,
    ikon: CreditCard,
    sorular: [
      'Hangi kartı önce kapatmalıyım?',
      'Bu ay hangi borca ne kadar ödemeliyim?',
      'Borçlarım bu tempoda ne zaman biter?',
    ],
  },
  {
    baslik: 'Senaryo',
    renk: OK,
    ikon: TrendingDown,
    sorular: [
      'Giderimi 5.000 TL kısarsam borcum ne kadar erken biter?',
      'Elime 20.000 TL geçse nereye koymalıyım?',
      'Asgari ödemeye devam edersem ne olur?',
    ],
  },
  {
    baslik: 'Takvim',
    renk: MAVI,
    ikon: CalendarClock,
    sorular: [
      'Önümüzdeki 30 günde ne kadar ödemem var?',
      'Bu ay geciken bir ödemem var mı?',
    ],
  },
];

const yeniId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Finans danışmanı — sohbet düzeni.
 * Sorular ve cevaplar sırayla akar; her cevabın altında kaynak modeli ve
 * kopyalama düğmesi bulunur. Veri yalnız kullanıcının kendi kayıtlarından gelir.
 */
export default function Danisman() {
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([]);
  const [girdi, setGirdi] = useState('');
  const [kopyalanan, setKopyalanan] = useState<string | null>(null);
  const akisRef = useRef<HTMLDivElement>(null);

  const sor = useMutation({
    mutationFn: (soru: string) => butceApi.aiSoru(soru),
    onSuccess: (d) => {
      setMesajlar((m) => [
        ...m,
        {
          id: yeniId(),
          rol: 'cevap',
          metin: d.icerik,
          zaman: new Date(d.createdAt || Date.now()),
          model: d.model,
          hata: d.hata,
        },
      ]);
    },
    onError: (e: any) => {
      setMesajlar((m) => [
        ...m,
        {
          id: yeniId(),
          rol: 'cevap',
          metin: e?.response?.data?.message || 'Cevap alınamadı. Bir süre sonra tekrar deneyin.',
          zaman: new Date(),
          hata: true,
        },
      ]);
    },
  });

  useEffect(() => {
    akisRef.current?.scrollTo({ top: akisRef.current.scrollHeight, behavior: 'smooth' });
  }, [mesajlar.length, sor.isPending]);

  const gonder = (soru: string) => {
    const temiz = soru.trim();
    if (!temiz || sor.isPending) return;
    setMesajlar((m) => [...m, { id: yeniId(), rol: 'soru', metin: temiz, zaman: new Date() }]);
    setGirdi('');
    sor.mutate(temiz);
  };

  const kopyala = async (m: Mesaj) => {
    try {
      await navigator.clipboard.writeText(m.metin);
      setKopyalanan(m.id);
      setTimeout(() => setKopyalanan(null), 1600);
    } catch {
      /* pano izni yoksa sessiz geç */
    }
  };

  const bos = mesajlar.length === 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      {/* ===== Sohbet ===== */}
      <section
        className="relative flex flex-col overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(165deg, rgba(176,160,224,0.05), rgba(255,255,255,0.012) 45%)',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 18px 44px rgba(0,0,0,0.24)',
          minHeight: 560,
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${MOR}66, transparent)` }}
        />

        {/* Başlık */}
        <header
          className="flex items-center justify-between gap-3 px-5 py-3.5"
          style={{ borderBottom: `1px solid ${ROW_SEP}` }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: `${MOR}1a`, border: `1px solid ${MOR}3d`, color: MOR }}
            >
              <Sparkles size={16} />
            </span>
            <div>
              <h3 className="text-[13.5px] font-semibold" style={{ color: TEXT }}>
                Finans danışmanı
              </h3>
              <p className="text-[11px]" style={{ color: MUTED }}>
                Gelir, gider, kart ve borç kayıtlarınızı okur · yatırım tavsiyesi vermez
              </p>
            </div>
          </div>
          {mesajlar.length > 0 && (
            <button
              onClick={() => setMesajlar([])}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] transition hover:bg-white/[0.06]"
              style={{ color: MUTED }}
              title="Sohbeti temizle"
            >
              <Trash2 size={12} /> Temizle
            </button>
          )}
        </header>

        {/* Akış */}
        <div ref={akisRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5" style={{ maxHeight: 520 }}>
          {bos ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center">
              <span
                className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
                style={{ background: `${MOR}14`, border: `1px solid ${MOR}33`, color: MOR }}
              >
                <Sparkles size={22} />
              </span>
              <h4 className="text-[14px] font-semibold" style={{ color: TEXT }}>
                Paranızla ilgili ne merak ediyorsunuz?
              </h4>
              <p className="mt-1.5 max-w-md text-[12px] leading-relaxed" style={{ color: MUTED }}>
                Bu ekran uydurma yapmaz: cevaplar yalnız sizin girdiğiniz gelir–gider kayıtları,
                kart ekstreleri ve borç bilgilerinden üretilir. Veride olmayan bir şey sorulduğunda
                “bu bilgi sistemde yok” der.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                {['Bu ay en çok nereye harcadım?', 'Hangi kartı önce kapatmalıyım?', 'Borçlarım ne zaman biter?'].map(
                  (s) => (
                    <button
                      key={s}
                      onClick={() => gonder(s)}
                      className="rounded-xl px-3 py-1.5 text-[11.5px] transition hover:brightness-125"
                      style={{ background: `${MOR}14`, border: `1px solid ${MOR}33`, color: MOR }}
                    >
                      {s}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : (
            mesajlar.map((m) =>
              m.rol === 'soru' ? (
                <div key={m.id} className="flex justify-end gap-2.5">
                  <div
                    className="max-w-[80%] rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[12.5px] leading-relaxed"
                    style={{ background: `${GOLD}16`, border: `1px solid ${GOLD}33`, color: TEXT }}
                  >
                    {m.metin}
                    <div className="mt-1 text-right text-[10px]" style={{ color: MUTED }}>
                      {m.zaman.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span
                    className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}30`, color: GOLD }}
                  >
                    <User size={13} />
                  </span>
                </div>
              ) : (
                <div key={m.id} className="flex gap-2.5">
                  <span
                    className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: m.hata ? 'rgba(224,105,122,0.12)' : `${MOR}14`,
                      border: `1px solid ${m.hata ? 'rgba(224,105,122,0.3)' : `${MOR}30`}`,
                      color: m.hata ? '#e0697a' : MOR,
                    }}
                  >
                    <Sparkles size={13} />
                  </span>
                  <div
                    className="group max-w-[85%] rounded-2xl rounded-tl-md px-4 py-3"
                    style={{
                      background: 'rgba(255,255,255,0.025)',
                      border: `1px solid ${ROW_SEP}`,
                    }}
                  >
                    <AiMetin metin={m.metin} soluk={m.hata} />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[10px]" style={{ color: 'rgba(113,113,122,0.85)' }}>
                        {m.model ? `${m.model} · ` : ''}
                        {m.zaman.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {!m.hata && (
                        <button
                          onClick={() => kopyala(m)}
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.06]"
                          style={{ color: kopyalanan === m.id ? OK : MUTED }}
                        >
                          {kopyalanan === m.id ? <Check size={11} /> : <Copy size={11} />}
                          {kopyalanan === m.id ? 'kopyalandı' : 'kopyala'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ),
            )
          )}

          {sor.isPending && (
            <div className="flex gap-2.5">
              <span
                className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ background: `${MOR}14`, border: `1px solid ${MOR}30`, color: MOR }}
              >
                <Sparkles size={13} />
              </span>
              <div
                className="flex items-center gap-2 rounded-2xl rounded-tl-md px-4 py-3 text-[12px]"
                style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${ROW_SEP}`, color: MUTED }}
              >
                <Loader2 size={13} className="animate-spin" style={{ color: MOR }} />
                Kayıtlarınız okunuyor…
              </div>
            </div>
          )}
        </div>

        {/* Girdi */}
        <form
          className="flex items-end gap-2 px-5 py-4"
          style={{ borderTop: `1px solid ${ROW_SEP}` }}
          onSubmit={(e) => {
            e.preventDefault();
            gonder(girdi);
          }}
        >
          <textarea
            value={girdi}
            onChange={(e) => setGirdi(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                gonder(girdi);
              }
            }}
            rows={1}
            placeholder="Sorunuzu yazın… (Enter gönderir, Shift+Enter alt satır)"
            className="flex-1 resize-none"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${CARD_BORDER}`,
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 12.5,
              color: TEXT,
              outline: 'none',
              maxHeight: 120,
            }}
          />
          <button
            type="submit"
            disabled={!girdi.trim() || sor.isPending}
            className="flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-[12px] font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: `linear-gradient(140deg, ${MOR}dd, ${MOR}99)`, color: '#0b0b0d', border: `1px solid ${MOR}` }}
          >
            {sor.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Gönder
          </button>
        </form>
      </section>

      {/* ===== Yan panel: hazır sorular ===== */}
      <aside className="space-y-3">
        <div
          className="rounded-2xl px-4 py-3.5"
          style={{ background: 'rgba(255,255,255,0.018)', border: `1px solid ${CARD_BORDER}` }}
        >
          <h4 className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: TEXT }}>
            <Lightbulb size={13} style={{ color: GOLD }} /> Hazır sorular
          </h4>
          <p className="mt-0.5 text-[10.5px]" style={{ color: MUTED }}>
            Tıklayın, hemen sorulsun
          </p>

          <div className="mt-3 space-y-3">
            {SORU_GRUPLARI.map((g) => {
              const Ikon = g.ikon;
              return (
                <div key={g.baslik}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider" style={{ color: g.renk }}>
                    <Ikon size={11} /> {g.baslik}
                  </div>
                  <div className="space-y-1">
                    {g.sorular.map((s) => (
                      <button
                        key={s}
                        onClick={() => gonder(s)}
                        disabled={sor.isPending}
                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] leading-snug transition hover:bg-white/[0.05] disabled:opacity-40"
                        style={{ color: MUTED, border: `1px solid ${ROW_SEP}` }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[10.5px] leading-relaxed"
          style={{ background: 'rgba(90,209,138,0.07)', border: '1px solid rgba(90,209,138,0.22)', color: MUTED }}
        >
          <ShieldCheck size={13} style={{ color: OK }} className="mt-0.5 flex-shrink-0" />
          <span>
            Sohbet bu pencerede kalır, kaydedilmez. Cevaplar yalnız sizin verinizden üretilir;
            hisse, döviz, kripto gibi yatırım tavsiyesi verilmez.
          </span>
        </div>
      </aside>
    </div>
  );
}
