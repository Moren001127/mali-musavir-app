'use client';

// =====================================================================
// İLETİM RAPORU — Ofis > İletim Raporu
// Akıllı Bildirim motorunun dağıtım kayıtları: kim aldı, kim almadı.
// Kategoriler: Vergi (beyanname+tahakkuk) / SGK / e-Tebligat.
// =====================================================================

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Send, ClipboardList } from 'lucide-react';

const GOLD = '#d4b876';
const MUTED = 'rgba(250,250,249,0.45)';
const TEXT2 = 'rgba(250,250,249,0.75)';
const CARD_BG = 'rgba(255,255,255,0.028)';
const CARD_BORDER = 'rgba(212,184,118,0.16)';

const KATEGORI_COLS: Array<{ key: 'VERGI' | 'SGK' | 'ETEBLIGAT'; label: string }> = [
  { key: 'VERGI', label: 'Vergi' },
  { key: 'SGK', label: 'SGK' },
  { key: 'ETEBLIGAT', label: 'e-Tebligat' },
];

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function Cell({ v }: { v: { status: string; error?: string | null } | null }) {
  if (!v) return <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)' }}>–</span>;
  if (v.status === 'SENT') return <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg font-extrabold" style={{ background: 'rgba(34,197,94,0.13)', color: '#4ade80' }}>✓</span>;
  return (
    <span title={v.error || undefined} className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg font-extrabold" style={{ background: 'rgba(248,113,113,0.13)', color: '#f87171' }}>!</span>
  );
}

function Stat({ n, label, color, sub }: { n: number; label: string; color: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-2xl border p-4" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
      <div className="text-[26px] font-extrabold" style={{ color }}>{n}</div>
      <div className="mt-0.5 text-[11px] tracking-wide" style={{ color: MUTED }}>{label}</div>
      {sub ? <div className="mt-1 text-[11px]" style={{ color: MUTED }}>{sub}</div> : null}
    </div>
  );
}

export default function IletimRaporuPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [resending, setResending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['iletim-raporu', month],
    queryFn: () => api.get('/akilli-bildirim/report', { params: { month } }).then((r) => r.data),
    refetchInterval: 60000,
  });

  const resend = async () => {
    setResending(true);
    try {
      const r = await api.post('/akilli-bildirim/resend-failed', { month });
      toast.success(`${r.data?.retried ?? 0} başarısız gönderim yeniden denendi`);
      qc.invalidateQueries({ queryKey: ['iletim-raporu', month] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Yeniden gönderilemedi');
    } finally {
      setResending(false);
    }
  };

  const totals = data?.totals || { total: 0, sent: 0, failed: 0, badContact: 0 };
  const rows: any[] = data?.taxpayers || [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="relative overflow-hidden rounded-2xl border p-6" style={{ borderColor: CARD_BORDER, background: `radial-gradient(ellipse at top left, rgba(74,222,128,0.06), transparent 60%), ${CARD_BG}` }}>
        <h1 className="flex items-center gap-3 text-[22px] font-semibold text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)` }}>
            <ClipboardList size={20} style={{ color: '#1a1410' }} />
          </span>
          İletim Raporu
        </h1>
        <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
          Mükellefe gönderilen belgelerin dağıtım durumu — kim aldı, kim almadı.
        </p>
        <div className="absolute right-6 top-6 flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border bg-transparent px-3 py-1.5 text-[13px] text-white outline-none"
            style={{ borderColor: 'rgba(255,255,255,0.12)', colorScheme: 'dark' }}
          />
          <button
            onClick={resend}
            disabled={resending || totals.failed === 0}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)', opacity: resending || totals.failed === 0 ? 0.5 : 1 }}
          >
            {resending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Eksikleri Şimdi Gönder ({totals.failed})
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3.5">
        <Stat n={totals.total} label="GÖNDERİM KAYDI" color={GOLD} />
        <Stat n={totals.sent} label="İLETİLDİ" color="#4ade80" />
        <Stat n={totals.failed} label="İLETİLMEDİ" color="#f87171" />
        <Stat n={totals.badContact} label="İLETİŞİM BİLGİSİ EKSİK" color="#fbbf24" />
      </div>

      <div className="overflow-x-auto rounded-2xl border p-4" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-[13px]" style={{ color: MUTED }}>
            <Loader2 size={16} className="animate-spin" /> Yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-[13px]" style={{ color: MUTED }}>
            Bu ay henüz gönderim kaydı yok. Gönderimler Ayarlar &gt; Akıllı Bildirim&apos;den yönetilir.
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }}>Mükellef</th>
                {KATEGORI_COLS.map((k) => (
                  <th key={k.key} className="border-b px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }}>{k.label}</th>
                ))}
                <th className="border-b px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const eksik = KATEGORI_COLS.filter((k) => r[k.key] && r[k.key].status !== 'SENT').length;
                const iletisimHata = KATEGORI_COLS.some((k) => (r[k.key]?.error || '').includes('telefon') || (r[k.key]?.error || '').includes('e-posta'));
                return (
                  <tr key={r.taxpayerId}>
                    <td className="border-b px-3 py-2.5 text-white" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>{r.unvan}</td>
                    {KATEGORI_COLS.map((k) => (
                      <td key={k.key} className="border-b px-3 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Cell v={r[k.key]} />
                      </td>
                    ))}
                    <td className="border-b px-3 py-2.5 text-right" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      {iletisimHata ? (
                        <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>İletişim bilgisi eksik</span>
                      ) : eksik > 0 ? (
                        <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>{eksik} eksik</span>
                      ) : (
                        <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>Tamam</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex gap-4 text-[11.5px]" style={{ color: MUTED }}>
          <span><span style={{ color: '#4ade80' }}>✓</span> iletildi</span>
          <span><span style={{ color: '#f87171' }}>!</span> iletilmedi</span>
          <span>– bu kategoride belge yok</span>
        </div>
      </div>
    </div>
  );
}
