'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { galeriApi, Arac } from '@/lib/galeri';
import {
  Gavel, Plus, Search, Trash2, ExternalLink, RefreshCw, Car,
  CheckCircle2, AlertCircle, Clock, X as IconX, Edit2, Save,
  Zap, PlayCircle, Bot, FileText, Download,
} from 'lucide-react';
import { toast } from 'sonner';

const GOLD = '#d4b876';
const KGM_URL = 'https://webihlaltakip.kgm.gov.tr/WebIhlalSorgulama/Sayfalar/Sorgulama.aspx?lang=tr';

function fmtTarih(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtTL(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n) + ' ₺';
}

export default function HgsIhlalPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const { data: araclar = [], isLoading } = useQuery({
    queryKey: ['galeri-araclar', search],
    queryFn: () => galeriApi.listAraclar({ search: search || undefined }),
  });

  const { data: ozet } = useQuery({
    queryKey: ['galeri-ozet'],
    queryFn: () => galeriApi.ozet(),
  });

  // Agent durumu — her 15 saniyede bir yenile
  const { data: agentInfo } = useQuery({
    queryKey: ['galeri-agent-durumu'],
    queryFn: () => galeriApi.agentDurumu(),
    refetchInterval: 15000,
  });

  // Toplu sorgu başlatma mutation
  const topluSorguMut = useMutation({
    mutationFn: () => galeriApi.baslatTopluSorgu({ sadeceAktif: true }),
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.mesaj || 'Toplu sorgu komutu oluşturuldu');
      } else {
        toast.error(data.sebep || 'Sorgu başlatılamadı');
      }
      qc.invalidateQueries({ queryKey: ['galeri-agent-durumu'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Bir hata oluştu');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => galeriApi.deleteArac(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['galeri-araclar'] });
      qc.invalidateQueries({ queryKey: ['galeri-ozet'] });
      toast.success('Araç silindi');
    },
  });

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5 flex-wrap gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Galeri</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>HGS İhlal Sorgulama</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Araç plakalarını kaydet, KGM sisteminden ihlalli geçişlerini sorgula ve raporla.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={KGM_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.85)' }}
          >
            <ExternalLink size={14} /> KGM Sitesini Aç
          </a>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            <Plus size={14} /> Araç Ekle
          </button>
        </div>
      </div>

      {/* ÖZET */}
      {ozet && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OzetCard label="Toplam Araç" value={ozet.toplamArac} icon={Car} color="#fafaf9" />
          <OzetCard label="İhlalli Araç" value={ozet.ihlalliArac} icon={AlertCircle} color={ozet.ihlalliArac > 0 ? '#f43f5e' : '#22c55e'} />
          <OzetCard label="Toplam İhlal" value={ozet.toplamIhlal} icon={Gavel} color="#f59e0b" />
          <OzetCard label="Toplam Tutar" value={fmtTL(ozet.toplamTutar)} icon={Gavel} color={GOLD} />
        </div>
      )}

      {/* OTOMATIK SORGU PANELI */}
      <div
        className="rounded-xl p-5 flex items-center gap-4 flex-wrap"
        style={{
          background: 'linear-gradient(135deg, rgba(184,160,111,0.05), rgba(184,160,111,0.02))',
          border: '1px solid rgba(184,160,111,0.15)',
        }}
      >
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(184,160,111,0.1)', border: '1px solid rgba(184,160,111,0.25)' }}
          >
            <Bot size={18} style={{ color: GOLD }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                Otomatik HGS Sorgu
              </span>
              {agentInfo?.canli ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
                  Agent Çevrimiçi
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(250,250,249,0.05)', color: 'rgba(250,250,249,0.5)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(250,250,249,0.4)' }} />
                  Agent Kapalı
                </span>
              )}
            </div>
            <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
              {agentInfo?.aktifKomut
                ? <>Çalışıyor — <b>{agentInfo.aktifKomut.status === 'running' ? 'işleme alındı' : 'kuyrukta'}</b></>
                : agentInfo?.sonKomut
                  ? <>Son sorgu: <b>{fmtTarih(agentInfo.sonKomut.finishedAt || agentInfo.sonKomut.createdAt)}</b> · Her Pazartesi 08:00 otomatik çalışır</>
                  : 'Her Pazartesi 08:00 otomatik çalışır — manuel başlatabilirsin'}
            </div>
          </div>
        </div>
        <button
          onClick={() => topluSorguMut.mutate()}
          disabled={topluSorguMut.isPending || !!agentInfo?.aktifKomut}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
        >
          {topluSorguMut.isPending
            ? <><RefreshCw size={14} className="animate-spin" /> Başlatılıyor...</>
            : agentInfo?.aktifKomut
              ? <><Clock size={14} /> Çalışıyor...</>
              : <><PlayCircle size={14} /> Toplu Sorgu Başlat</>}
        </button>
        <a
          href={galeriApi.pdfRaporUrl()}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.85)' }}
        >
          <FileText size={14} /> PDF Rapor
        </a>
      </div>

      {/* ARAMA */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'rgba(250,250,249,0.4)' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Plaka, marka, model, sahip adı ara..."
          className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
        />
      </div>

      {/* LİSTE */}
      {isLoading && <div className="text-stone-400 text-sm">Yükleniyor...</div>}

      {!isLoading && araclar.length === 0 && (
        <div className="rounded-xl p-16 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Car className="w-12 h-12 mx-auto mb-4" style={{ color: 'rgba(250,250,249,0.2)' }} />
          <p className="text-[14px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {search ? 'Aramaya uyan araç yok.' : 'Henüz araç kaydedilmemiş.'}
          </p>
          {araclar.length === 0 && !search && (
            <button
              onClick={() => setAddOpen(true)}
              className="mt-4 text-[13px] font-semibold"
              style={{ color: GOLD }}
            >
              + İlk aracı ekle
            </button>
          )}
        </div>
      )}

      {araclar.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <table className="w-full text-[13px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
            <thead style={{ background: 'rgba(184,160,111,0.08)' }}>
              <tr className="text-left text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>
                <th className="px-4 py-3">Plaka</th>
                <th className="px-4 py-3">Marka / Model</th>
                <th className="px-4 py-3">Sahip</th>
                <th className="px-4 py-3">Son Sorgu</th>
                <th className="px-4 py-3 text-right">İhlal</th>
                <th className="px-4 py-3 text-right">Tutar</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {araclar.map((a: Arac) => <AracRow key={a.id} arac={a} onDelete={() => deleteMut.mutate(a.id)} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* Araç ekleme modal */}
      {addOpen && <AddAracModal onClose={() => setAddOpen(false)} onDone={() => {
        qc.invalidateQueries({ queryKey: ['galeri-araclar'] });
        qc.invalidateQueries({ queryKey: ['galeri-ozet'] });
      }} />}

      {/* Bilgilendirme */}
      <div className="rounded-xl p-4 text-[12px]" style={{ background: 'rgba(212,184,118,0.04)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.7)' }}>
        <strong style={{ color: GOLD }}>ℹ Otomatik sorgu yakında:</strong> Şu an KGM sitesine gidip elle sorgulama yapıp sonucu kaydediyorsunuz.
        İleride her Pazartesi sabah otomatik olarak Chrome eklentisi tüm araçları tek tek sorgulayıp sonuçları buraya kaydedecek.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// OZET CARD
// ════════════════════════════════════════════════════════════
function OzetCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}15`, border: `1px solid ${color}33`, color }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
        <div className="text-[18px] font-semibold tabular-nums mt-0.5" style={{ color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ARAC SATIRI
// ════════════════════════════════════════════════════════════
function AracRow({ arac, onDelete }: { arac: Arac; onDelete: () => void }) {
  const [sonucOpen, setSonucOpen] = useState(false);
  const s = arac.sonSorgu;
  const ihlalliMi = (s?.ihlalSayisi || 0) > 0;

  return (
    <>
      <tr className="group" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <td className="px-4 py-2.5">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md font-bold tabular-nums" style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD, fontFamily: 'JetBrains Mono, monospace' }}>
            {arac.plakaGorunum || arac.plaka}
          </div>
        </td>
        <td className="px-4 py-2.5 text-[12.5px]">
          {arac.marka || arac.model
            ? <span>{arac.marka} {arac.model && <span style={{ color: 'rgba(250,250,249,0.5)' }}>{arac.model}</span>}</span>
            : <span style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>}
        </td>
        <td className="px-4 py-2.5 text-[12.5px]">
          {arac.sahipAd || <span style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>}
        </td>
        <td className="px-4 py-2.5 text-[12px]">
          {s ? (
            <div className="flex items-center gap-2">
              {s.durum === 'basarili' && <CheckCircle2 size={13} style={{ color: '#22c55e' }} />}
              {s.durum === 'hatali' && <AlertCircle size={13} style={{ color: '#ef4444' }} />}
              {s.durum === 'beklemede' && <Clock size={13} style={{ color: '#f59e0b' }} />}
              <span style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtTarih(s.sorguTarihi)}</span>
            </div>
          ) : <span style={{ color: 'rgba(250,250,249,0.35)' }}>henüz yok</span>}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={{ fontFamily: 'JetBrains Mono, monospace', color: ihlalliMi ? '#f43f5e' : '#22c55e' }}>
          {s ? s.ihlalSayisi : '—'}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: ihlalliMi ? '#f59e0b' : 'rgba(250,250,249,0.6)' }}>
          {s ? fmtTL(s.toplamTutar) : '—'}
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={() => setSonucOpen(true)}
              className="text-[11px] font-medium px-2.5 py-1.5 rounded-md transition inline-flex items-center gap-1"
              style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}
              title="Sonuç kaydet"
            >
              <RefreshCw size={11} /> Sorgu Sonucu
            </button>
            <button
              onClick={() => {
                if (confirm(`${arac.plakaGorunum || arac.plaka} aracını silmek istediğine emin misin?\nTüm sorgu geçmişi de silinir.`)) {
                  onDelete();
                }
              }}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-rose-500/10 transition"
              style={{ color: 'rgba(244,63,94,0.7)' }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>
      {sonucOpen && <SonucKaydetModal arac={arac} onClose={() => setSonucOpen(false)} />}
    </>
  );
}

// ════════════════════════════════════════════════════════════
// ARAC EKLE MODAL
// ════════════════════════════════════════════════════════════
function AddAracModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [plaka, setPlaka] = useState('');
  const [marka, setMarka] = useState('');
  const [model, setModel] = useState('');
  const [sahipAd, setSahipAd] = useState('');
  const [notlar, setNotlar] = useState('');

  const createMut = useMutation({
    mutationFn: () => galeriApi.createArac({ plaka, marka: marka || undefined, model: model || undefined, sahipAd: sahipAd || undefined, notlar: notlar || undefined }),
    onSuccess: () => {
      toast.success('Araç eklendi');
      onDone();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Eklenemedi'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: '#11100c', border: '1px solid rgba(184,160,111,0.3)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, color: '#fafaf9' }}>Araç Ekle</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200"><IconX size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Plaka" required>
            <input value={plaka} onChange={(e) => setPlaka(e.target.value.toUpperCase())} placeholder="34 ABC 123" autoFocus
              className="w-full px-3 py-2 rounded-md text-[14px] font-mono outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marka (ops.)">
              <input value={marka} onChange={(e) => setMarka(e.target.value)} placeholder="Ford"
                className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
            </Field>
            <Field label="Model (ops.)">
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Transit"
                className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
            </Field>
          </div>
          <Field label="Sahip / Müşteri Adı (ops.)">
            <input value={sahipAd} onChange={(e) => setSahipAd(e.target.value)} placeholder="Örn: Ahmet Yılmaz Galerisi"
              className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
          </Field>
          <Field label="Notlar (ops.)">
            <textarea value={notlar} onChange={(e) => setNotlar(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-md text-[13px] outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
          </Field>
        </div>
        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium rounded-md"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>İptal</button>
          <button onClick={() => createMut.mutate()} disabled={!plaka.trim() || createMut.isPending}
            className="px-5 py-2 text-[12.5px] font-bold rounded-md disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
            {createMut.isPending ? 'Ekleniyor...' : 'Ekle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// SORGU SONUÇ KAYDET MODAL (manuel)
// ════════════════════════════════════════════════════════════
function SonucKaydetModal({ arac, onClose }: { arac: Arac; onClose: () => void }) {
  const qc = useQueryClient();
  const [ihlalSayisi, setIhlalSayisi] = useState('0');
  const [toplamTutar, setToplamTutar] = useState('');
  const [notlar, setNotlar] = useState('');

  const { data: gecmis = [] } = useQuery({
    queryKey: ['galeri-hgs-gecmis', arac.id],
    queryFn: () => galeriApi.sorguGecmisi(arac.id),
  });

  const kaydetMut = useMutation({
    mutationFn: () => galeriApi.kaydetSorgu(arac.id, {
      durum: 'basarili' as const,
      ihlalSayisi: parseInt(ihlalSayisi) || 0,
      toplamTutar: toplamTutar ? parseFloat(toplamTutar.replace(',', '.')) : null,
      detaylar: notlar ? { not: notlar } : null,
      kaynak: 'manuel' as const,
    } as any),
    onSuccess: () => {
      toast.success('Sorgu sonucu kaydedildi');
      qc.invalidateQueries({ queryKey: ['galeri-araclar'] });
      qc.invalidateQueries({ queryKey: ['galeri-ozet'] });
      qc.invalidateQueries({ queryKey: ['galeri-hgs-gecmis', arac.id] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Kayıt başarısız'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col" style={{ background: '#11100c', border: '1px solid rgba(184,160,111,0.3)', maxHeight: '85vh' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, color: '#fafaf9' }}>HGS Sorgu Sonucu</h3>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md mt-1.5 font-bold tabular-nums" style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD, fontFamily: 'JetBrains Mono, monospace' }}>
              {arac.plakaGorunum || arac.plaka}
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200"><IconX size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* KGM'ye yönlendirme */}
          <a
            href={KGM_URL}
            target="_blank"
            rel="noopener"
            className="block rounded-xl p-4 transition"
            style={{ background: 'rgba(212,184,118,0.08)', border: '1px solid rgba(212,184,118,0.3)' }}
          >
            <div className="flex items-center gap-3">
              <ExternalLink size={16} style={{ color: GOLD }} />
              <div className="flex-1">
                <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                  1) KGM sitesini aç ve plakayı sorgula
                </div>
                <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                  webihlaltakip.kgm.gov.tr — CAPTCHA çöz, plaka "{arac.plakaGorunum}" yaz, Sorgula
                </div>
              </div>
            </div>
          </a>

          {/* Sonuç giriş formu */}
          <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <h4 className="text-[13px] font-semibold mb-3" style={{ color: '#fafaf9' }}>2) Sonucu buraya kaydet</h4>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="İhlal Sayısı">
                <input type="number" min="0" value={ihlalSayisi} onChange={(e) => setIhlalSayisi(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-[14px] tabular-nums outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }} />
              </Field>
              <Field label="Toplam Tutar (TL)">
                <input type="text" value={toplamTutar} onChange={(e) => setToplamTutar(e.target.value)} placeholder="0"
                  className="w-full px-3 py-2 rounded-md text-[14px] tabular-nums outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }} />
              </Field>
            </div>
            <Field label="Not / Detay (ops.)">
              <textarea value={notlar} onChange={(e) => setNotlar(e.target.value)} rows={2}
                placeholder="Örn: 3 ihlal, Avrasya Tünelinden. 2 ihlal HGS yetersiz bakiye."
                className="w-full px-3 py-2 rounded-md text-[13px] outline-none resize-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
            </Field>
          </div>

          {/* Geçmiş sorgular */}
          {gecmis.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <h4 className="text-[12.5px] font-semibold" style={{ color: 'rgba(250,250,249,0.75)' }}>Geçmiş Sorgular ({gecmis.length})</h4>
              </div>
              <ul className="max-h-[220px] overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {gecmis.map((g) => (
                  <li key={g.id} className="px-4 py-2 text-[12px] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {g.durum === 'basarili' && <CheckCircle2 size={13} style={{ color: '#22c55e' }} />}
                      {g.durum === 'hatali' && <AlertCircle size={13} style={{ color: '#ef4444' }} />}
                      <span style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtTarih(g.sorguTarihi)}</span>
                      <span className="text-[10.5px] uppercase tracking-wider opacity-60">{g.kaynak}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="tabular-nums font-semibold" style={{ color: g.ihlalSayisi > 0 ? '#f43f5e' : '#22c55e', fontFamily: 'JetBrains Mono, monospace' }}>
                        {g.ihlalSayisi} ihlal
                      </span>
                      <span className="tabular-nums" style={{ color: g.toplamTutar ? '#f59e0b' : 'rgba(250,250,249,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtTL(g.toplamTutar)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium rounded-md"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>İptal</button>
          <button onClick={() => kaydetMut.mutate()} disabled={kaydetMut.isPending}
            className="px-5 py-2 text-[12.5px] font-bold rounded-md inline-flex items-center gap-1.5"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
            <Save size={13} /> {kaydetMut.isPending ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-[10.5px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
        {label} {required && <span style={{ color: '#f43f5e' }}>*</span>}
      </label>
      {children}
    </div>
  );
}
