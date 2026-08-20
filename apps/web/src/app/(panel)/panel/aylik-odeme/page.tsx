'use client';

// =====================================================================
// AYLIK ÖDEME LİSTESİ — Vergi & Beyanname > Aylık Ödeme Listesi
// Mükellefin o ay ödeyeceği vergi tahakkukları + SGK primleri tek cetvelde.
// WhatsApp/e-posta ile gönderim Akıllı Bildirim motorundan geçer,
// sonuç İletim Raporu'na işlenir.
// =====================================================================

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Printer, Send, Wallet, ChevronDown } from 'lucide-react';
import { BEYAN_ETIKETLER } from '@/lib/beyanname-takip';

const GOLD = '#d4b876';
const MUTED = 'rgba(250,250,249,0.45)';
const TEXT2 = 'rgba(250,250,249,0.75)';
const CARD_BG = 'rgba(255,255,255,0.028)';
const CARD_BORDER = 'rgba(212,184,118,0.16)';

interface OdemeSatiri {
  tur: string;
  donem: string;
  sonGun: string | null;
  tutar: number;
  /** 'VERGI' | 'SGK' — sunucu zaten gönderiyordu, arayüz almıyordu */
  kaynak?: string;
}
interface OdemeListesi { taxpayerId: string; unvan: string; phone: string | null; email: string | null; satirlar: OdemeSatiri[]; toplam: number; }

function trMoney(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ₺';
}
const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/**
 * ÖDEME ADI — yalnız EKRANDA okunur hâle getirilir.
 *
 * Sunucudaki `tur` alanı WhatsApp mesajında da kullanılıyor
 * (aylik-odeme.service.ts:159); orada değiştirmek mesajı bozar. Bu yüzden
 * çeviri burada, ekranda yapılıyor.
 *   VERGİ → "KDV1" gibi ham kod, BEYAN_ETIKETLER ile okunur ada çevrilir
 *   SGK   → sunucu başlıktan "SGK " kelimesini kırpıp "Tahakkuk Fişi"
 *           bırakıyor; ekranda tam adıyla gösterilir
 */
function odemeAdi(s: OdemeSatiri): string {
  const ham = (s.tur || '').trim();
  if (s.kaynak === 'SGK') {
    return /tahakkuk/i.test(ham) ? 'SGK Prim Tahakkuku' : `SGK ${ham}`.trim();
  }
  return (BEYAN_ETIKETLER as Record<string, string>)[ham] || ham || '—';
}

/** "2026-07" ve "2026/07" → "Temmuz 2026". Vergi ile SGK farklı yazıyordu. */
function donemAdi(donem: string): string {
  const m = String(donem || '').match(/^(\d{4})[-/](\d{1,2})$/);
  if (!m) return donem || '—';
  const ay = Number(m[2]);
  if (ay < 1 || ay > 12) return donem;
  return `${AYLAR[ay - 1]} ${m[1]}`;
}

/** "28.8.2026" → "28.08.2026" (sunucu sıfırsız gönderiyor) */
function tarihAdi(t: string | null): string {
  if (!t) return '—';
  const m = String(t).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return t;
  return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
}

/** Son ödeme gününe kalan gün — vadesi yaklaşan satır öne çıksın */
function vadeDurumu(t: string | null): { renk: string; etiket: string | null } {
  const m = t && String(t).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return { renk: TEXT2, etiket: null };
  const son = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  const gun = Math.round((son.getTime() - bugun.getTime()) / 86400000);
  if (gun < 0) return { renk: '#f87171', etiket: 'geçti' };
  if (gun === 0) return { renk: '#f87171', etiket: 'bugün' };
  if (gun <= 3) return { renk: '#fbbf24', etiket: `${gun} gün` };
  return { renk: TEXT2, etiket: null };
}

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

