'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Edit3,
  Inbox,
  Landmark,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { bankaTakipApi, BankaTakipItem, BankaHesap } from '@/lib/banka-takip';

// ============================================================
// TEMA
// ============================================================

const GOLD = '#d4b876';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const SUBTLE = 'rgba(250,250,249,0.40)';
const LINE = 'rgba(212,184,118,0.10)';
const CARD = 'rgba(28,22,18,0.85)';
const CARD_HOVER = 'rgba(40,32,26,0.92)';
const SOFT = 'rgba(255,255,255,0.04)';



// Durum renkleri
const TONES = {
  amber:  { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bd: 'rgba(251,191,36,0.32)' },
  blue:   { fg: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  bd: 'rgba(96,165,250,0.32)' },
  green:  { fg: '#4ade80', bg: 'rgba(74,222,128,0.10)',  bd: 'rgba(74,222,128,0.32)' },
  gray:   { fg: '#94a3b8', bg: 'rgba(148,163,184,0.08)', bd: 'rgba(148,163,184,0.28)' },
  red:    { fg: '#f87171', bg: 'rgba(248,113,113,0.10)', bd: 'rgba(248,113,113,0.32)' },
  gold:   { fg: GOLD,      bg: 'rgba(212,184,118,0.10)', bd: 'rgba(212,184,118,0.32)' },
};

// ============================================================
// YARDIMCILAR
// ============================================================

function taxpayerName(t: BankaTakipItem['taxpayer']): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

const CEYREK_LABELS: Record<number, string> = {
  1: 'I. Çeyrek (Oca–Mar)',
  2: 'II. Çeyrek (Nis–Haz)',
  3: 'III. Çeyrek (Tem–Eyl)',
  4: 'IV. Çeyrek (Eki–Ara)',
};
const CEYREK_BASLANGIC: Record<number, string> = { 1: '01', 2: '04', 3: '07', 4: '10' };

type FiltreDurum = 'tumu' | 'eksigeldi' | 'islenmedi' | 'hepsiislendi' | 'hesapsiz';

// ============================================================
// ANA SAYFA
// ============================================================

