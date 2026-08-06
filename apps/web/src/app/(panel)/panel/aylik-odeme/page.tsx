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
import { Loader2, Printer, Send, Wallet } from 'lucide-react';

const GOLD = '#d4b876';
const MUTED = 'rgba(250,250,249,0.45)';
const TEXT2 = 'rgba(250,250,249,0.75)';
const CARD_BG = 'rgba(255,255,255,0.028)';
const CARD_BORDER = 'rgba(212,184,118,0.16)';

interface OdemeSatiri { tur: string; donem: string; sonGun: string | null; tutar: number; }
interface OdemeListesi { taxpayerId: string; unvan: string; phone: string | null; email: string | null; satirlar: OdemeSatiri[]; toplam: number; }

function trMoney(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ₺';
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

  const { data, isLoading } = useQuery({
    queryKey: ['aylik-odeme', month],
    queryFn: () => api.get('/aylik-odeme', { params: { month } }).then((r) => r.data as OdemeListesi[]),
  });

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
            className="rounded-lg border bg-transparent px-3 py-1.5 text-[13px] text-white outline-none"
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
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {['Ödeme', 'Dönem', 'Son Gün', 'Tutar'].map((h, i) => (
                      <th key={h} className={`border-b px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider ${i === 3 ? 'text-right' : 'text-left'}`} style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {active.satirlar.map((s, i) => (
                    <tr key={i}>
                      <td className="border-b px-3 py-2.5 text-white" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>{s.tur}</td>
                      <td className="border-b px-3 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)', color: TEXT2 }}>{s.donem}</td>
                      <td className="border-b px-3 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)', color: TEXT2 }}>{s.sonGun || '—'}</td>
                      <td className="border-b px-3 py-2.5 text-right font-mono" style={{ borderColor: 'rgba(255,255,255,0.06)', color: TEXT2 }}>{trMoney(s.tutar)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-3 py-3 font-bold text-white">TOPLAM</td>
                    <td /><td />
                    <td className="px-3 py-3 text-right font-mono font-bold" style={{ color: GOLD }}>{trMoney(active.toplam)}</td>
                  </tr>
                </tbody>
              </table>
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
