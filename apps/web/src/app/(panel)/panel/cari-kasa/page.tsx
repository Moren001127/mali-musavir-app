'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { CariTahsilatWorkspace } from './CariTahsilatWorkbench';
import {
  Plus, Download, Trash2, Loader2, X, Edit3, ArrowLeft, FileText, HandCoins,
} from 'lucide-react';

// ===== Palet (cari-06 / cari-07 referansı) =====
const GOLD = '#e6c878';
const GOLD_SOFT = '#d4b876';
const DEBT = '#e0697a';
const OK = '#5ad18a';
const BG = '#08080a';
const PANEL = '#0c0c0e';
const CARD_BORDER = 'rgba(255,255,255,0.06)';
const CARD_BG = 'rgba(255,255,255,0.018)';
const ROW_SEP = 'rgba(255,255,255,0.05)';
const TEXT = '#e7e7ea';
const MUTED = '#71717a';
const SANS = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
};

type Hizmet = {
  id: string;
  hizmetAdi: string;
  tutar: number;
  periyot: string;
  baslangicAy: string;
  bitisAy?: string | null;
  aktif: boolean;
  sonTahakkukAy?: string | null;
  notlar?: string | null;
};

type Hareket = {
  id: string;
  tarih: string;
  tip: 'TAHAKKUK' | 'TAHSILAT' | 'IADE' | 'DUZELTME';
  tutar: number | string;
  aciklama?: string | null;
  odemeYontemi?: string | null;
  belgeNo?: string | null;
  donem?: string | null;
  otoOlusturuldu: boolean;
  source?: string | null;
  sourceRef?: string | null;
  importBatchId?: string | null;
  hizmet?: { hizmetAdi: string } | null;
  account?: { id: string; name: string; type: string; color: string } | null;
  runningBakiye?: number;
};

type Bakiye = {
  tahakkuk: number; tahsilat: number; iade: number; duzeltme: number;
  borc: number; alacak: number; bakiye: number;
};