export default function BankaTakipPage() {
  const qc = useQueryClient();
  const [donem, setDonem] = useState(() => {
    const d = new Date();
    const m = d.getMonth() + 1;
    const qStart = m <= 3 ? 1 : m <= 6 ? 4 : m <= 9 ? 7 : 10;
    return `${d.getFullYear()}-${String(qStart).padStart(2, '0')}`;
  });

  const [yStr, mStr] = donem.split('-');
  const yil = Number(yStr);
  const ayBaslangic = Number(mStr);
  const ceyrek = ayBaslangic <= 3 ? 1 : ayBaslangic <= 6 ? 2 : ayBaslangic <= 9 ? 3 : 4;

  const setDonemFromQuarter = (yeniYil: number, yeniCeyrek: number) => {
    setDonem(`${yeniYil}-${CEYREK_BASLANGIC[yeniCeyrek]}`);
  };

  const [search, setSearch] = useState('');
  const [filterDurum, setFilterDurum] = useState<FiltreDurum>('tumu');
  const [hesapModalFor, setHesapModalFor] = useState<BankaTakipItem | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((s) => {
      const ns = new Set(s);
      ns.has(id) ? ns.delete(id) : ns.add(id);
      return ns;
    });
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['banka-takip', donem],
    queryFn: () => bankaTakipApi.list(donem),
    refetchInterval: 30000,
  });

  const ekstreMut = useMutation({
    mutationFn: (body: Parameters<typeof bankaTakipApi.upsertEkstre>[0]) =>
      bankaTakipApi.upsertEkstre(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banka-takip', donem] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  const eksikGorevMut = useMutation({
    mutationFn: () => bankaTakipApi.createEksikEkstreTasks(donem),
    onSuccess: (r) => {
      toast.success(`${r.count || 0} banka takip görevi oluşturuldu`);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Görev oluşturulamadı'),
  });

  const bulkEkstreMut = useMutation({
    mutationFn: async ({ item, action }: { item: BankaTakipItem; action: 'geldi' | 'islendi' }) => {
      await Promise.all(
        item.hesaplar.map((h) =>
          bankaTakipApi.upsertEkstre({
            taxpayerId: item.taxpayer.id,
            bankaHesapId: h.bankaHesap.id,
            donem,
            ekstreGeldi: true,
            ekstreIslendi: action === 'islendi' ? true : undefined,
          }),
        ),
      );
    },
    onSuccess: () => {
      toast.success('Güncellendi');
      qc.invalidateQueries({ queryKey: ['banka-takip', donem] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Toplu işlem yapılamadı'),
  });

  // ÖZET
  const ozet = useMemo(() => {
    const items = data?.items || [];
    return {
      total: items.length,
      eksikGeldi: items.filter((x) => x.ozet.hesapSayisi > 0 && x.ozet.eksikGeldi > 0).length,
      islenmedi: items.filter((x) => x.ozet.hesapSayisi > 0 && x.ozet.tumGeldi && !x.ozet.tumIslendi).length,
      tumIslenmis: items.filter((x) => x.ozet.hesapSayisi > 0 && x.ozet.tumIslendi).length,
      hesapsiz: items.filter((x) => x.ozet.hesapSayisi === 0).length,
    };
  }, [data?.items]);

  const completion = ozet.total ? Math.round((ozet.tumIslenmis / ozet.total) * 100) : 0;

  // FİLTRELEME
  const filtered = useMemo(() => {
    let items = data?.items || [];
    if (filterDurum !== 'tumu') {
      items = items.filter((x) => {
        switch (filterDurum) {
          case 'eksigeldi':
            return x.ozet.hesapSayisi > 0 && x.ozet.eksikGeldi > 0;
          case 'islenmedi':
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
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (x) =>
        taxpayerName(x.taxpayer).toLowerCase().includes(q) ||
        x.taxpayer.taxNumber?.includes(q) ||
        x.hesaplar.some((h) => h.bankaHesap.bankaAdi.toLowerCase().includes(q)),
    );
  }, [data?.items, search, filterDurum]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
        {/* HEADER */}
        <Header
          yil={yil}
          ceyrek={ceyrek}
          onChange={setDonemFromQuarter}
          completion={completion}
          done={ozet.tumIslenmis}
          total={ozet.total}
          onCreateTasks={() => eksikGorevMut.mutate()}
          taskBusy={eksikGorevMut.isPending}
        />

        {/* STATUS STRIP */}
        <StatusStrip ozet={ozet} active={filterDurum} onPick={setFilterDurum} />

        {/* SEARCH */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
             style={{ borderColor: LINE, background: CARD }}>
          <div className="relative flex-1 min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: SUBTLE }} />
            <input
              placeholder="Mükellef, VKN veya banka adı ara…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent pl-9 pr-3 py-1.5 text-[13px] outline-none"
              style={{ color: TEXT }}
            />
          </div>
          {filterDurum !== 'tumu' && (
            <button
              onClick={() => setFilterDurum('tumu')}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
              style={{ borderColor: TONES.amber.bd, color: TONES.amber.fg, background: TONES.amber.bg }}
            >
              <X size={11} /> Filtre temiz
            </button>
          )}
          <span className="ml-auto text-[11.5px]" style={{ color: MUTED }}>
            {filtered.length} mükellef
          </span>
        </div>

        {/* LIST */}
        {isLoading && (
          <div className="rounded-xl border p-12 text-center" style={{ borderColor: LINE, background: CARD }}>
            <Loader2 size={26} className="mx-auto animate-spin" style={{ color: GOLD }} />
            <div className="mt-3 text-[13px]" style={{ color: MUTED }}>Yükleniyor…</div>
          </div>
        )}

        {isError && (
          <div className="rounded-xl border p-5 flex items-start gap-3"
               style={{ borderColor: TONES.red.bd, background: TONES.red.bg }}>
            <AlertCircle size={18} style={{ color: TONES.red.fg }} />
            <div>
              <div className="font-semibold" style={{ color: TEXT }}>Liste yüklenemedi</div>
              <div className="text-[12.5px] mt-1" style={{ color: MUTED }}>Sunucu yanıt vermedi.</div>
            </div>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="rounded-xl border p-12 text-center" style={{ borderColor: LINE, background: CARD }}>
            <Inbox size={28} className="mx-auto mb-3" style={{ color: SUBTLE }} />
            <div className="font-semibold" style={{ color: TEXT }}>
              {(data?.items.length || 0) === 0 ? 'Bilanço esasında mükellef yok' : 'Aramaya uygun sonuç yok'}
            </div>
            <div className="mt-1.5 text-[12.5px]" style={{ color: MUTED }}>
              {(data?.items.length || 0) === 0
                ? 'Mükellef kartında "Defter Türü" alanını "BILANCO" olarak işaretle.'
                : 'Farklı bir terim dene veya filtreyi temizle.'}
            </div>
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="space-y-1.5">
            {filtered.map((item) => (
              <MukellefRow
                key={item.taxpayer.id}
                item={item}
                donem={donem}
                expanded={expandedIds.has(item.taxpayer.id)}
                onToggleExpand={() => toggleExpand(item.taxpayer.id)}
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
                isPending={ekstreMut.isPending || bulkEkstreMut.isPending}
              />
            ))}
          </div>
        )}

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

// ============================================================
// HEADER
// ============================================================

function Header({
  yil,
  ceyrek,
  onChange,
  completion,
  done,
  total,
  onCreateTasks,
  taskBusy,
}: {
  yil: number;
  ceyrek: number;
  onChange: (y: number, q: number) => void;
  completion: number;
  done: number;
  total: number;
  onCreateTasks: () => void;
  taskBusy: boolean;
}) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: LINE, background: CARD }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]"
               style={{ color: GOLD }}>
            <Landmark size={11} /> Banka Ekstre Takibi
          </div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-tight"
              style={{ color: TEXT, fontFamily: 'Fraunces, serif' }}>
            {CEYREK_LABELS[ceyrek]} · {yil}
          </h1>
          <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
            Bilanço esasındaki mükellefler için 3 aylık banka ekstre kontrolü
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <SelectField label="Yıl" value={String(yil)} onChange={(v) => onChange(Number(v), ceyrek)}>
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </SelectField>
          <SelectField label="Çeyrek" value={String(ceyrek)} onChange={(v) => onChange(yil, Number(v))} minWidth={170}>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>{CEYREK_LABELS[q]}</option>
            ))}
          </SelectField>
          <button
            type="button"
            onClick={onCreateTasks}
            disabled={taskBusy}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-md border px-3 text-[12px] font-bold disabled:opacity-50"
            style={{ borderColor: TONES.amber.bd, color: TONES.amber.fg, background: TONES.amber.bg }}
          >
            {taskBusy ? <Loader2 size={13} className="animate-spin" /> : <ClipboardList size={13} />}
            Eksikler için görev aç
          </button>
        </div>
      </div>

      {/* Completion progress */}
      <div className="mt-4 flex items-center gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>
          Dönem tamamlanma
        </div>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full transition-all"
            style={{ width: `${completion}%`, background: `linear-gradient(90deg, ${GOLD}, ${TONES.green.fg})` }}
          />
        </div>
        <div className="text-[13px] font-semibold tabular-nums" style={{ color: TEXT }}>
          %{completion} <span style={{ color: MUTED, fontWeight: 400 }}>· {done}/{total}</span>
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
  minWidth = 90,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>
        <Calendar size={10} className="inline mr-1" /> {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[34px] rounded-md border bg-transparent px-2.5 text-[12.5px] font-medium outline-none"
        style={{ borderColor: LINE, color: TEXT, background: SOFT, minWidth }}
      >
        {children}
      </select>
    </div>
  );
}

// ============================================================
// STATUS STRIP — 4 pill, tıklanabilir
// ============================================================

function StatusStrip({
  ozet,
  active,
  onPick,
}: {
  ozet: { total: number; eksikGeldi: number; islenmedi: number; tumIslenmis: number; hesapsiz: number };
  active: FiltreDurum;
  onPick: (f: FiltreDurum) => void;
}) {
  const pills: Array<{ key: FiltreDurum; label: string; count: number; tone: keyof typeof TONES; hint: string }> = [
    { key: 'eksigeldi',   label: 'Eksik Ekstre', count: ozet.eksikGeldi,   tone: 'amber', hint: 'Mükelleften istenecek' },
    { key: 'islenmedi',   label: 'İşlenecek',    count: ozet.islenmedi,    tone: 'blue',  hint: 'Geldi, muhasebe bekliyor' },
    { key: 'hepsiislendi',label: 'Tamamlanan',   count: ozet.tumIslenmis,  tone: 'green', hint: 'Dönem kapatıldı' },
    { key: 'hesapsiz',    label: 'Hesapsız',     count: ozet.hesapsiz,     tone: 'gray',  hint: 'Hesap tanımlanmamış' },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {pills.map((p) => {
        const isActive = active === p.key;
        const t = TONES[p.tone];
        return (
          <button
            key={p.key}
            onClick={() => onPick(isActive ? 'tumu' : p.key)}
            className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
            style={{
              borderColor: isActive ? t.bd : LINE,
              background: isActive ? t.bg : CARD,
            }}
            onMouseEnter={(e) => !isActive && (e.currentTarget.style.background = CARD_HOVER)}
            onMouseLeave={(e) => !isActive && (e.currentTarget.style.background = CARD)}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border tabular-nums text-[14px] font-bold"
              style={{ borderColor: t.bd, background: t.bg, color: t.fg }}
            >
              {p.count}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold" style={{ color: TEXT }}>{p.label}</div>
              <div className="text-[11px]" style={{ color: MUTED }}>{p.hint}</div>
            </div>
            {isActive && <Check size={14} style={{ color: t.fg }} />}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// MÜKELLEF SATIRI — accordion
// ============================================================

function MukellefRow({
  item,
  donem,
  expanded,
  onToggleExpand,
  onToggleEkstre,
  onManageHesaplar,
  onBulk,
  isPending,
}: {
  item: BankaTakipItem;
  donem: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEkstre: (bankaHesapId: string, ekstreGeldi?: boolean, ekstreIslendi?: boolean) => void;
  onManageHesaplar: () => void;
  onBulk: (action: 'geldi' | 'islendi') => void;
  isPending: boolean;
}) {
  const ad = taxpayerName(item.taxpayer);
  const { tumGeldi, tumIslendi, eksikGeldi, hesapSayisi } = item.ozet;
  const hicHesap = hesapSayisi === 0;

  // Sol kenardaki durum çubuğu rengi
  let edge = TONES.gray.fg;
  if (tumIslendi) edge = TONES.green.fg;
  else if (tumGeldi) edge = GOLD;
  else if (eksikGeldi > 0) edge = TONES.amber.fg;

  // Sağdaki durum rozeti
  let statusBadge: { label: string; tone: keyof typeof TONES } = { label: 'Bekliyor', tone: 'gray' };
  if (hicHesap) statusBadge = { label: 'Hesap yok', tone: 'gray' };
  else if (tumIslendi) statusBadge = { label: 'İşlendi', tone: 'green' };
  else if (tumGeldi) statusBadge = { label: 'Ekstreler geldi', tone: 'gold' };
  else if (eksikGeldi > 0) statusBadge = { label: `${eksikGeldi} eksik`, tone: 'amber' };

  return (
    <div
      className="rounded-xl border overflow-hidden transition"
      style={{
        borderColor: LINE,
        background: CARD,
        borderLeftWidth: 3,
        borderLeftColor: edge,
      }}
    >
      {/* HEADER ROW */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition"
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {expanded ? (
          <ChevronDown size={15} style={{ color: MUTED }} />
        ) : (
          <ChevronRight size={15} style={{ color: MUTED }} />
        )}
        <Building2 size={15} style={{ color: GOLD, flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold" style={{ color: TEXT }}>{ad}</div>
          <div className="text-[11px]" style={{ color: MUTED }}>
            VKN: {item.taxpayer.taxNumber} · {hesapSayisi} hesap
          </div>
        </div>

        <Badge label={statusBadge.label} tone={statusBadge.tone} />

        <span
          onClick={(e) => { e.stopPropagation(); onManageHesaplar(); }}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] font-medium"
          style={{ borderColor: LINE, color: GOLD, background: SOFT }}
        >
          <Edit3 size={11} /> Hesaplar
        </span>
      </button>

      {/* EXPANDED CONTENT */}
      {expanded && (
        <div className="border-t" style={{ borderColor: LINE }}>
          {hicHesap ? (
            <div className="flex items-center gap-2 px-4 py-3 text-[12.5px]" style={{ color: MUTED }}>
              <AlertCircle size={13} style={{ color: TONES.amber.fg }} />
              Banka hesabı tanımlı değil. <button
                onClick={onManageHesaplar}
                className="font-semibold underline"
                style={{ color: GOLD }}
              >Hesap ekle</button>
            </div>
          ) : (
            <>
              {/* Bulk actions */}
              <div className="flex items-center gap-2 px-4 py-2.5"
                   style={{ background: 'rgba(255,255,255,0.015)', borderBottom: `1px solid ${LINE}` }}>
                <span className="text-[11px]" style={{ color: MUTED }}>Toplu işlem:</span>
                <button
                  onClick={() => onBulk('geldi')}
                  disabled={isPending}
                  className="rounded-md border px-2 py-1 text-[11px] font-bold disabled:opacity-50"
                  style={{ borderColor: TONES.blue.bd, color: TONES.blue.fg, background: TONES.blue.bg }}
                >
                  Hepsi geldi
                </button>
                <button
                  onClick={() => onBulk('islendi')}
                  disabled={isPending}
                  className="rounded-md border px-2 py-1 text-[11px] font-bold disabled:opacity-50"
                  style={{ borderColor: TONES.green.bd, color: TONES.green.fg, background: TONES.green.bg }}
                >
                  Hepsi işlendi
                </button>
              </div>

              {/* Hesap satırları */}
              {item.hesaplar.map((h) => (
                <HesapRow
                  key={h.bankaHesap.id}
                  hesap={h}
                  isPending={isPending}
                  onToggle={(geldi, islendi) => onToggleEkstre(h.bankaHesap.id, geldi, islendi)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <span
      className="rounded-md border px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider"
      style={{ borderColor: t.bd, color: t.fg, background: t.bg }}
    >
      {label}
    </span>
  );
}

// ============================================================
// HESAP SATIRI
// ============================================================

function HesapRow({
  hesap,
  isPending,
  onToggle,
}: {
  hesap: BankaTakipItem['hesaplar'][number];
  isPending: boolean;
  onToggle: (geldi?: boolean, islendi?: boolean) => void;
}) {
  const bh = hesap.bankaHesap;
  return (
    <div
      className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5 border-t"
      style={{ borderColor: LINE }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: TEXT }}>
          <Landmark size={13} style={{ color: MUTED }} />
          <span className="truncate">{bh.bankaAdi}</span>
          {bh.paraBirimi && bh.paraBirimi !== 'TRY' && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
              {bh.paraBirimi}
            </span>
          )}
        </div>
        <div className="ml-[21px] mt-0.5 truncate font-mono text-[11px]" style={{ color: MUTED }}>
          {bh.iban || bh.hesapNo || (bh.sube ? `Şube: ${bh.sube}` : '—')}
          {bh.aciklama && <span className="ml-2" style={{ color: SUBTLE }}>· {bh.aciklama}</span>}
        </div>
      </div>

      <TogglePill
        label="Geldi"
        checked={hesap.ekstreGeldi}
        tarih={hesap.geldiTarihi}
        tone="amber"
        disabled={isPending}
        onClick={() => onToggle(!hesap.ekstreGeldi, undefined)}
      />
      <TogglePill
        label="İşlendi"
        checked={hesap.ekstreIslendi}
        tarih={hesap.islenmeTarihi}
        tone="green"
        disabled={isPending || !hesap.ekstreGeldi}
        onClick={() => onToggle(undefined, !hesap.ekstreIslendi)}
        hint={!hesap.ekstreGeldi ? 'Önce ekstrenin geldiğini işaretle' : undefined}
      />
    </div>
  );
}

function TogglePill({
  label,
  checked,
  tarih,
  tone,
  disabled,
  onClick,
  hint,
}: {
  label: string;
  checked: boolean;
  tarih?: string | null;
  tone: keyof typeof TONES;
  disabled?: boolean;
  onClick: () => void;
  hint?: string;
}) {
  const t = TONES[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint || (tarih ? `${label}: ${new Date(tarih).toLocaleString('tr-TR')}` : label)}
      className="inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-bold disabled:opacity-40 transition"
      style={{
        background: checked ? t.fg : t.bg,
        color: checked ? '#0f0d0b' : t.fg,
        borderColor: t.bd,
        minWidth: 96,
      }}
    >
      {checked ? <Check size={12} /> : <X size={12} />}
      {label}
    </button>
  );
}

// ============================================================
// HESAP MODAL
// ============================================================

function BankaHesapModal({
  item,
  onClose,
  onChanged,
}: {
  item: BankaTakipItem;
  onClose: () => void;
  onChanged: () => void;
}) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl border max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        style={{ background: '#1a1612', borderColor: LINE }}
      >
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: LINE }}>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider" style={{ color: GOLD }}>
              Banka Hesapları
            </div>
            <div className="mt-0.5 font-semibold" style={{ color: TEXT }}>{taxpayerName(item.taxpayer)}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/5" style={{ color: MUTED }}>
            <X size={18} />
          </button>
        </div>

        {/* Mevcut hesaplar */}
        <div className="p-5 space-y-2">
          <div className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: MUTED }}>
            Mevcut Hesaplar ({hesaplar.length})
          </div>
          {hesaplar.length === 0 ? (
            <div className="text-[12px]" style={{ color: SUBTLE }}>Henüz banka hesabı eklenmemiş.</div>
          ) : (
            <div className="space-y-1.5">
              {hesaplar.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                  style={{ background: SOFT, borderColor: LINE }}
                >
                  <Landmark size={14} style={{ color: GOLD }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium" style={{ color: TEXT }}>{h.bankaAdi}</div>
                    <div className="text-[11px] font-mono truncate" style={{ color: MUTED }}>
                      {h.iban || h.hesapNo || '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`"${h.bankaAdi}" hesabını silmek istiyor musun?`)) deleteMut.mutate(h.id);
                    }}
                    disabled={deleteMut.isPending}
                    className="p-1.5 rounded border disabled:opacity-50"
                    style={{ borderColor: TONES.red.bd, color: TONES.red.fg, background: TONES.red.bg }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Yeni hesap formu */}
        <div className="px-5 pb-5 space-y-3 border-t pt-4" style={{ borderColor: LINE }}>
          <div className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: MUTED }}>
            Yeni Hesap Ekle
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Banka adı (zorunlu) — örn. Ziraat Bankası"
              value={bankaAdi}
              onChange={(e) => setBankaAdi(e.target.value)}
              className="col-span-2 rounded-md border bg-transparent px-3 py-2 text-[13px]"
              style={{ borderColor: LINE, color: TEXT, background: SOFT }}
            />
            <input
              placeholder="IBAN (TR…)"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              className="rounded-md border bg-transparent px-3 py-2 text-[13px] font-mono"
              style={{ borderColor: LINE, color: TEXT, background: SOFT }}
            />
            <input
              placeholder="Hesap No (opsiyonel)"
              value={hesapNo}
              onChange={(e) => setHesapNo(e.target.value)}
              className="rounded-md border bg-transparent px-3 py-2 text-[13px]"
              style={{ borderColor: LINE, color: TEXT, background: SOFT }}
            />
            <input
              placeholder="Açıklama (opsiyonel)"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              className="col-span-2 rounded-md border bg-transparent px-3 py-2 text-[13px]"
              style={{ borderColor: LINE, color: TEXT, background: SOFT }}
            />
          </div>
          <button
            onClick={() => createMut.mutate()}
            disabled={!bankaAdi.trim() || createMut.isPending}
            className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
            style={{
              background: bankaAdi.trim() ? `linear-gradient(135deg, ${GOLD}, #8b7649)` : SOFT,
              color: bankaAdi.trim() ? '#0f0d0b' : MUTED,
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
