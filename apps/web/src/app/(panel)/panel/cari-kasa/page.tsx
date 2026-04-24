'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import TaxpayerSelect from '@/components/ui/TaxpayerSelect';
import { toast } from 'sonner';
import {
  Wallet, Calendar, Plus, Download, Trash2, FileText, Loader2,
  TrendingUp, TrendingDown, CheckCircle2, X, Edit3,
} from 'lucide-react';

const GOLD = '#d4b876';
const BORDO = '#9c4656';

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
  tutar: number;
  aciklama?: string | null;
  odemeYontemi?: string | null;
  belgeNo?: string | null;
  donem?: string | null;
  otoOlusturuldu: boolean;
  hizmet?: { hizmetAdi: string } | null;
  runningBakiye?: number;
};

type Bakiye = {
  tahakkuk: number; tahsilat: number; iade: number; duzeltme: number;
  borc: number; alacak: number; bakiye: number;
};

const fmt = (n: number | null | undefined) => {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const today = () => new Date().toISOString().slice(0, 10);

export default function CariKasaPage() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [tab, setTab] = useState<'hizmetler' | 'hareketler' | 'ekstre'>('hizmetler');
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[.14em] mb-1" style={{ color: 'rgba(212,184,118,0.7)' }}>
            Finansal Takip · Cari
          </div>
          <h1 className="font-semibold" style={{ fontFamily: 'Fraunces, serif', fontSize: 32, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Cari Kasa
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Müşteri hizmetleri, aylık otomatik tahakkuk ve ödeme takibi. Ekstre yazdırılabilir.
          </p>
        </div>
        {taxpayerId && (
          <button
            onClick={() => setTahsilatModal(true)}
            className="px-4 py-2 rounded-[9px] text-[12.5px] font-bold inline-flex items-center gap-2"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b', boxShadow: '0 2px 10px rgba(212,184,118,0.35)' }}
          >
            <Plus size={14} /> Tahsilat Ekle
          </button>
        )}
      </div>

      {/* Mükellef seçici */}
      <div className="rounded-2xl p-5 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
        <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
          Mükellef
        </label>
        <TaxpayerSelect
          taxpayers={taxpayers}
          value={taxpayerId}
          onChange={setTaxpayerId}
          placeholder="— Mükellef Seçin —"
        />
      </div>

      {taxpayerId && (
        <>
          {/* Bakiye kartları */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SummaryCard label="Toplam Tahakkuk" value={bakiye?.tahakkuk ?? 0} color="#60a5fa" icon={TrendingUp} />
            <SummaryCard label="Toplam Tahsilat" value={bakiye?.tahsilat ?? 0} color="#4ade80" icon={TrendingDown} />
            <SummaryCard label="Bakiye" value={bakiye?.bakiye ?? 0} color={BORDO} highlight big icon={Wallet} />
            <SummaryCard label="Son Güncelleme" text={new Date().toLocaleString('tr-TR')} icon={Calendar} />
          </div>

          {/* Tab'lar */}
          <div className="flex gap-1.5">
            {(['hizmetler', 'hareketler', 'ekstre'] as const).map((t) => {
              const active = tab === t;
              const label = t === 'hizmetler' ? 'Hizmet Tanımları' : t === 'hareketler' ? 'Hareket Listesi' : 'Ekstre';
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="px-4 py-2 rounded-[10px] text-[12.5px] font-semibold transition-all"
                  style={{
                    background: active ? 'rgba(184,160,111,0.15)' : 'rgba(255,255,255,0.03)',
                    color: active ? GOLD : 'rgba(250,250,249,0.6)',
                    border: `1px solid ${active ? 'rgba(184,160,111,0.35)' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

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

          {tab === 'ekstre' && <EkstreView taxpayerId={taxpayerId} taxpayers={taxpayers} />}
        </>
      )}

      {!taxpayerId && (
        <div className="rounded-2xl p-12 text-center border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(212,184,118,0.1)' }}>
            <Wallet size={24} style={{ color: GOLD }} />
          </div>
          <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Başlamak için mükellef seçin</p>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Hizmet tanımla → her ayın 1'inde otomatik tahakkuk → tahsilat kaydet → ekstre yazdır
          </p>
        </div>
      )}

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
          onClose={() => setTahsilatModal(false)}
          onSaved={() => {
            setTahsilatModal(false);
            qc.invalidateQueries({ queryKey: ['cari-hareketler'] });
            qc.invalidateQueries({ queryKey: ['cari-bakiye'] });
          }}
        />
      )}
    </div>
  );
}

// ==================== COMPONENT'LER ====================

function SummaryCard({ label, value, text, color, icon: Icon, highlight, big }: any) {
  return (
    <div className="rounded-2xl p-4 border" style={{ background: highlight ? 'rgba(156,70,86,0.08)' : 'rgba(255,255,255,0.02)', borderColor: highlight ? 'rgba(156,70,86,0.3)' : 'rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={13} style={{ color: color || 'rgba(250,250,249,0.5)' }} />}
        <div className="text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
      </div>
      {text ? (
        <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.65)' }}>{text}</div>
      ) : (
        <div className={big ? 'text-[26px] font-bold' : 'text-[20px] font-bold'} style={{ fontFamily: 'JetBrains Mono, monospace', color }}>
          ₺{fmt(value)}
        </div>
      )}
    </div>
  );
}

function HizmetlerView({ hizmetler, onYeni, onEdit, onDelete }: any) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Tanımlı Hizmetler ({hizmetler.length})</h3>
        <button onClick={onYeni} className="px-3 py-1.5 rounded-md text-[11.5px] font-semibold inline-flex items-center gap-1.5" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD, border: '1px solid rgba(212,184,118,0.3)' }}>
          <Plus size={12} /> Yeni Hizmet
        </button>
      </div>
      {hizmetler.length === 0 ? (
        <div className="py-8 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          Henüz hizmet tanımı yok. "Yeni Hizmet" ile başlayın.
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {hizmetler.map((h: Hizmet) => (
            <div key={h.id} className="px-5 py-3 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${h.aktif ? '' : 'opacity-30'}`} style={{ background: h.aktif ? '#4ade80' : 'rgba(250,250,249,0.3)' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{h.hizmetAdi}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  {h.periyot} · Başlangıç {h.baslangicAy}{h.bitisAy && ` · Bitiş ${h.bitisAy}`}
                  {h.sonTahakkukAy && ` · Son tahakkuk ${h.sonTahakkukAy}`}
                </div>
              </div>
              <div className="text-[15px] font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: GOLD }}>
                ₺{fmt(h.tutar)}
              </div>
              <button onClick={() => onEdit(h)} className="p-2 rounded-md" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.6)' }} title="Düzenle">
                <Edit3 size={13} />
              </button>
              <button onClick={() => onDelete(h.id)} className="p-2 rounded-md" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }} title="Sil">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HareketlerView({ hareketler, onDelete }: any) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
      <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Hareket Listesi ({hareketler.length})</h3>
      </div>
      {hareketler.length === 0 ? (
        <div className="py-8 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Henüz hareket yok.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: 'rgba(250,250,249,0.5)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th className="text-left px-4 py-2">Tarih</th>
                <th className="text-left px-4 py-2">Tip</th>
                <th className="text-left px-4 py-2">Açıklama</th>
                <th className="text-right px-4 py-2">Borç</th>
                <th className="text-right px-4 py-2">Alacak</th>
                <th className="text-left px-4 py-2">Ödeme</th>
                <th className="text-center px-4 py-2">Kaynak</th>
                <th></th>
              </tr>
            </thead>
            <tbody style={{ color: '#fafaf9' }}>
              {hareketler.map((h: Hareket) => {
                const borc = h.tip === 'TAHAKKUK' ? h.tutar : h.tip === 'IADE' ? -h.tutar : 0;
                const alacak = h.tip === 'TAHSILAT' ? h.tutar : h.tip === 'DUZELTME' ? -h.tutar : 0;
                return (
                  <tr key={h.id} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="px-4 py-2 tabular-nums">{new Date(h.tarih).toLocaleDateString('tr-TR')}</td>
                    <td className="px-4 py-2">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold" style={{
                        background: h.tip === 'TAHAKKUK' ? 'rgba(96,165,250,0.12)' : h.tip === 'TAHSILAT' ? 'rgba(74,222,128,0.12)' : 'rgba(250,204,21,0.12)',
                        color: h.tip === 'TAHAKKUK' ? '#60a5fa' : h.tip === 'TAHSILAT' ? '#4ade80' : '#fde047',
                      }}>{h.tip}</span>
                    </td>
                    <td className="px-4 py-2 truncate max-w-[300px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
                      {h.hizmet?.hizmetAdi && <span style={{ color: GOLD }}>{h.hizmet.hizmetAdi}</span>}
                      {h.hizmet?.hizmetAdi && h.aciklama && ' · '}
                      {h.aciklama}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: borc ? '#60a5fa' : 'rgba(250,250,249,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {borc ? fmt(borc) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: alacak ? '#4ade80' : 'rgba(250,250,249,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {alacak ? fmt(alacak) : '—'}
                    </td>
                    <td className="px-4 py-2 text-[11px]" style={{ color: 'rgba(250,250,249,0.55)' }}>{h.odemeYontemi || '—'}</td>
                    <td className="px-4 py-2 text-center text-[10px]">
                      {h.otoOlusturuldu ? <span style={{ color: 'rgba(212,184,118,0.7)' }}>OTO</span> : <span style={{ color: 'rgba(250,250,249,0.35)' }}>Manuel</span>}
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => onDelete(h.id)} className="p-1.5 rounded" style={{ color: '#fca5a5' }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4 border flex items-end gap-3 flex-wrap" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
        <div>
          <label className="text-[10.5px] font-bold uppercase tracking-[.12em] block mb-1" style={{ color: 'rgba(250,250,249,0.5)' }}>Başlangıç</label>
          <input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} className="px-3 py-2 rounded-md text-[13px] outline-none" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
        </div>
        <div>
          <label className="text-[10.5px] font-bold uppercase tracking-[.12em] block mb-1" style={{ color: 'rgba(250,250,249,0.5)' }}>Bitiş</label>
          <input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} className="px-3 py-2 rounded-md text-[13px] outline-none" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
        </div>
        <button onClick={indirXlsx} className="px-4 py-2 rounded-md text-[12.5px] font-bold inline-flex items-center gap-2 ml-auto" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
          <Download size={13} /> Excel İndir
        </button>
      </div>

      {isLoading && <div className="py-8 text-center" style={{ color: 'rgba(250,250,249,0.5)' }}><Loader2 className="animate-spin inline mr-2" size={16} />Hesaplanıyor…</div>}
      {ekstre && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SummaryCard label="Açılış Bakiye" value={ekstre.acilisBakiye} color="#60a5fa" />
            <SummaryCard label="Dönem Tahakkuk" value={ekstre.toplamTahakkuk} color="#60a5fa" />
            <SummaryCard label="Dönem Tahsilat" value={ekstre.toplamTahsilat} color="#4ade80" />
            <SummaryCard label="Kapanış Bakiye" value={ekstre.kapanisBakiye} color={BORDO} highlight big />
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ color: 'rgba(250,250,249,0.5)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <th className="text-left px-4 py-2">Tarih</th>
                    <th className="text-left px-4 py-2">Açıklama</th>
                    <th className="text-right px-4 py-2">Borç</th>
                    <th className="text-right px-4 py-2">Alacak</th>
                    <th className="text-right px-4 py-2">Bakiye</th>
                  </tr>
                </thead>
                <tbody style={{ color: '#fafaf9' }}>
                  <tr style={{ background: 'rgba(96,165,250,0.05)' }}>
                    <td className="px-4 py-2" colSpan={4}><b>Açılış Bakiyesi</b></td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(ekstre.acilisBakiye)}</td>
                  </tr>
                  {ekstre.satirlar.map((s: any) => {
                    const borc = s.tip === 'TAHAKKUK' ? s.tutar : s.tip === 'IADE' ? -s.tutar : 0;
                    const alacak = s.tip === 'TAHSILAT' ? s.tutar : s.tip === 'DUZELTME' ? -s.tutar : 0;
                    return (
                      <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                        <td className="px-4 py-2 tabular-nums">{new Date(s.tarih).toLocaleDateString('tr-TR')}</td>
                        <td className="px-4 py-2 truncate max-w-[400px]">
                          {s.hizmet?.hizmetAdi && <span style={{ color: GOLD }}>{s.hizmet.hizmetAdi}</span>}
                          {s.hizmet?.hizmetAdi && s.aciklama && ' · '}
                          {s.aciklama}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums" style={{ color: borc ? '#60a5fa' : 'rgba(250,250,249,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {borc ? fmt(borc) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums" style={{ color: alacak ? '#4ade80' : 'rgba(250,250,249,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {alacak ? fmt(alacak) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#fafaf9' }}>
                          ₺{fmt(s.runningBakiye)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'rgba(156,70,86,0.08)', borderTop: '2px solid rgba(156,70,86,0.3)' }}>
                    <td className="px-4 py-3" colSpan={4}><b style={{ color: BORDO }}>Kapanış Bakiyesi</b></td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-[15px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: BORDO }}>
                      ₺{fmt(ekstre.kapanisBakiye)}
                    </td>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="rounded-2xl p-6 max-w-md w-full mx-4" style={{ background: '#13110f', border: '1px solid rgba(212,184,118,0.3)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>{hizmet ? 'Hizmet Düzenle' : 'Yeni Hizmet'}</h3>
          <button onClick={onClose}><X size={18} style={{ color: 'rgba(250,250,249,0.5)' }} /></button>
        </div>
        <div className="space-y-3">
          <Field label="Hizmet Adı"><input value={form.hizmetAdi} onChange={(e) => setForm({ ...form, hizmetAdi: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
          <Field label="Tutar (₺)"><input type="number" step="0.01" value={form.tutar} onChange={(e) => setForm({ ...form, tutar: Number(e.target.value) })} className="w-full px-3 py-2 rounded-md tabular-nums" style={inpStyle} /></Field>
          <Field label="Periyot">
            <select value={form.periyot} onChange={(e) => setForm({ ...form, periyot: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inpStyle}>
              <option value="AYLIK">Aylık</option>
              <option value="UCAYLIK">3 Aylık</option>
              <option value="ALTIAYLIK">6 Aylık</option>
              <option value="YILLIK">Yıllık</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Başlangıç Ay (YYYY-MM)"><input value={form.baslangicAy} onChange={(e) => setForm({ ...form, baslangicAy: e.target.value })} placeholder="2026-01" className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
            <Field label="Bitiş Ay (opsiyonel)"><input value={form.bitisAy} onChange={(e) => setForm({ ...form, bitisAy: e.target.value })} placeholder="2026-12" className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
            <span className="text-[12px]" style={{ color: '#fafaf9' }}>Aktif (tahakkuk geçer)</span>
          </label>
          <Field label="Notlar"><textarea value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-md text-[12.5px]" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.7)' }}>İptal</button>
          <button onClick={save} disabled={saving} className="flex-1 px-3 py-2 rounded-md text-[12.5px] font-bold disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
            {saving ? <Loader2 size={14} className="animate-spin inline" /> : (hizmet ? 'Güncelle' : 'Kaydet')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TahsilatModal({ taxpayerId, onClose, onSaved }: { taxpayerId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    tarih: today(),
    tutar: 0,
    odemeYontemi: 'NAKIT',
    belgeNo: '',
    donem: thisMonth(),
    aciklama: '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (form.tutar <= 0) { toast.error('Tutar pozitif olmalı'); return; }
    setSaving(true);
    try {
      await api.post('/cari-kasa/tahsilat', { ...form, taxpayerId });
      toast.success('Tahsilat eklendi');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kaydedilemedi');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="rounded-2xl p-6 max-w-md w-full mx-4" style={{ background: '#13110f', border: '1px solid rgba(74,222,128,0.3)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold" style={{ color: '#4ade80', fontFamily: 'Fraunces, serif' }}>Tahsilat Ekle</h3>
          <button onClick={onClose}><X size={18} style={{ color: 'rgba(250,250,249,0.5)' }} /></button>
        </div>
        <div className="space-y-3">
          <Field label="Tarih"><input type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
          <Field label="Tutar (₺)"><input type="number" step="0.01" value={form.tutar} onChange={(e) => setForm({ ...form, tutar: Number(e.target.value) })} autoFocus className="w-full px-3 py-2 rounded-md tabular-nums" style={inpStyle} /></Field>
          <Field label="Ödeme Yöntemi">
            <select value={form.odemeYontemi} onChange={(e) => setForm({ ...form, odemeYontemi: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inpStyle}>
              <option value="NAKIT">Nakit</option>
              <option value="HAVALE">Havale/EFT</option>
              <option value="POS">POS/Kart</option>
              <option value="CEK">Çek</option>
              <option value="SENET">Senet</option>
            </select>
          </Field>
          <Field label="Belge No (opsiyonel)"><input value={form.belgeNo} onChange={(e) => setForm({ ...form, belgeNo: e.target.value })} placeholder="Dekont/makbuz no" className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
          <Field label="Hangi Ay İçin (opsiyonel)"><input value={form.donem} onChange={(e) => setForm({ ...form, donem: e.target.value })} placeholder="2026-04" className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
          <Field label="Açıklama"><input value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inpStyle} /></Field>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-md text-[12.5px]" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.7)' }}>İptal</button>
          <button onClick={save} disabled={saving} className="flex-1 px-3 py-2 rounded-md text-[12.5px] font-bold disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #4ade80, #22c55e)', color: '#0a2e0a' }}>
            {saving ? <Loader2 size={14} className="animate-spin inline" /> : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inpStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', outline: 'none', fontSize: 13 };
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10.5px] font-bold uppercase tracking-[.12em] block mb-1" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</label>
      {children}
    </div>
  );
}
