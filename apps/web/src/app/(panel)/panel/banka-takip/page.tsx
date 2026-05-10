'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bankaTakipApi, BankaTakipItem, BankaHesap } from '@/lib/banka-takip';
import { toast } from 'sonner';
import {
  Landmark, Calendar, Search, Plus, Check, X, Edit2, Trash2,
  Loader2, AlertCircle, CheckCircle2, FileText, Building2,
  ClipboardList, ArrowRight, Layers3,
} from 'lucide-react';

const GOLD = '#d4b876';

function taxpayerName(t: BankaTakipItem['taxpayer']): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

export default function BankaTakipPage() {
  const qc = useQueryClient();
  const [donem, setDonem] = useState(() => {
    const d = new Date();
    // Çeyreğin ilk ayını dönem olarak sakla (Q1=01, Q2=04, Q3=07, Q4=10)
    const m = d.getMonth() + 1;
    const qStartMonth = m <= 3 ? 1 : m <= 6 ? 4 : m <= 9 ? 7 : 10;
    return `${d.getFullYear()}-${String(qStartMonth).padStart(2, '0')}`;
  });

  // Donem'den yıl ve çeyrek numarası türet
  const [yStr, mStr] = donem.split('-');
  const yil = Number(yStr);
  const ayBaslangic = Number(mStr);
  const ceyrek = ayBaslangic <= 3 ? 1 : ayBaslangic <= 6 ? 2 : ayBaslangic <= 9 ? 3 : 4;
  const CEYREK_LABELS: Record<number, string> = {
    1: 'I. Çeyrek (Ocak – Mart)',
    2: 'II. Çeyrek (Nisan – Haziran)',
    3: 'III. Çeyrek (Temmuz – Eylül)',
    4: 'IV. Çeyrek (Ekim – Aralık)',
  };
  const CEYREK_BASLANGIC: Record<number, string> = {
    1: '01', 2: '04', 3: '07', 4: '10',
  };
  const setDonemFromQuarter = (yeniYil: number, yeniCeyrek: number) => {
    setDonem(`${yeniYil}-${CEYREK_BASLANGIC[yeniCeyrek]}`);
  };
  const [search, setSearch] = useState('');
  type FiltreDurum = 'tumu' | 'eksigeldi' | 'hepsigeldi' | 'islenmedi' | 'hepsiislendi' | 'hesapsiz';
  const [filterDurum, setFilterDurum] = useState<FiltreDurum>('tumu');
  const [hesapModalFor, setHesapModalFor] = useState<BankaTakipItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['banka-takip', donem],
    queryFn: () => bankaTakipApi.list(donem),
    refetchInterval: 30000,
  });

  const ekstreMut = useMutation({
    mutationFn: (body: Parameters<typeof bankaTakipApi.upsertEkstre>[0]) =>
      bankaTakipApi.upsertEkstre(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banka-takip', donem] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Hata'),
  });

  const eksikGorevMut = useMutation({
    mutationFn: () => bankaTakipApi.createEksikEkstreTasks(donem),
    onSuccess: (r) => {
      toast.success(`${r.count || 0} banka takip görevi oluşturuldu`);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Görev oluşturulamadı'),
  });

  const bulkEkstreMut = useMutation({
    mutationFn: async ({ item, action }: { item: BankaTakipItem; action: 'geldi' | 'islendi' }) => {
      await Promise.all(item.hesaplar.map((h) => bankaTakipApi.upsertEkstre({
        taxpayerId: item.taxpayer.id,
        bankaHesapId: h.bankaHesap.id,
        donem,
        ekstreGeldi: true,
        ekstreIslendi: action === 'islendi' ? true : undefined,
      })));
    },
    onSuccess: () => {
      toast.success('Banka takip durumu güncellendi');
      qc.invalidateQueries({ queryKey: ['banka-takip', donem] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Toplu işlem yapılamadı'),
  });

  const filtered = useMemo(() => {
    let items = data?.items || [];
    // 1) Durum filtresi
    if (filterDurum !== 'tumu') {
      items = items.filter((x) => {
        switch (filterDurum) {
          case 'eksigeldi':
            // Tüm hesapları gelmemiş veya bir kısmı eksik
            return x.ozet.hesapSayisi > 0 && x.ozet.eksikGeldi > 0;
          case 'hepsigeldi':
            return x.ozet.hesapSayisi > 0 && x.ozet.tumGeldi;
          case 'islenmedi':
            // Geldi ama henüz işlenmedi
            return x.ozet.hesapSayisi > 0 && x.ozet.tumGeldi && !x.ozet.tumIslendi;
          case 'hepsiislendi':
            return x.ozet.hesapSayisi > 0 && x.ozet.tumIslendi;
          case 'hesapsiz':
            return x.ozet.hesapSayisi === 0;
          default:
            return true;
        }
      });
    }
    // 2) Arama
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((x) =>
      taxpayerName(x.taxpayer).toLowerCase().includes(q) ||
      x.taxpayer.taxNumber?.includes(q) ||
      x.hesaplar.some((h) => h.bankaHesap.bankaAdi.toLowerCase().includes(q)),
    );
  }, [data?.items, search, filterDurum]);

  // Özet sayaçları
  const ozet = useMemo(() => {
    const items = data?.items || [];
    const total = items.length;
    const tumGelmis = items.filter((x) => x.ozet.tumGeldi).length;
    const tumIslenmis = items.filter((x) => x.ozet.tumIslendi).length;
    const islenmedi = items.filter((x) => x.ozet.hesapSayisi > 0 && x.ozet.tumGeldi && !x.ozet.tumIslendi).length;
    const hicbiriGelmemis = items.filter((x) => x.ozet.eksikGeldi === x.ozet.hesapSayisi && x.ozet.hesapSayisi > 0).length;
    const hesapsiz = items.filter((x) => x.ozet.hesapSayisi === 0).length;
    return { total, tumGelmis, tumIslenmis, islenmedi, hicbiriGelmemis, hesapsiz };
  }, [data?.items]);

  const completion = ozet.total ? Math.round((ozet.tumIslenmis / ozet.total) * 100) : 0;
  const queueCards: Array<{ key: FiltreDurum; label: string; count: number; hint: string; color: string }> = [
    { key: 'eksigeldi', label: 'Eksik Ekstre', count: Math.max(ozet.total - ozet.tumGelmis - ozet.hesapsiz, 0), hint: 'Mükelleften istenecek banka ekstreleri', color: '#fbbf24' },
    { key: 'islenmedi', label: 'İşlenecek', count: ozet.islenmedi, hint: 'Ekstre geldi, muhasebe işlemi bekliyor', color: '#60a5fa' },
    { key: 'hepsiislendi', label: 'Tamamlanan', count: ozet.tumIslenmis, hint: 'Dönem için kapatılmış mükellefler', color: '#22c55e' },
    { key: 'hesapsiz', label: 'Hesapsız', count: ozet.hesapsiz, hint: 'Önce banka hesabı tanımlanmalı', color: '#94a3b8' },
  ];

  return (
    <div className="space-y-4 max-w-none">
      {/* HEADER */}
      <div className="flex items-end justify-between gap-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
              <Landmark size={10} className="inline mr-1" /> Mükellef Banka Takip
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.1 }}>
            Banka Ekstre Takibi
          </h1>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Bilanço esasında mükelleflerin banka hesapları ve 3 aylık dönem ekstre durumu
          </p>
        </div>

        {/* Dönem seçici — 3 aylık çeyrek */}
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase font-semibold tracking-wider mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <Calendar size={10} className="inline mr-1" /> Yıl
            </label>
            <select
              value={yil}
              onChange={(e) => setDonemFromQuarter(Number(e.target.value), ceyrek)}
              className="px-3 py-2 rounded-lg text-sm font-semibold border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
            >
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-semibold tracking-wider mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Çeyrek
            </label>
            <select
              value={ceyrek}
              onChange={(e) => setDonemFromQuarter(yil, Number(e.target.value))}
              className="px-3 py-2 rounded-lg text-sm font-semibold border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9', minWidth: 220 }}
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>{CEYREK_LABELS[q]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ÖZET KPI'LAR — tıklanabilir filtre kısayolları */}
      <div className="rounded-2xl p-4 border" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.10), rgba(255,255,255,0.02))', borderColor: 'rgba(212,184,118,0.20)' }}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: 'rgba(212,184,118,0.8)' }}>
              <Layers3 size={13} /> Dönem Kapatma Panosu
            </div>
            <div className="mt-2 flex items-end gap-3">
              <div className="text-4xl font-bold tabular-nums" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>%{completion}</div>
              <div className="pb-1 text-[12px]" style={{ color: 'rgba(250,250,249,0.56)' }}>
                {ozet.tumIslenmis} / {ozet.total} mükellefin banka dönemi kapandı
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full" style={{ width: `${completion}%`, background: 'linear-gradient(90deg, #d4b876, #22c55e)' }} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => eksikGorevMut.mutate()}
            disabled={eksikGorevMut.isPending}
            className="px-4 py-2.5 rounded-lg text-[12.5px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'rgba(251,191,36,0.14)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.34)' }}
          >
            {eksikGorevMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
            Eksikler İçin Görev Aç
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {queueCards.map((q) => {
          const active = filterDurum === q.key;
          return (
            <button
              key={q.key}
              type="button"
              onClick={() => setFilterDurum(active ? 'tumu' : q.key)}
              className="rounded-xl p-3 text-left transition hover:brightness-110"
              style={{
                background: active ? `${q.color}18` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${active ? `${q.color}66` : 'rgba(255,255,255,0.06)'}`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: q.color }}>{q.label}</span>
                <ArrowRight size={13} style={{ color: active ? q.color : 'rgba(250,250,249,0.25)' }} />
              </div>
              <div className="text-2xl font-bold mt-1 tabular-nums" style={{ color: '#fafaf9' }}>{q.count}</div>
              <div className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>{q.hint}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <KpiCard label="Toplam Mükellef" value={ozet.total} color="#fafaf9" active={filterDurum === 'tumu'} onClick={() => setFilterDurum('tumu')} />
        <KpiCard label="Tüm Ekstreler Geldi" value={ozet.tumGelmis} color="#22c55e" active={filterDurum === 'hepsigeldi'} onClick={() => setFilterDurum('hepsigeldi')} />
        <KpiCard label="Hepsi İşlendi" value={ozet.tumIslenmis} color="#4ade80" active={filterDurum === 'hepsiislendi'} onClick={() => setFilterDurum('hepsiislendi')} />
        <KpiCard label="İşlenecek" value={ozet.islenmedi} color="#60a5fa" active={filterDurum === 'islenmedi'} onClick={() => setFilterDurum('islenmedi')} />
        <KpiCard label="Eksik / Beklenen" value={ozet.total - ozet.tumGelmis - ozet.hesapsiz} color="#fbbf24" active={filterDurum === 'eksigeldi'} onClick={() => setFilterDurum('eksigeldi')} />
        <KpiCard label="Banka Hesabı Yok" value={ozet.hesapsiz} color="#94a3b8" active={filterDurum === 'hesapsiz'} onClick={() => setFilterDurum('hesapsiz')} />
      </div>

      {/* ARAMA + FİLTRE */}
      <div className="sticky top-0 z-10 flex items-center gap-2 flex-wrap rounded-2xl p-3 border backdrop-blur" style={{ background: 'rgba(15,13,11,0.86)', borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            placeholder="Mükellef adı, VKN veya banka adı ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-md text-sm"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        <select
          value={filterDurum}
          onChange={(e) => setFilterDurum(e.target.value as FiltreDurum)}
          className="px-3 py-2 rounded-md text-sm font-medium"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', minWidth: 220 }}
        >
          <option value="tumu">Tüm Durumlar</option>
          <option value="eksigeldi">⚠ Ekstresi Eksik (gelmedi)</option>
          <option value="hepsigeldi">📥 Hepsi Geldi</option>
          <option value="islenmedi">⏳ Geldi ama İşlenmedi</option>
          <option value="hepsiislendi">✓ Hepsi İşlendi</option>
          <option value="hesapsiz">∅ Banka Hesabı Yok</option>
        </select>
        {filterDurum !== 'tumu' && (
          <button
            onClick={() => setFilterDurum('tumu')}
            className="text-[12px] inline-flex items-center gap-1 px-2 py-1 rounded"
            style={{ color: '#fbbf24', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)' }}
          >
            <X size={11} /> Filtreyi Kaldır
          </button>
        )}
        <span className="text-[11.5px] ml-auto" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {filtered.length} mükellef gösteriliyor
        </span>
      </div>

      {/* ANA LİSTE */}
      {isLoading && (
        <div className="rounded-xl border border-white/10 p-12 text-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <Loader2 size={28} className="mx-auto animate-spin" style={{ color: GOLD }} />
          <div className="text-sm mt-3" style={{ color: 'rgba(250,250,249,0.45)' }}>Yükleniyor…</div>
        </div>
      )}

      {isError && (
        <div className="rounded-xl border p-6 flex items-start gap-3" style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }}>
          <AlertCircle size={18} style={{ color: '#ef4444' }} />
          <div>
            <div style={{ color: '#fafaf9', fontWeight: 600 }}>Liste yüklenemedi</div>
            <div className="text-sm mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
              Sunucu yanıt vermedi. Bir kaç saniye sonra tekrar dene.
            </div>
          </div>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-xl border border-white/10 p-12 text-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <Landmark size={32} className="mx-auto mb-3" style={{ color: 'rgba(250,250,249,0.2)' }} />
          <div style={{ color: '#fafaf9', fontWeight: 600 }}>
            {(data?.items.length || 0) === 0 ? 'Bilanço esasında mükellef yok' : 'Aramaya uygun sonuç yok'}
          </div>
          <div className="text-sm mt-2" style={{ color: 'rgba(250,250,249,0.45)' }}>
            {(data?.items.length || 0) === 0
              ? 'Mükellef kartında "Defter Türü" alanını "BILANCO" olarak işaretle.'
              : 'Farklı bir terim dene veya filtreyi temizle.'}
          </div>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((item) => (
            <MukellefRow
              key={item.taxpayer.id}
              item={item}
              donem={donem}
              onToggleEkstre={(bankaHesapId, ekstreGeldi, ekstreIslendi) => {
                ekstreMut.mutate({
                  taxpayerId: item.taxpayer.id,
                  bankaHesapId,
                  donem,
                  ekstreGeldi,
                  ekstreIslendi,
                });
              }}
              onManageHesaplar={() => setHesapModalFor(item)}
              onBulk={(action) => bulkEkstreMut.mutate({ item, action })}
              isPending={ekstreMut.isPending}
            />
          ))}
        </div>
      )}

      {/* HESAP YÖNETİM MODALI */}
      {hesapModalFor && (
        <BankaHesapModal
          item={hesapModalFor}
          onClose={() => setHesapModalFor(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['banka-takip', donem] })}
        />
      )}
    </div>
  );
}

// ===== KPI CARD =====
function KpiCard({
  label, value, color, active, onClick,
}: {
  label: string;
  value: number;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="rounded-lg p-3 text-left transition-all hover:brightness-125"
      style={{
        background: active ? color + '15' : 'rgba(255,255,255,0.02)',
        border: active ? `1px solid ${color}66` : '1px solid rgba(255,255,255,0.05)',
        boxShadow: active ? `0 2px 12px ${color}20` : 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
        {label}
      </div>
      <div className="text-2xl font-bold mt-0.5 tabular-nums" style={{ color }}>
        {value}
      </div>
    </button>
  );
}

// ===== MÜKELLEF SATIRI =====
function MukellefRow({
  item,
  donem,
  onToggleEkstre,
  onManageHesaplar,
  onBulk,
  isPending,
}: {
  item: BankaTakipItem;
  donem: string;
  onToggleEkstre: (bankaHesapId: string, ekstreGeldi: boolean | undefined, ekstreIslendi: boolean | undefined) => void;
  onManageHesaplar: () => void;
  onBulk: (action: 'geldi' | 'islendi') => void;
  isPending: boolean;
}) {
  const ad = taxpayerName(item.taxpayer);
  const tumGelmis = item.ozet.tumGeldi;
  const tumIslenmis = item.ozet.tumIslendi;
  const hicHesap = item.ozet.hesapSayisi === 0;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: tumIslenmis
          ? '1px solid rgba(34,197,94,0.25)'
          : tumGelmis
          ? '1px solid rgba(212,184,118,0.25)'
          : '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Üst başlık */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <Building2 size={16} style={{ color: GOLD, flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ color: '#fafaf9' }}>{ad}</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
            VKN/TCKN: {item.taxpayer.taxNumber} · {item.ozet.hesapSayisi} hesap
          </div>
        </div>

        {/* Özet rozetleri */}
        <div className="flex items-center gap-1.5">
          {tumIslenmis && (
            <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: 'rgba(34,197,94,0.18)', color: '#22c55e' }}>
              ✓ TÜMÜ İŞLENDİ
            </span>
          )}
          {!tumIslenmis && tumGelmis && (
            <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: 'rgba(212,184,118,0.18)', color: GOLD }}>
              EKSTRELER GELDİ
            </span>
          )}
          {!tumGelmis && item.ozet.eksikGeldi > 0 && (
            <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.18)', color: '#fbbf24' }}>
              {item.ozet.eksikGeldi} EKSİK
            </span>
          )}
        </div>

        <button
          onClick={onManageHesaplar}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded inline-flex items-center gap-1"
          style={{ background: 'rgba(184,160,111,0.1)', color: GOLD, border: '1px solid rgba(184,160,111,0.25)' }}
          title="Banka hesaplarını yönet"
        >
          <Edit2 size={11} /> Hesaplar
        </button>
      </div>

      {/* Hesap satırları */}
      {!hicHesap && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.012)' }}>
          <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.48)' }}>Hızlı aksiyon:</span>
          <button
            type="button"
            onClick={() => onBulk('geldi')}
            disabled={isPending}
            className="px-2.5 py-1.5 rounded-md text-[11px] font-bold disabled:opacity-50"
            style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.28)' }}
          >
            Tüm Ekstreler Geldi
          </button>
          <button
            type="button"
            onClick={() => onBulk('islendi')}
            disabled={isPending}
            className="px-2.5 py-1.5 rounded-md text-[11px] font-bold disabled:opacity-50"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.28)' }}
          >
            Tümünü İşlendi Yap
          </button>
        </div>
      )}

      {hicHesap ? (
        <div className="px-4 py-3 text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
          Bu mükellefe henüz banka hesabı tanımlanmamış. Sağdaki "Hesaplar" butonu ile ekleyin.
        </div>
      ) : (
        <div>
          {item.hesaplar.map((h) => (
            <HesapRow
              key={h.bankaHesap.id}
              hesap={h}
              isPending={isPending}
              onToggle={(geldi, islendi) => onToggleEkstre(h.bankaHesap.id, geldi, islendi)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ===== HESAP SATIRI =====
function HesapRow({
  hesap,
  isPending,
  onToggle,
}: {
  hesap: BankaTakipItem['hesaplar'][number];
  isPending: boolean;
  onToggle: (geldi: boolean | undefined, islendi: boolean | undefined) => void;
}) {
  const bh = hesap.bankaHesap;
  return (
    <div
      className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5"
      style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}
    >
      <div className="min-w-0">
        <div className="font-medium text-[13px] truncate" style={{ color: '#fafaf9' }}>
          {bh.bankaAdi}
          {bh.paraBirimi !== 'TRY' && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(168,85,247,0.15)', color: '#a78bfa' }}>
              {bh.paraBirimi}
            </span>
          )}
        </div>
        <div className="text-[11px] mt-0.5 truncate font-mono" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {bh.iban || bh.hesapNo || (bh.sube ? `Şube: ${bh.sube}` : '—')}
          {bh.aciklama && <span className="ml-2" style={{ color: 'rgba(250,250,249,0.35)' }}>· {bh.aciklama}</span>}
        </div>
      </div>

      {/* Ekstre Geldi toggle — pembe sabit kategori */}
      <ToggleButton
        label="Ekstre Geldi"
        checked={hesap.ekstreGeldi}
        tarih={hesap.geldiTarihi}
        kategoriColor="#f43f5e"
        disabled={isPending}
        onClick={() => onToggle(!hesap.ekstreGeldi, undefined)}
      />

      {/* Ekstre İşlendi toggle — yeşil sabit kategori */}
      <ToggleButton
        label="İşlendi"
        checked={hesap.ekstreIslendi}
        tarih={hesap.islenmeTarihi}
        kategoriColor="#22c55e"
        disabled={isPending || !hesap.ekstreGeldi}
        onClick={() => onToggle(undefined, !hesap.ekstreIslendi)}
        hint={!hesap.ekstreGeldi ? 'Önce ekstrenin geldiğini işaretle' : undefined}
      />
    </div>
  );
}

// ===== TOGGLE BUTONU =====
// Renk sabit kategoriyi temsil eder (Ekstre Geldi → pembe, İşlendi → yeşil).
// Checked: solid dolgu + beyaz yazı + ✓
// Unchecked: ince border + soluk zemin + ✗ (ama kategori rengi her zaman görünür)
function ToggleButton({
  label,
  checked,
  tarih,
  kategoriColor,
  onClick,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  tarih?: string | null;
  kategoriColor: string;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint || (tarih ? `${label}: ${new Date(tarih).toLocaleString('tr-TR')}` : label)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold disabled:opacity-50 transition-all hover:brightness-110"
      style={{
        background: checked ? kategoriColor : kategoriColor + '18',
        color: checked ? '#fff' : kategoriColor,
        border: `1px solid ${kategoriColor}${checked ? 'ff' : '55'}`,
        minWidth: 120,
        justifyContent: 'center',
        boxShadow: checked ? `0 2px 8px ${kategoriColor}40` : 'none',
      }}
    >
      {checked ? <Check size={12} /> : <X size={12} />}
      {label}
    </button>
  );
}

// ===== BANKA HESABI YÖNETİM MODALI =====
function BankaHesapModal({
  item,
  onClose,
  onChanged,
}: {
  item: BankaTakipItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [bankaAdi, setBankaAdi] = useState('');
  const [iban, setIban] = useState('');
  const [hesapNo, setHesapNo] = useState('');
  const [aciklama, setAciklama] = useState('');

  const { data: hesaplar = [], refetch } = useQuery({
    queryKey: ['banka-hesaplar', item.taxpayer.id],
    queryFn: () => bankaTakipApi.hesaplar(item.taxpayer.id),
  });

  const createMut = useMutation({
    mutationFn: () =>
      bankaTakipApi.createHesap({
        taxpayerId: item.taxpayer.id,
        bankaAdi: bankaAdi.trim(),
        iban: iban.trim() || undefined,
        hesapNo: hesapNo.trim() || undefined,
        aciklama: aciklama.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Banka hesabı eklendi');
      setBankaAdi(''); setIban(''); setHesapNo(''); setAciklama('');
      refetch();
      onChanged();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => bankaTakipApi.deleteHesap(id),
    onSuccess: () => {
      toast.success('Hesap silindi');
      refetch();
      onChanged();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        style={{ background: '#12100c', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Banka Hesapları
            </div>
            <div className="font-semibold mt-0.5" style={{ color: '#fafaf9' }}>{taxpayerName(item.taxpayer)}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/5"
            style={{ color: 'rgba(250,250,249,0.55)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Mevcut hesaplar */}
        <div className="p-5 space-y-2">
          <div className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Mevcut Hesaplar ({hesaplar.length})
          </div>
          {hesaplar.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
              Henüz banka hesabı eklenmemiş.
            </div>
          ) : (
            <div className="space-y-1.5">
              {hesaplar.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-md"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <Landmark size={14} style={{ color: GOLD, flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[13px]" style={{ color: '#fafaf9' }}>{h.bankaAdi}</div>
                    <div className="text-[11px] truncate font-mono" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      {h.iban || h.hesapNo || '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`"${h.bankaAdi}" hesabını silmek istediğine emin misin?`)) {
                        deleteMut.mutate(h.id);
                      }
                    }}
                    disabled={deleteMut.isPending}
                    className="p-1.5 rounded disabled:opacity-50"
                    style={{ background: 'rgba(244,63,94,0.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)' }}
                    title="Sil"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Yeni hesap formu */}
        <div className="px-5 pb-5 space-y-3">
          <div className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Yeni Hesap Ekle
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Banka adı (zorunlu) — örn. Ziraat Bankası"
              value={bankaAdi}
              onChange={(e) => setBankaAdi(e.target.value)}
              className="px-3 py-2 rounded text-sm col-span-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' }}
            />
            <input
              placeholder="IBAN (TR...)"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              className="px-3 py-2 rounded text-sm font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' }}
            />
            <input
              placeholder="Hesap No (opsiyonel)"
              value={hesapNo}
              onChange={(e) => setHesapNo(e.target.value)}
              className="px-3 py-2 rounded text-sm"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' }}
            />
            <input
              placeholder="Açıklama / Not (opsiyonel)"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              className="px-3 py-2 rounded text-sm col-span-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' }}
            />
          </div>
          <button
            onClick={() => createMut.mutate()}
            disabled={!bankaAdi.trim() || createMut.isPending}
            className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
            style={{
              background: bankaAdi.trim() ? 'linear-gradient(135deg, #b8a06f, #8b7649)' : 'rgba(255,255,255,0.05)',
              color: bankaAdi.trim() ? '#0f0d0b' : 'rgba(250,250,249,0.45)',
            }}
          >
            {createMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <Plus size={14} className="inline mr-1" />}
            Hesap Ekle
          </button>
        </div>
      </div>
    </div>
  );
}