const moneyValue = (n: number | string | null | undefined) => {
  if (typeof n === 'number') return isFinite(n) ? n : 0;
  const raw = String(n ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmt = (n: number | string | null | undefined) => {
  const v = moneyValue(n);
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) : '—';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const today = () => new Date().toISOString().slice(0, 10);

export default function CariKasaPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const taxpayerId = searchParams.get('mukellef') || '';
  const setTaxpayerId = (id: string) => {
    if (id) router.push(`/panel/cari-kasa?mukellef=${id}`);
    else router.push('/panel/cari-kasa');
  };
  const [tab, setTab] = useState<'hareketler' | 'hizmetler' | 'ekstre'>('hareketler');
  const [hizmetModal, setHizmetModal] = useState<Hizmet | 'yeni' | null>(null);
  const [tahsilatModal, setTahsilatModal] = useState(false);

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers-for-cari'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });

  const { data: hizmetler = [] } = useQuery<Hizmet[]>({
    queryKey: ['cari-hizmetler', taxpayerId],
    queryFn: () => api.get('/cari-kasa/hizmet', { params: { taxpayerId } }).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const { data: hareketler = [] } = useQuery<Hareket[]>({
    queryKey: ['cari-hareketler', taxpayerId],
    queryFn: () => api.get('/cari-kasa/hareket', { params: { taxpayerId, limit: 500 } }).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const { data: bakiye } = useQuery<Bakiye>({
    queryKey: ['cari-bakiye', taxpayerId],
    queryFn: () => api.get(`/cari-kasa/bakiye/${taxpayerId}`).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  // Tüm hook'lar çağrıldı — şimdi early return güvenli (Rules of Hooks uyumlu)
  if (!taxpayerId) {
    return <CariTahsilatWorkspace onSelect={setTaxpayerId} />;
  }

  const selectedTaxpayer = taxpayers.find((t) => t.id === taxpayerId);
  const selectedAd = selectedTaxpayer
    ? (selectedTaxpayer.companyName || `${selectedTaxpayer.firstName || ''} ${selectedTaxpayer.lastName || ''}`.trim())
    : 'Mükellef';

  const sonHareketTarihi = hareketler.length
    ? hareketler.reduce((en, h) => (new Date(h.tarih) > new Date(en) ? h.tarih : en), hareketler[0].tarih)
    : null;

  const tabs: Array<['hareketler' | 'hizmetler' | 'ekstre', string]> = [
    ['hareketler', 'Hareketler'],
    ['hizmetler', 'Hizmetler'],
    ['ekstre', 'Ekstre'],
  ];

  return (
    <div className="min-h-screen px-4 sm:px-6 py-6" style={{ fontFamily: SANS, background: BG }}>
      <div className="mx-auto max-w-[1180px] rounded-[20px] p-5 sm:p-7" style={{ background: PANEL, border: '1px solid rgba(255,255,255,0.07)' }}>

        {/* ===== HEADER ===== */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <button
              onClick={() => setTaxpayerId('')}
              title="Listeye dön"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition"
              style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: '#a1a1aa' }}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide"
                style={{ background: 'rgba(230,200,120,0.12)', color: GOLD, border: '1px solid rgba(230,200,120,0.20)' }}
              >
                Cari · Detay
              </span>
              <h1 className="mt-1.5 text-[26px] font-bold tracking-tight leading-none" style={{ color: '#fff' }}>{selectedAd}</h1>
              {selectedTaxpayer?.taxNumber && (
                <p className="mt-1.5 text-[13.5px] tabular-nums" style={{ color: MUTED }}>VKN {selectedTaxpayer.taxNumber}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setTahsilatModal(true)}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold"
              style={{ background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000' }}
            >
              <Plus className="h-4 w-4" /> Tahsilat al
            </button>
            <button
              onClick={() => setTab('ekstre')}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium transition"
              style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: '#d4d4d8' }}
            >
              <Download className="h-4 w-4" /> Ekstre indir
            </button>
          </div>
        </div>

        {/* ===== METRİKLER (4) ===== */}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="Toplam Tahakkuk" value={bakiye?.tahakkuk} />
          <MetricCard label="Toplam Tahsilat" value={bakiye?.tahsilat} valueColor={OK} />
          <MetricCard label="Açık Bakiye" value={bakiye?.bakiye} valueColor={DEBT} debt />
          <MetricCard label="Son Hareket" text={fmtDate(sonHareketTarihi)} />
        </div>

        {/* ===== SEKMELER ===== */}
        <nav className="mt-7 flex items-center gap-7 text-[14.5px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {tabs.map(([t, label]) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="relative -mb-px pb-3 transition"
                style={{
                  borderBottom: `2px solid ${active ? GOLD : 'transparent'}`,
                  color: active ? '#fff' : MUTED,
                  fontWeight: active ? 600 : 500,
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-5">
          {tab === 'hareketler' && (
            <HareketlerView
              hareketler={hareketler}
              onDelete={async (id) => {
                if (!confirm('Bu hareketi silmek istediğinizden emin misiniz?')) return;
                try {
                  await api.delete(`/cari-kasa/hareket/${id}`);
                  toast.success('Hareket silindi');
                  qc.invalidateQueries({ queryKey: ['cari-hareketler'] });
                  qc.invalidateQueries({ queryKey: ['cari-bakiye'] });
                } catch (e: any) { toast.error(e?.response?.data?.message || 'Silinemedi'); }
              }}
            />
          )}

          {tab === 'hizmetler' && (
            <HizmetlerView
              hizmetler={hizmetler}
              onYeni={() => setHizmetModal('yeni')}
              onEdit={(h) => setHizmetModal(h)}
              onDelete={async (id) => {
                if (!confirm('Bu hizmet tanımını silmek istediğinizden emin misiniz? Geçmiş hareketler korunur.')) return;
                try {
                  await api.delete(`/cari-kasa/hizmet/${id}`);
                  toast.success('Hizmet silindi');
                  qc.invalidateQueries({ queryKey: ['cari-hizmetler'] });
                } catch (e: any) { toast.error(e?.response?.data?.message || 'Silinemedi'); }
              }}
            />
          )}

          {tab === 'ekstre' && <EkstreView taxpayerId={taxpayerId} taxpayers={taxpayers} />}
        </div>
      </div>

      {hizmetModal && (
        <HizmetModal
          taxpayerId={taxpayerId}
          hizmet={hizmetModal === 'yeni' ? null : hizmetModal}
          onClose={() => setHizmetModal(null)}
          onSaved={() => { setHizmetModal(null); qc.invalidateQueries({ queryKey: ['cari-hizmetler'] }); }}
        />
      )}

      {tahsilatModal && (
        <TahsilatModal
          taxpayerId={taxpayerId}
          mukellefAd={selectedAd}
          taxNumber={selectedTaxpayer?.taxNumber}
          acikBakiye={bakiye?.bakiye}
          onClose={() => setTahsilatModal(false)}
          onSaved={() => {
            setTahsilatModal(false);
            qc.invalidateQueries({ queryKey: ['cari-hareketler'] });
            qc.invalidateQueries({ queryKey: ['cari-bakiye'] });
            qc.invalidateQueries({ queryKey: ['cari-cashflow-summary'] });
            qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });
          }}
        />
      )}
    </div>
  );
}

// ==================== BİLEŞENLER ====================

function MetricCard({ label, value, text, valueColor, debt }: {
  label: string;
  value?: number;
  text?: string;
  valueColor?: string;
  debt?: boolean;
}) {
  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={debt
        ? { background: 'rgba(224,105,122,0.07)', border: '1px solid rgba(224,105,122,0.22)' }
        : { background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}
    >
      <div
        className="text-[11px] font-medium uppercase tracking-wider"
        style={{ color: debt ? 'rgba(234,163,173,0.85)' : MUTED }}
      >
        {label}
      </div>
      {text !== undefined ? (
        <div className="mt-2.5 text-[27px] font-bold tabular-nums" style={{ color: MUTED }}>{text}</div>
      ) : (
        <div className="mt-2.5 text-[27px] font-bold tabular-nums" style={{ color: valueColor || TEXT }}>
          {fmt(value)} <span className="text-[16px] font-semibold" style={{ color: debt ? 'rgba(234,163,173,0.6)' : MUTED }}>₺</span>
        </div>
      )}
    </div>
  );
}

function HareketlerView({ hareketler, onDelete }: {
  hareketler: Hareket[];
  onDelete: (id: string) => void;
}) {
  if (hareketler.length === 0) {
    return (
      <div className="rounded-2xl py-10 text-center text-[14px]" style={{ border: `1px solid ${CARD_BORDER}`, color: MUTED }}>
        Henüz hareket yok.
      </div>
    );
  }
  return (
    <div>
      <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
                <th className="px-5 py-3.5 text-left font-medium">Tarih</th>
                <th className="px-3 py-3.5 text-left font-medium">Tip</th>
                <th className="px-3 py-3.5 text-left font-medium">Açıklama</th>
                <th className="px-3 py-3.5 text-right font-medium">Borç</th>
                <th className="px-3 py-3.5 text-right font-medium">Alacak</th>
                <th className="px-5 py-3.5 text-left font-medium">Yöntem</th>
                <th className="px-3 py-3.5"></th>
              </tr>
            </thead>
            <tbody>
              {hareketler.map((h) => {
                const tutar = moneyValue(h.tutar);
                const borc = h.tip === 'TAHAKKUK' ? tutar : h.tip === 'IADE' ? -tutar : 0;
                const alacak = h.tip === 'TAHSILAT' ? tutar : h.tip === 'DUZELTME' ? -tutar : 0;
                const isTahsilat = h.tip === 'TAHSILAT';
                const badgeLabel = h.tip === 'TAHAKKUK' ? 'Tahakkuk' : isTahsilat ? 'Tahsilat' : h.tip === 'IADE' ? 'İade' : 'Düzeltme';
                const badgeStyle = isTahsilat
                  ? { background: 'rgba(90,209,138,0.12)', color: '#6ee29c', border: '1px solid rgba(90,209,138,0.22)' }
                  : { background: 'rgba(230,200,120,0.12)', color: GOLD, border: '1px solid rgba(230,200,120,0.20)' };
                return (
                  <tr key={h.id} className="group" style={{ borderTop: `1px solid ${ROW_SEP}` }}>
                    <td className="px-5 py-4 tabular-nums whitespace-nowrap" style={{ color: '#d4d4d8' }}>
                      {new Date(h.tarih).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-3 py-4">
                      <span className="inline-flex rounded-lg px-2.5 py-1 text-[12px] font-semibold" style={badgeStyle}>{badgeLabel}</span>
                    </td>
                    <td className="px-3 py-4" style={{ color: '#d4d4d8' }}>
                      {h.hizmet?.hizmetAdi && <span style={{ color: GOLD }}>{h.hizmet.hizmetAdi}</span>}
                      {h.hizmet?.hizmetAdi && h.aciklama && ' · '}
                      {h.aciklama || (!h.hizmet?.hizmetAdi ? '—' : '')}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums font-semibold" style={{ color: borc ? DEBT : '#3f3f46' }}>
                      {borc ? `${fmt(borc)} ₺` : '—'}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums font-semibold" style={{ color: alacak ? OK : '#3f3f46' }}>
                      {alacak ? `${fmt(alacak)} ₺` : '—'}
                    </td>
                    <td className="px-5 py-4 text-[13px]" style={{ color: h.odemeYontemi ? '#a1a1aa' : '#52525b' }}>
                      {h.odemeYontemi || '—'}
                    </td>
                    <td className="px-3 py-4 text-right">
                      <button
                        onClick={() => onDelete(h.id)}
                        title="Sil"
                        className="opacity-55 transition group-hover:opacity-100 p-1.5 rounded-lg"
                        style={{ color: DEBT }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-4 text-center text-[12px]" style={{ color: '#52525b' }}>
        Bakiye = tahakkuk − tahsilat · <span style={{ color: DEBT }}>borç bordo</span>, <span style={{ color: OK }}>alacak yeşil</span>
      </p>
    </div>
  );
}

function HizmetlerView({ hizmetler, onYeni, onEdit, onDelete }: {
  hizmetler: Hizmet[];
  onYeni: () => void;
  onEdit: (h: Hizmet) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
      <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${ROW_SEP}` }}>
        <h3 className="text-[14.5px] font-semibold" style={{ color: '#fff' }}>Tanımlı Hizmetler ({hizmetler.length})</h3>
        <button
          onClick={onYeni}
          className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold"
          style={{ background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000' }}
        >
          <Plus className="h-4 w-4" /> Yeni hizmet
        </button>
      </div>
      {hizmetler.length === 0 ? (
        <div className="py-10 text-center text-[14px]" style={{ color: MUTED }}>
          Henüz hizmet tanımı yok. "Yeni hizmet" ile başlayın.
        </div>
      ) : (
        hizmetler.map((h) => (
          <div key={h.id} className="group flex items-center gap-3 px-5 py-3.5" style={{ borderTop: `1px solid ${ROW_SEP}` }}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: h.aktif ? OK : '#3f3f46' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold" style={{ color: TEXT }}>{h.hizmetAdi}</div>
              <div className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>
                {h.periyot} · Başlangıç {h.baslangicAy}{h.bitisAy && ` · Bitiş ${h.bitisAy}`}
                {h.sonTahakkukAy && ` · Son tahakkuk ${h.sonTahakkukAy}`}
              </div>
            </div>
            <div className="text-[16px] font-bold tabular-nums" style={{ color: GOLD }}>{fmt(h.tutar)} ₺</div>
            <button
              onClick={() => onEdit(h)}
              title="Düzenle"
              className="opacity-55 transition group-hover:opacity-100 p-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.02)', color: '#a1a1aa' }}
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onDelete(h.id)}
              title="Sil"
              className="opacity-55 transition group-hover:opacity-100 p-2 rounded-lg"
              style={{ color: DEBT }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function EkstreView({ taxpayerId, taxpayers }: { taxpayerId: string; taxpayers: Taxpayer[] }) {
  const [baslangic, setBaslangic] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [bitis, setBitis] = useState(today());

  const { data: ekstre, isLoading } = useQuery({
    queryKey: ['cari-ekstre', taxpayerId, baslangic, bitis],
    queryFn: () => api.get(`/cari-kasa/ekstre/${taxpayerId}`, { params: { baslangic, bitis } }).then((r) => r.data),
    enabled: !!taxpayerId && !!baslangic && !!bitis,
  });

  const indirXlsx = async () => {
    try {
      const resp = await api.get(`/cari-kasa/ekstre/${taxpayerId}/xlsx`, {
        params: { baslangic, bitis },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      const muk = taxpayers.find((t) => t.id === taxpayerId);
      const ad = muk?.companyName || `${muk?.firstName || ''} ${muk?.lastName || ''}`.trim();
      a.download = `Ekstre_${ad}_${baslangic}_${bitis}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Excel indirilemedi'); }
  };

  const acPdf = () => {
    // JWT gerekli — fetch+blob, yeni sekmede aç
    api.get(`/cari-kasa/ekstre/${taxpayerId}/pdf`, { params: { baslangic, bitis }, responseType: 'text', transformResponse: (d) => d })
      .then((r) => {
        const blob = new Blob([r.data], { type: 'text/html; charset=utf-8' });
        const u = URL.createObjectURL(blob);
        window.open(u, '_blank');
        setTimeout(() => URL.revokeObjectURL(u), 5 * 60 * 1000);
      })
      .catch((e: any) => toast.error(e?.response?.data?.message || 'PDF açılamadı'));
  };

  const dateInput: React.CSSProperties = {
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
    color: TEXT, outline: 'none', borderRadius: 12, padding: '10px 12px', fontSize: 13,
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl px-5 py-4 flex items-end gap-3 flex-wrap" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: MUTED }}>Başlangıç</label>
          <input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} style={dateInput} />
        </div>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: MUTED }}>Bitiş</label>
          <input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} style={dateInput} />
        </div>
        <button
          onClick={acPdf}
          className="ml-auto inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition"
          style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: '#d4d4d8' }}
        >
          <FileText className="h-4 w-4" /> PDF yazdır
        </button>
        <button
          onClick={indirXlsx}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
          style={{ background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000' }}
        >
          <Download className="h-4 w-4" /> Excel indir
        </button>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-[13px]" style={{ color: MUTED }}>
          <Loader2 className="animate-spin inline mr-2 h-4 w-4" />Hesaplanıyor…
        </div>
      )}

      {ekstre && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Açılış Bakiye" value={ekstre.acilisBakiye} />
            <MetricCard label="Dönem Tahakkuk" value={ekstre.toplamTahakkuk} />
            <MetricCard label="Dönem Tahsilat" value={ekstre.toplamTahsilat} valueColor={OK} />
            <MetricCard label="Kapanış Bakiye" value={ekstre.kapanisBakiye} valueColor={DEBT} debt />
          </div>

          <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
                    <th className="px-5 py-3.5 text-left font-medium">Tarih</th>
                    <th className="px-3 py-3.5 text-left font-medium">Açıklama</th>
                    <th className="px-3 py-3.5 text-right font-medium">Borç</th>
                    <th className="px-3 py-3.5 text-right font-medium">Alacak</th>
                    <th className="px-5 py-3.5 text-right font-medium">Bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: 'rgba(255,255,255,0.022)' }}>
                    <td className="px-5 py-3.5 font-semibold" colSpan={4} style={{ color: TEXT }}>Açılış Bakiyesi</td>
                    <td className="px-5 py-3.5 text-right tabular-nums font-bold" style={{ color: TEXT }}>{fmt(ekstre.acilisBakiye)} ₺</td>
                  </tr>
                  {ekstre.satirlar.map((s: any) => {
                    const tutar = moneyValue(s.tutar);
                    const borc = s.tip === 'TAHAKKUK' ? tutar : s.tip === 'IADE' ? -tutar : 0;
                    const alacak = s.tip === 'TAHSILAT' ? tutar : s.tip === 'DUZELTME' ? -tutar : 0;
                    return (
                      <tr key={s.id} style={{ borderTop: `1px solid ${ROW_SEP}` }}>
                        <td className="px-5 py-3.5 tabular-nums whitespace-nowrap" style={{ color: '#d4d4d8' }}>
                          {new Date(s.tarih).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-3 py-3.5" style={{ color: '#d4d4d8' }}>
                          {s.hizmet?.hizmetAdi && <span style={{ color: GOLD }}>{s.hizmet.hizmetAdi}</span>}
                          {s.hizmet?.hizmetAdi && s.aciklama && ' · '}
                          {s.aciklama}
                        </td>
                        <td className="px-3 py-3.5 text-right tabular-nums font-semibold" style={{ color: borc ? DEBT : '#3f3f46' }}>
                          {borc ? `${fmt(borc)} ₺` : '—'}
                        </td>
                        <td className="px-3 py-3.5 text-right tabular-nums font-semibold" style={{ color: alacak ? OK : '#3f3f46' }}>
                          {alacak ? `${fmt(alacak)} ₺` : '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums" style={{ color: TEXT }}>{fmt(s.runningBakiye)} ₺</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'rgba(224,105,122,0.06)', borderTop: '1px solid rgba(224,105,122,0.22)' }}>
                    <td className="px-5 py-4 font-bold" colSpan={4} style={{ color: DEBT }}>Kapanış Bakiyesi</td>
                    <td className="px-5 py-4 text-right tabular-nums font-bold text-[15px]" style={{ color: DEBT }}>{fmt(ekstre.kapanisBakiye)} ₺</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==================== MODAL'LAR ====================

const lblStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 500, letterSpacing: '.04em', textTransform: 'uppercase', color: '#7c7c84',
};
const inpStyle: React.CSSProperties = {
  width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)',
  background: 'rgba(255,255,255,0.02)', color: TEXT, outline: 'none',
  padding: '11px 13px', fontSize: 14, fontVariantNumeric: 'tabular-nums',
};

function ModalShell({ etiket, baslik, etiketRengi, onClose, children, footer }: {
  etiket: string;
  baslik: string;
  etiketRengi: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4 py-8" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-[20px]"
        style={{ background: PANEL, border: '1px solid rgba(230,200,120,0.18)', boxShadow: '0 24px 60px -12px rgba(0,0,0,0.7)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: etiketRengi }}>{etiket}</div>
            <h1 className="mt-1 text-[24px] font-bold tracking-tight leading-none" style={{ color: '#fff' }}>{baslik}</h1>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition"
            style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: '#a1a1aa' }}
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
        {children}
        <div className="flex items-center justify-end gap-3 px-7 pt-4 pb-6">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label style={lblStyle}>{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function HizmetModal({ taxpayerId, hizmet, onClose, onSaved }: { taxpayerId: string; hizmet: Hizmet | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    hizmetAdi: hizmet?.hizmetAdi || 'Muhasebe Ücreti',
    tutar: hizmet?.tutar || 0,
    periyot: hizmet?.periyot || 'AYLIK',
    baslangicAy: hizmet?.baslangicAy || thisMonth(),
    bitisAy: hizmet?.bitisAy || '',
    aktif: hizmet?.aktif !== false,
    notlar: hizmet?.notlar || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (hizmet) {
        await api.put(`/cari-kasa/hizmet/${hizmet.id}`, {
          ...form,
          bitisAy: form.bitisAy || null,
          notlar: form.notlar || null,
        });
        toast.success('Hizmet güncellendi');
      } else {
        await api.post('/cari-kasa/hizmet', {
          ...form,
          taxpayerId,
          bitisAy: form.bitisAy || undefined,
          notlar: form.notlar || undefined,
        });
        toast.success('Hizmet eklendi');
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kaydedilemedi');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      etiket="Hizmet"
      baslik={hizmet ? 'Hizmet Düzenle' : 'Yeni Hizmet'}
      etiketRengi={GOLD}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-xl px-5 py-2.5 text-[13.5px] font-medium transition" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: '#d4d4d8' }}>Vazgeç</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000' }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />} {hizmet ? 'Güncelle' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="px-7 pb-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Hizmet Adı" full><input value={form.hizmetAdi} onChange={(e) => setForm({ ...form, hizmetAdi: e.target.value })} style={inpStyle} /></Field>
          <Field label="Tutar (₺)"><input type="number" step="0.01" value={form.tutar} onChange={(e) => setForm({ ...form, tutar: Number(e.target.value) })} style={inpStyle} /></Field>
          <Field label="Periyot">
            <select value={form.periyot} onChange={(e) => setForm({ ...form, periyot: e.target.value })} style={inpStyle}>
              <option value="AYLIK">Aylık</option>
              <option value="UCAYLIK">3 Aylık</option>
              <option value="ALTIAYLIK">6 Aylık</option>
              <option value="YILLIK">Yıllık</option>
            </select>
          </Field>
          <Field label="Başlangıç Ay (YYYY-MM)"><input value={form.baslangicAy} onChange={(e) => setForm({ ...form, baslangicAy: e.target.value })} placeholder="2026-01" style={inpStyle} /></Field>
          <Field label="Bitiş Ay (opsiyonel)"><input value={form.bitisAy} onChange={(e) => setForm({ ...form, bitisAy: e.target.value })} placeholder="2026-12" style={inpStyle} /></Field>
          <Field label="Notlar" full><textarea value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} rows={2} style={inpStyle} /></Field>
          <label className="col-span-2 flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
            <span className="text-[13px]" style={{ color: '#d4d4d8' }}>Aktif (tahakkuk geçer)</span>
          </label>
        </div>
      </div>
    </ModalShell>
  );
}

function TahsilatModal({ taxpayerId, mukellefAd, taxNumber, acikBakiye, onClose, onSaved }: {
  taxpayerId: string;
  mukellefAd?: string;
  taxNumber?: string | null;
  acikBakiye?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tarih: today(),
    tutar: 0,
    odemeYontemi: 'NAKIT',
    belgeNo: '',
    donem: thisMonth(),
    aciklama: '',
    accountId: '',
  });
  const [saving, setSaving] = useState(false);
  const { data: accounts = [] } = useQuery<Array<{ id: string; name: string; type: string; color: string; isActive: boolean }>>({
    queryKey: ['cari-accounts'],
    queryFn: () => api.get('/cari-kasa/accounts').then((r) => r.data),
  });

  useEffect(() => {
    if (!accounts.length || form.accountId) return;
    setForm((old) => ({ ...old, accountId: accounts[0].id }));
  }, [accounts, form.accountId]);

  const kalanBakiye = Math.max(Number(acikBakiye || 0) - moneyValue(form.tutar), 0);

  const save = async () => {
    if (form.tutar <= 0) { toast.error('Tutar pozitif olmalı'); return; }
    setSaving(true);
    if (!form.accountId) { toast.error('Tahsilat hesabı seçin'); setSaving(false); return; }
    try {
      await api.post('/cari-kasa/tahsilat', { ...form, taxpayerId });
      toast.success('Tahsilat eklendi');
      qc.invalidateQueries({ queryKey: ['cari-cashflow-summary'] });
      qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kaydedilemedi');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      etiket="Tahsilat"
      baslik="Tahsilat Al"
      etiketRengi={GOLD}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-xl px-5 py-2.5 text-[13.5px] font-medium transition" style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: '#d4d4d8' }}>Vazgeç</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000' }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />} Kaydet
          </button>
        </>
      }
    >
      {/* Mükellef satırı */}
      <div className="mx-7 rounded-xl px-4 py-3" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <span className="font-semibold" style={{ color: '#fff' }}>{mukellefAd || 'Mükellef'}</span>
          {taxNumber && (<><span style={{ color: '#52525b' }}>·</span><span className="tabular-nums" style={{ color: MUTED }}>VKN {taxNumber}</span></>)}
          <span style={{ color: '#52525b' }}>·</span>
          <span style={{ color: MUTED }}>açık bakiye</span>
          <span className="font-semibold tabular-nums" style={{ color: DEBT }}>{fmt(acikBakiye)} ₺</span>
        </div>
      </div>

      <div className="px-7 pt-5 pb-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Tarih"><input type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} style={inpStyle} /></Field>
          <Field label="Tutar (₺)"><input type="number" step="0.01" value={form.tutar} onChange={(e) => setForm({ ...form, tutar: Number(e.target.value) })} autoFocus style={{ ...inpStyle, fontSize: 18, fontWeight: 700, color: GOLD }} /></Field>
          <Field label="Ödeme Yöntemi">
            <select value={form.odemeYontemi} onChange={(e) => setForm({ ...form, odemeYontemi: e.target.value })} style={inpStyle}>
              <option value="NAKIT">Nakit</option>
              <option value="HAVALE">Havale/EFT</option>
              <option value="POS">POS/Kart</option>
              <option value="CEK">Çek</option>
              <option value="SENET">Senet</option>
            </select>
          </Field>
          <Field label="Hesap">
            <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={inpStyle}>
              <option value="">Hesap seçin</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Belge No (opsiyonel)"><input value={form.belgeNo} onChange={(e) => setForm({ ...form, belgeNo: e.target.value })} placeholder="Dekont/makbuz no" style={inpStyle} /></Field>
          <Field label="Hangi Ay İçin (opsiyonel)"><input value={form.donem} onChange={(e) => setForm({ ...form, donem: e.target.value })} placeholder="2026-04" style={inpStyle} /></Field>
          <Field label="Açıklama" full><input value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} style={inpStyle} /></Field>
        </div>

        {/* Bilgi şeridi: kalan bakiye */}
        <div className="mt-5 flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(230,200,120,0.06)', border: '1px solid rgba(230,200,120,0.15)' }}>
          <span className="text-[13px]" style={{ color: '#a1a1aa' }}>Bu tahsilat sonrası kalan bakiye</span>
          <span className="text-[16px] font-bold tabular-nums" style={{ color: GOLD }}>{fmt(kalanBakiye)} ₺</span>
        </div>
      </div>
    </ModalShell>
  );
}