export default function AylikOdemePage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const [eksikAcik, setEksikAcik] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['aylik-odeme', month],
    queryFn: () => api.get('/aylik-odeme', { params: { month } }).then((r) => r.data as OdemeListesi[]),
  });

  // LİSTEDE NEDEN YOK — mükellef listede görünmüyorsa hata mı, eksik belge mi
  // olduğu hiçbir yerde yazmıyordu. Bu uç yalnız okur, gönderim yapmaz.
  const { data: eksikData } = useQuery({
    queryKey: ['aylik-odeme-eksik', month],
    queryFn: () => api.get('/aylik-odeme/eksikler', { params: { month } }).then((r) => r.data),
  });
  interface EksikSatiri {
    taxpayerId: string;
    unvan: string;
    kaynak: string;
    sebep: string;
    beyanTipi?: string;
    donem?: string;
    listedeVar: boolean;
  }
  const eksikler: EksikSatiri[] = eksikData?.eksik || [];

  // "Listede görünmeyen" başlığı altında listede OLAN mükellefi göstermek
  // yanlıştı; iki grup ayrıldı ve sayılar dürüst hâle geldi.
  const listeDisi = useMemo(() => eksikler.filter((e) => !e.listedeVar), [eksikler]);
  const listedeAmaEksik = useMemo(() => eksikler.filter((e) => e.listedeVar), [eksikler]);

  /** Sebep metnini beyanname adı + dönemle birlikte okunur hâle getirir */
  const eksikMetni = (e: EksikSatiri): string => {
    const ad = e.beyanTipi
      ? (BEYAN_ETIKETLER as Record<string, string>)[e.beyanTipi] || e.beyanTipi
      : null;
    const donem = e.donem ? donemAdi(e.donem) : null;
    if (ad && donem) return `${ad} (${donem}) — ${e.sebep}`;
    if (ad) return `${ad} — ${e.sebep}`;
    if (donem) return `${donem} — ${e.sebep}`;
    return e.sebep;
  };

  const rows = data || [];
  const active = useMemo(
    () => rows.find((r) => r.taxpayerId === selected) || rows[0] || null,
    [rows, selected],
  );
  const genelToplam = rows.reduce((a, r) => a + r.toplam, 0);

  const gonder = async (taxpayerId?: string) => {
    const key = taxpayerId || '__ALL__';
    setSending(key);
    try {
      const r = await api.post('/aylik-odeme/send', { month, taxpayerId });
      const ok = (r.data?.results || []).filter((x: any) => x.status === 'SENT').length;
      const fail = (r.data?.results || []).filter((x: any) => x.status === 'FAILED').length;
      toast.success(`${ok} gönderim başarılı${fail ? `, ${fail} hata` : ''}${r.data?.testMode ? ' (TEST MODU)' : ''}`);
      qc.invalidateQueries({ queryKey: ['iletim-raporu'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Gönderilemedi');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="relative overflow-hidden rounded-2xl border p-6" style={{ borderColor: CARD_BORDER, background: `radial-gradient(ellipse at top left, rgba(212,184,118,0.08), transparent 60%), ${CARD_BG}` }}>
        <h1 className="flex items-center gap-3 text-[22px] font-semibold text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)` }}>
            <Wallet size={20} style={{ color: '#1a1410' }} />
          </span>
          Aylık Ödeme Listesi
        </h1>
        <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
          Mükellefin bu ay ödeyeceği vergi tahakkukları ve SGK primleri tek cetvelde.
        </p>
        <div className="absolute right-6 top-6 flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setSelected(null); }}
            onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* tarayıcı desteklemiyorsa elle yazılır */ } }}
            className="cursor-pointer rounded-lg border bg-transparent px-3 py-1.5 text-[13px] text-white outline-none [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert"
            style={{ borderColor: 'rgba(255,255,255,0.12)', colorScheme: 'dark' }}
          />
          <button
            onClick={() => gonder(undefined)}
            disabled={sending !== null || rows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#141210', opacity: sending !== null || rows.length === 0 ? 0.5 : 1 }}
          >
            {sending === '__ALL__' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Tümüne Gönder ({rows.length})
          </button>
        </div>
      </header>

      {/* LİSTEDE NEDEN YOK — iki ayrı grup, kapalı başlar */}
      {(listeDisi.length > 0 || listedeAmaEksik.length > 0) && (
        <div className="rounded-2xl border" style={{ borderColor: 'rgba(251,191,36,0.24)', background: 'rgba(251,191,36,0.045)' }}>
          <button
            onClick={() => setEksikAcik((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold" style={{ color: '#fbbf24' }}>
              <span>Listede görünmeyen {new Set(listeDisi.map((e) => e.taxpayerId)).size} mükellef</span>
              {listedeAmaEksik.length > 0 && (
                <span className="text-[12px] font-medium" style={{ color: MUTED }}>
                  · listede olup eksiği olan {new Set(listedeAmaEksik.map((e) => e.taxpayerId)).size}
                </span>
              )}
            </span>
            <ChevronDown
              size={16}
              style={{ color: '#fbbf24', transform: eksikAcik ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
            />
          </button>
          {eksikAcik && (
            <div className="max-h-[420px] overflow-y-auto border-t px-5 py-3" style={{ borderColor: 'rgba(251,191,36,0.18)' }}>
              {([
                ['Listede hiç yok', listeDisi],
                ['Listede var, ama eksiği var', listedeAmaEksik],
              ] as Array<[string, EksikSatiri[]]>).map(([baslik, grup]) =>
                grup.length === 0 ? null : (
                  <div key={baslik} className="mb-3 last:mb-0">
                    <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                      {baslik} ({grup.length} kalem)
                    </div>
                    {grup.map((e, i) => (
                      <div key={`${e.taxpayerId}-${i}`} className="flex items-start gap-3 py-1.5 text-[12.5px]">
                        <span className="min-w-0 flex-1 truncate text-white" title={e.unvan}>{e.unvan}</span>
                        <span
                          className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase"
                          style={
                            e.kaynak === 'SGK'
                              ? { background: 'rgba(140,189,232,0.12)', color: '#8cbde8' }
                              : { background: 'rgba(212,184,118,0.12)', color: GOLD }
                          }
                        >
                          {e.kaynak === 'SGK' ? 'SGK' : 'Vergi'}
                        </span>
                        <span className="w-[300px] flex-shrink-0 text-right" style={{ color: MUTED }}>
                          {eksikMetni(e)}
                        </span>
                      </div>
                    ))}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 p-8 text-[13px]" style={{ color: MUTED }}>
          <Loader2 size={16} className="animate-spin" /> Yükleniyor…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border p-8 text-[13px]" style={{ borderColor: CARD_BORDER, background: CARD_BG, color: MUTED }}>
          {month} dönemi için tahakkuk verisi bulunamadı. Tahakkuklar gece otomasyonuyla çekildikçe burada listelenir.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* Sol: mükellef listesi */}
          <div className="max-h-[600px] overflow-y-auto rounded-2xl border p-2" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
            {rows.map((r) => (
              <button
                key={r.taxpayerId}
                onClick={() => setSelected(r.taxpayerId)}
                className="mb-1 w-full rounded-xl px-3 py-2.5 text-left"
                style={
                  active?.taxpayerId === r.taxpayerId
                    ? { background: 'rgba(212,184,118,0.14)', border: '1px solid rgba(212,184,118,0.4)' }
                    : { border: '1px solid transparent' }
                }
              >
                <div className="truncate text-[13px] font-semibold text-white">{r.unvan}</div>
                <div className="text-[12px]" style={{ color: GOLD }}>{trMoney(r.toplam)}</div>
              </button>
            ))}
            <div className="mt-2 border-t px-3 py-2 text-[12px]" style={{ borderColor: 'rgba(255,255,255,0.08)', color: MUTED }}>
              Genel toplam: <b style={{ color: GOLD }}>{trMoney(genelToplam)}</b>
            </div>
          </div>

          {/* Sağ: seçili mükellefin cetveli */}
          {active && (
            <div className="rounded-2xl border p-5" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full px-3 py-1 text-[11.5px] font-bold" style={{ background: 'rgba(140,189,232,0.12)', color: '#8cbde8', border: '1px solid rgba(140,189,232,0.3)' }}>{active.unvan}</span>
                <span className="ml-auto flex gap-2 print:hidden">
                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px]"
                    style={{ borderColor: 'rgba(255,255,255,0.12)', color: TEXT2 }}
                  >
                    <Printer size={14} /> Yazdır
                  </button>
                  <button
                    onClick={() => gonder(active.taxpayerId)}
                    disabled={sending !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-bold"
                    style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#141210', opacity: sending !== null ? 0.6 : 1 }}
                  >
                    {sending === active.taxpayerId ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    WhatsApp ile Gönder
                  </button>
                </span>
              </div>
{/* Uzun ödeme adı sütunları itip tutarı ekran dışına taşımasın:
                  table-fixed + colgroup. Cari listede bir kez bu hataya düşüldü. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] table-fixed border-collapse text-[13px]">
                  <colgroup>
                    <col />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 150 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: 'rgba(212,184,118,0.06)' }}>
                      {['Ödeme', 'Dönem', 'Son Ödeme', 'Tutar'].map((h, i) => (
                        <th
                          key={h}
                          className={`border-b px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider ${i === 3 ? 'text-right' : 'text-left'}`}
                          style={{ color: GOLD, borderColor: 'rgba(212,184,118,0.22)' }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {active.satirlar.map((s, i) => {
                      const sgk = s.kaynak === 'SGK';
                      const vade = vadeDurumu(s.sonGun);
                      return (
                        <tr key={i} className="transition hover:bg-white/[0.02]">
                          <td className="border-b px-3 py-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                            <span className="flex min-w-0 items-center gap-2">
                              {/* VERGİ / SGK ayrımı: iki farklı kurum, iki farklı renk */}
                              <i
                                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                                style={{ background: sgk ? '#8cbde8' : GOLD }}
                              />
                              <span className="truncate font-medium text-white">{odemeAdi(s)}</span>
                              <span
                                className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                                style={
                                  sgk
                                    ? { background: 'rgba(140,189,232,0.12)', color: '#8cbde8' }
                                    : { background: 'rgba(212,184,118,0.12)', color: GOLD }
                                }
                              >
                                {sgk ? 'SGK' : 'Vergi'}
                              </span>
                            </span>
                          </td>
                          <td className="border-b px-3 py-3 whitespace-nowrap" style={{ borderColor: 'rgba(255,255,255,0.06)', color: TEXT2 }}>
                            {donemAdi(s.donem)}
                          </td>
                          <td className="border-b px-3 py-3 whitespace-nowrap tabular-nums" style={{ borderColor: 'rgba(255,255,255,0.06)', color: vade.renk }}>
                            {tarihAdi(s.sonGun)}
                            {vade.etiket && (
                              <span className="ml-1.5 text-[10.5px] font-semibold">({vade.etiket})</span>
                            )}
                          </td>
                          <td
                            className="border-b px-3 py-3 text-right font-semibold tabular-nums text-white"
                            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                          >
                            {trMoney(s.tutar)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: 'rgba(212,184,118,0.05)' }}>
                      <td className="border-t px-3 py-3.5 text-[11.5px] font-bold uppercase tracking-wider" style={{ borderColor: 'rgba(212,184,118,0.28)', color: TEXT2 }}>
                        Toplam · {active.satirlar.length} kalem
                      </td>
                      <td className="border-t" style={{ borderColor: 'rgba(212,184,118,0.28)' }} />
                      <td className="border-t" style={{ borderColor: 'rgba(212,184,118,0.28)' }} />
                      <td
                        className="border-t px-3 py-3.5 text-right text-[15px] font-bold tabular-nums"
                        style={{ borderColor: 'rgba(212,184,118,0.28)', color: GOLD }}
                      >
                        {trMoney(active.toplam)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 rounded-r-xl border-l-[3px] py-2.5 pl-4 text-[12.5px]" style={{ borderColor: GOLD, background: 'rgba(212,184,118,0.08)', color: TEXT2 }}>
                <b className="text-white">Toplu mod:</b> &quot;Tümüne Gönder&quot; ile her mükellefe kendi cetveli gider; sonuç İletim Raporu&apos;na işlenir.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
