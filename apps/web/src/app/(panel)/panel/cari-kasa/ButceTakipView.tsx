'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  BarChart3,
  Check,
  Edit3,
  Loader2,
  Plus,
  Power,
  Save,
  Trash2,
  X,
} from 'lucide-react';

// ===== SADE KOYU PALET (referans HTML'lere göre) =====
const GOLD = '#e6c878';
const DEBT = '#e0697a';
const OK = '#5ad18a';
const BG = '#08080a';
const PANEL = '#0c0c0e';
const CARD_BORDER = 'rgba(255,255,255,0.06)';
const CARD_BG = 'rgba(255,255,255,0.018)';
const ROW_LINE = 'rgba(255,255,255,0.05)';
const TEXT = '#e7e7ea';
const SOFT = '#71717a';
const SANS = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const OPTION_STYLE: React.CSSProperties = { background: '#15151a', color: TEXT };
const GOLD_GRAD = 'linear-gradient(135deg,#ecd589,#d4b876)';

export type FinancialAccount = {
  id: string;
  name: string;
  type: 'BANKA' | 'NAKIT' | 'KREDI_KARTI' | 'DIGER' | string;
  color: string;
  openingBalance: number;
  openingDate: string;
  sortOrder?: number;
  isActive: boolean;
  currentBalance: number;
  monthInflow: number;
  monthOutflow: number;
  monthIncome: number;
  monthExpense: number;
  monthTransferIn: number;
  monthTransferOut: number;
  monthNet: number;
};

type BudgetCategory = {
  id: string;
  name: string;
  type: 'GELIR' | 'GIDER';
  color: string;
  icon?: string | null;
  sortOrder: number;
  isActive: boolean;
};

type BudgetMonth = {
  period: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  plannedIncome?: number;
  plannedExpense?: number;
  plannedNet?: number;
  variance?: number;
};

type BudgetCategoryRow = {
  categoryId: string;
  name: string;
  type: 'GELIR' | 'GIDER';
  color: string;
  isActive: boolean;
  planned: number;
  actual: number;
  variance: number;
  realizationPct: number;
  annualActual: number;
  annualPlanned: number;
  months?: Array<{ period: string; label: string; actual: number; planned: number; variance: number }>;
};

type BudgetEntry = {
  id: string;
  source: 'MANUAL' | 'CARI_TAHSILAT' | string;
  date: string;
  period: string;
  type: 'GELIR' | 'GIDER';
  amount: number;
  description?: string | null;
  paymentMethod?: string | null;
  documentNo?: string | null;
  account?: { id: string; name: string; type: string; color: string } | null;
  category?: { id: string; name: string; color: string; type: 'GELIR' | 'GIDER' } | null;
};

type BudgetSummary = {
  year: number;
  period: string;
  categories: BudgetCategory[];
  accounts?: FinancialAccount[];
  months: BudgetMonth[];
  categoryRows: BudgetCategoryRow[];
  categoryMonthlyRows?: BudgetCategoryRow[];
  entries: BudgetEntry[];
  unassignedCollections?: { count: number; amount: number };
  kpi: {
    periodIncome: number;
    periodExpense: number;
    periodNet: number;
    periodPlannedIncome: number;
    periodPlannedExpense: number;
    periodPlannedNet: number;
    periodVariance: number;
    annualIncome: number;
    annualExpense: number;
    annualNet: number;
    annualPlannedIncome: number;
    annualPlannedExpense: number;
    annualPlannedNet: number;
  };
};

type CashflowSummary = {
  year: number;
  period: string;
  accounts: FinancialAccount[];
  months: Array<{ period: string; label: string; income: number; expense: number; transferIn: number; transferOut: number; net: number }>;
  recentEntries: BudgetEntry[];
  transfers: Array<{
    id: string;
    date: string;
    period: string;
    amount: number;
    description?: string | null;
    documentNo?: string | null;
    fromAccount: { id: string; name: string; type: string; color: string };
    toAccount: { id: string; name: string; type: string; color: string };
  }>;
  kpi: {
    totalBalance: number;
    monthIncome: number;
    monthExpense: number;
    monthNet: number;
    monthInflow: number;
    monthOutflow: number;
    unassignedCollectionsCount: number;
    unassignedCollectionsAmount: number;
  };
};

type Istatistik = {
  kpi: {
    aylikHedef: number;
    buAyTahakkuk: number;
    buAyTahsilat: number;
    gecenAyTahsilat: number;
    toplamTahakkuk12Ay: number;
    toplamTahsilat12Ay: number;
    tahsilatOrani: number;
    toplamAktifBorc: number;
    borcluMukellefAdet: number;
  };
  trend: Array<{ ay: string; tahakkuk: number; tahsilat: number }>;
  odemeYontemi: Array<{ yontem: string; tutar: number }>;
  enBorclular: Array<{ id: string; ad: string; taxNumber?: string | null; bakiye: number }>;
};

const fmt = (n: number | null | undefined) => {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseMoneyValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').replace(/TL|₺/gi, '').replace(/\s/g, '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const formatMoneyDraft = (value: unknown) => {
  const n = parseMoneyValue(value);
  return n ? fmt(n) : '';
};

const today = () => new Date().toISOString().slice(0, 10);
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const ayKisaLabel = (ay: string) => {
  const m = Number(ay.slice(5, 7));
  return AY_KISA[m - 1] || ay;
};

const odemeYontemiLabel = (k: string) => {
  const map: Record<string, string> = {
    NAKIT: 'Nakit',
    HAVALE: 'Havale / EFT',
    EFT: 'EFT',
    KREDI_KARTI: 'Kredi Kartı',
    CEK: 'Çek',
    SENET: 'Senet',
    BELIRTILMEMIS: 'Belirtilmemiş',
  };
  return map[k] || k;
};

// ===== Ortak stiller =====
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid rgba(255,255,255,0.10)`,
  color: TEXT,
  outline: 'none',
  fontSize: 14,
};
const selectStyle: React.CSSProperties = { ...inputStyle, colorScheme: 'dark' };

const cardline: React.CSSProperties = { border: `1px solid ${CARD_BORDER}`, background: CARD_BG };
const panelStyle: React.CSSProperties = { background: PANEL, border: '1px solid rgba(255,255,255,0.07)' };

function useBudgetSummary(year: number, period: string) {
  return useQuery<BudgetSummary>({
    queryKey: ['cari-budget-summary', year, period],
    queryFn: () => api.get('/cari-kasa/budget/summary', { params: { year, period } }).then((r) => r.data),
    refetchInterval: 60000,
  });
}

function useCashflowSummary(year: number, period: string) {
  return useQuery<CashflowSummary>({
    queryKey: ['cari-cashflow-summary', year, period],
    queryFn: () => api.get('/cari-kasa/cashflow-summary', { params: { year, period } }).then((r) => r.data),
    refetchInterval: 45000,
  });
}

// ===== Genel UI parçaları =====
function ViewHeader({ icon: Icon, title, subtitle, actions }: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3.5 min-w-0">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-black" style={{ background: GOLD_GRAD }}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[24px] sm:text-[26px] font-bold tracking-tight leading-none" style={{ color: '#fff' }}>{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13.5px]" style={{ color: SOFT }}>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

function PeriodSelect({ year, period, onYear, onPeriod }: {
  year: number;
  period: string;
  onYear: (year: number) => void;
  onPeriod: (period: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={year}
        onChange={(e) => onYear(Number(e.target.value))}
        className="rounded-xl px-3 py-2 text-[13px] font-medium"
        style={selectStyle}
      >
        {[year - 1, year, year + 1].map((y) => <option key={y} value={y} style={OPTION_STYLE}>{y}</option>)}
      </select>
      <select
        value={period}
        onChange={(e) => onPeriod(e.target.value)}
        className="rounded-xl px-3 py-2 text-[13px] font-medium"
        style={selectStyle}
      >
        {monthsOf(year).map((p) => <option key={p} value={p} style={OPTION_STYLE}>{p}</option>)}
      </select>
    </div>
  );
}

function KpiCard({ label, value, color = TEXT, accent = false, suffix = '₺' }: {
  label: string;
  value: string;
  color?: string;
  accent?: boolean;
  suffix?: string;
}) {
  const style: React.CSSProperties = accent
    ? { border: '1px solid rgba(230,200,120,0.45)', background: 'rgba(230,200,120,0.05)' }
    : cardline;
  return (
    <div className="rounded-2xl px-5 py-4" style={style}>
      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: accent ? '#cbae6e' : SOFT }}>{label}</div>
      <div className="mt-2.5 text-[24px] sm:text-[27px] font-bold" style={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {value}{suffix ? <span className="text-[16px] font-semibold ml-1" style={{ color: SOFT }}>{suffix}</span> : null}
      </div>
    </div>
  );
}

function SecondaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium transition disabled:opacity-50"
      style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: TEXT }}
    >
      {children}
    </button>
  );
}

function GoldBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-black transition disabled:opacity-60"
      style={{ background: GOLD_GRAD }}
    >
      {children}
    </button>
  );
}

function LoadingPanel({ label = 'Hesaplanıyor...' }: { label?: string }) {
  return (
    <div className="py-16 text-center text-[14px] font-medium" style={{ color: SOFT }}>
      <Loader2 className="animate-spin inline mr-2" size={16} />{label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl px-5 py-12 text-center text-[14px]" style={{ ...cardline, color: SOFT }}>
      {label}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-[12.5px] font-medium" style={{ color: SOFT }}>{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-10" style={{ background: 'rgba(0,0,0,0.62)' }} onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-[18px] p-5 sm:p-6" style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-[17px] font-bold" style={{ color: '#fff' }}>{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.10)', color: SOFT }}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ====================================================================
// KASA / BANKA
// ====================================================================
export function KasaBankaView() {
  const qc = useQueryClient();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod());
  const [modal, setModal] = useState<null | 'entry' | 'transfer' | 'account'>(null);

  const [entryForm, setEntryForm] = useState({
    type: 'GIDER' as 'GELIR' | 'GIDER',
    accountId: '',
    categoryId: '',
    date: today(),
    amount: 0,
    description: '',
    paymentMethod: 'HAVALE',
    documentNo: '',
  });
  const [transferForm, setTransferForm] = useState({
    fromAccountId: '',
    toAccountId: '',
    date: today(),
    amount: 0,
    description: '',
  });
  const [accountForm, setAccountForm] = useState({
    name: '',
    type: 'BANKA',
    openingBalance: 0,
    openingDate: today(),
    color: '#d4b876',
  });
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);

  const { data, isLoading } = useCashflowSummary(year, period);
  const { data: budget } = useBudgetSummary(year, period);
  const accounts = data?.accounts || [];
  const categories = useMemo(() => (budget?.categories || []).filter((c) => c.isActive), [budget?.categories]);
  const entryCategories = useMemo(
    () => categories.filter((c) => c.type === entryForm.type),
    [categories, entryForm.type],
  );

  useEffect(() => {
    if (accounts.length && !entryForm.accountId) setEntryForm((old) => ({ ...old, accountId: accounts[0].id }));
    if (accounts.length && !transferForm.fromAccountId) setTransferForm((old) => ({ ...old, fromAccountId: accounts[0].id, toAccountId: accounts[1]?.id || accounts[0].id }));
  }, [accounts, entryForm.accountId, transferForm.fromAccountId]);

  useEffect(() => {
    if (!entryCategories.length) return;
    if (!entryCategories.some((c) => c.id === entryForm.categoryId)) {
      setEntryForm((old) => ({ ...old, categoryId: entryCategories[0].id }));
    }
  }, [entryCategories, entryForm.categoryId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cari-cashflow-summary'] });
    qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });
    qc.invalidateQueries({ queryKey: ['cari-accounts'] });
  };

  const saveEntry = async () => {
    if (!entryForm.accountId) { toast.error('Hesap seçin'); return; }
    if (!entryForm.categoryId) { toast.error('Kategori seçin'); return; }
    if (entryForm.amount <= 0) { toast.error('Tutar pozitif olmalı'); return; }
    setSavingEntry(true);
    try {
      await api.post('/cari-kasa/budget/entries', {
        accountId: entryForm.accountId,
        categoryId: entryForm.categoryId,
        date: entryForm.date,
        amount: entryForm.amount,
        description: entryForm.description || undefined,
        paymentMethod: entryForm.paymentMethod || undefined,
        documentNo: entryForm.documentNo || undefined,
      });
      toast.success('Hareket kaydedildi');
      setEntryForm((old) => ({ ...old, amount: 0, description: '', documentNo: '' }));
      invalidate();
      setModal(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kaydedilemedi');
    } finally {
      setSavingEntry(false);
    }
  };

  const saveTransfer = async () => {
    if (!transferForm.fromAccountId || !transferForm.toAccountId) { toast.error('Transfer hesaplarını seçin'); return; }
    if (transferForm.fromAccountId === transferForm.toAccountId) { toast.error('İki farklı hesap seçin'); return; }
    if (transferForm.amount <= 0) { toast.error('Tutar pozitif olmalı'); return; }
    setSavingTransfer(true);
    try {
      await api.post('/cari-kasa/account-transfers', transferForm);
      toast.success('Transfer işlendi');
      setTransferForm((old) => ({ ...old, amount: 0, description: '' }));
      invalidate();
      setModal(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Transfer kaydedilemedi');
    } finally {
      setSavingTransfer(false);
    }
  };

  const saveAccount = async () => {
    if (!accountForm.name.trim()) { toast.error('Hesap adı girin'); return; }
    setSavingAccount(true);
    try {
      await api.post('/cari-kasa/accounts', accountForm);
      toast.success('Hesap eklendi');
      setAccountForm((old) => ({ ...old, name: '', openingBalance: 0 }));
      invalidate();
      setModal(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Hesap eklenemedi');
    } finally {
      setSavingAccount(false);
    }
  };

  const deleteTransfer = async (id: string) => {
    if (!confirm('Bu transfer kaydını silmek istiyor musunuz?')) return;
    try {
      await api.delete(`/cari-kasa/account-transfers/${id}`);
      toast.success('Transfer silindi');
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Silinemedi');
    }
  };

  if (isLoading || !data) return <LoadingPanel />;

  const kpi = data.kpi;

  return (
    <div style={{ fontFamily: SANS }}>
      <ViewHeader
        icon={LandmarkIcon}
        title="Kasa & Banka"
        subtitle={`${period} · ${accounts.length} hesap`}
        actions={(
          <>
            <PeriodSelect year={year} period={period} onYear={(next) => { setYear(next); setPeriod(`${next}-${period.slice(5, 7)}`); }} onPeriod={setPeriod} />
            <GoldBtn onClick={() => setModal('entry')}><Plus className="h-4 w-4" /> Hareket</GoldBtn>
            <SecondaryBtn onClick={() => setModal('transfer')}><ArrowRightLeft className="h-4 w-4" /> Transfer</SecondaryBtn>
            <SecondaryBtn onClick={() => setModal('account')}><Plus className="h-4 w-4" /> Hesap</SecondaryBtn>
          </>
        )}
      />

      {kpi.unassignedCollectionsCount > 0 && (
        <div className="mt-5 rounded-2xl px-4 py-3 text-[13.5px] font-medium" style={{ background: 'rgba(230,200,120,0.06)', border: '1px solid rgba(230,200,120,0.22)', color: '#e6c878' }}>
          {kpi.unassignedCollectionsCount} eski tahsilatın hesabı atanmamış. Toplam {fmt(kpi.unassignedCollectionsAmount)} ₺ kasa/banka bakiyesine dahil edilmedi.
        </div>
      )}

      {/* KPI */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Toplam Bakiye" value={fmt(kpi.totalBalance)} />
        <KpiCard label="Bu Ay Giriş" value={fmt(kpi.monthIncome)} color={OK} />
        <KpiCard label="Bu Ay Çıkış" value={fmt(kpi.monthExpense)} color={DEBT} />
        <KpiCard label="Net" value={(kpi.monthNet >= 0 ? '+' : '') + fmt(kpi.monthNet)} color={kpi.monthNet >= 0 ? GOLD : DEBT} accent />
      </div>

      {/* HESAPLAR */}
      <h2 className="mt-7 mb-3 text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Hesaplar</h2>
      {accounts.length === 0 ? <EmptyState label="Henüz hesap yok. Sağ üstten Hesap ekleyin." /> : (
        <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT }}>
                  <th className="px-5 py-3.5 text-left font-medium">Hesap</th>
                  <th className="px-3 py-3.5 text-left font-medium">Tür</th>
                  <th className="px-3 py-3.5 text-right font-medium">Güncel Bakiye</th>
                  <th className="px-3 py-3.5 text-right font-medium">Bu Ay Giriş</th>
                  <th className="px-5 py-3.5 text-right font-medium">Bu Ay Çıkış</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const typeLabel = a.type === 'NAKIT' ? 'Nakit' : a.type === 'BANKA' ? 'Banka' : a.type === 'KREDI_KARTI' ? 'Kredi Kartı' : a.type;
                  return (
                    <tr key={a.id} className="group" style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color || GOLD }} />
                          <span className="font-semibold truncate" style={{ color: '#fff' }}>{a.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <span className="inline-flex rounded-lg px-2.5 py-1 text-[12px] font-semibold" style={{ background: 'rgba(140,160,190,0.10)', color: '#aab4c4', border: '1px solid rgba(140,160,190,0.20)' }}>{typeLabel}</span>
                      </td>
                      <td className="px-3 py-4 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{fmt(a.currentBalance)} ₺</td>
                      <td className="px-3 py-4 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: a.monthInflow ? OK : SOFT }}>{fmt(a.monthInflow)} ₺</td>
                      <td className="px-5 py-4 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: a.monthOutflow ? DEBT : SOFT }}>{fmt(a.monthOutflow)} ₺</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HAREKETLER */}
      <h2 className="mt-7 mb-3 text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Bu ay hareketleri</h2>
      <MovementTable entries={data.recentEntries} transfers={data.transfers} onDeleteTransfer={deleteTransfer} />

      {/* MODALLAR */}
      {modal === 'entry' && (
        <Modal title="Gelir / Gider Hareketi" onClose={() => setModal(null)}>
          <EntryFormBody
            form={entryForm}
            setForm={setEntryForm}
            accounts={accounts}
            categories={entryCategories}
            saving={savingEntry}
            onSave={saveEntry}
          />
        </Modal>
      )}
      {modal === 'transfer' && (
        <Modal title="Hesaplar Arası Transfer" onClose={() => setModal(null)}>
          <TransferFormBody form={transferForm} setForm={setTransferForm} accounts={accounts} saving={savingTransfer} onSave={saveTransfer} />
        </Modal>
      )}
      {modal === 'account' && (
        <Modal title="Yeni Hesap" onClose={() => setModal(null)}>
          <AccountFormBody form={accountForm} setForm={setAccountForm} saving={savingAccount} onSave={saveAccount} />
        </Modal>
      )}
    </div>
  );
}

function LandmarkIcon(props: React.ComponentProps<typeof BarChart3>) {
  // referans header ikonu yerine paket içi ikon kullan
  return <BarChart3 {...props} />;
}

function EntryFormBody({ form, setForm, accounts, categories, saving, onSave }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  accounts: FinancialAccount[];
  categories: BudgetCategory[];
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setForm((old: any) => ({ ...old, type: 'GELIR' }))} className="py-2.5 rounded-xl text-[14px] font-bold" style={{ background: form.type === 'GELIR' ? 'rgba(90,209,138,0.14)' : 'rgba(255,255,255,0.04)', color: form.type === 'GELIR' ? OK : SOFT, border: `1px solid ${form.type === 'GELIR' ? 'rgba(90,209,138,0.30)' : 'rgba(255,255,255,0.08)'}` }}>Gelir</button>
        <button onClick={() => setForm((old: any) => ({ ...old, type: 'GIDER' }))} className="py-2.5 rounded-xl text-[14px] font-bold" style={{ background: form.type === 'GIDER' ? 'rgba(224,105,122,0.14)' : 'rgba(255,255,255,0.04)', color: form.type === 'GIDER' ? DEBT : SOFT, border: `1px solid ${form.type === 'GIDER' ? 'rgba(224,105,122,0.30)' : 'rgba(255,255,255,0.08)'}` }}>Gider</button>
      </div>
      <Field label="Hesap">
        <select value={form.accountId} onChange={(e) => setForm((old: any) => ({ ...old, accountId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={selectStyle}>
          <option value="" style={OPTION_STYLE}>Hesap seçin</option>
          {accounts.map((a) => <option key={a.id} value={a.id} style={OPTION_STYLE}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Kategori">
        <select value={form.categoryId} onChange={(e) => setForm((old: any) => ({ ...old, categoryId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={selectStyle}>
          <option value="" style={OPTION_STYLE}>Kategori seçin</option>
          {categories.map((c) => <option key={c.id} value={c.id} style={OPTION_STYLE}>{c.name}</option>)}
        </select>
      </Field>
      <div className="rounded-xl px-3 py-2.5 text-[12px] leading-relaxed" style={{ background: 'rgba(230,200,120,0.05)', border: '1px solid rgba(230,200,120,0.18)', color: '#cbae6e' }}>
        Bu alan ofis gelir/gider hareketidir. Mükellef cari bakiyesine işlemek için Cari Liste içinden Tahsilat Ekle kullanılır.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tarih"><input type="date" value={form.date} onChange={(e) => setForm((old: any) => ({ ...old, date: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={inputStyle} /></Field>
        <Field label="Tutar"><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((old: any) => ({ ...old, amount: Number(e.target.value) }))} className="w-full px-3 py-2.5 rounded-xl" style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} /></Field>
      </div>
      <Field label="Açıklama"><input value={form.description} onChange={(e) => setForm((old: any) => ({ ...old, description: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={inputStyle} /></Field>
      <button onClick={onSave} disabled={saving} className="w-full py-2.5 rounded-xl text-[14px] font-bold text-black disabled:opacity-60" style={{ background: GOLD_GRAD }}>
        {saving ? <Loader2 size={14} className="animate-spin inline" /> : <><Save size={14} className="inline mr-1" /> Kaydet</>}
      </button>
    </div>
  );
}

function TransferFormBody({ form, setForm, accounts, saving, onSave }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  accounts: FinancialAccount[];
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Çıkış Hesabı">
        <select value={form.fromAccountId} onChange={(e) => setForm((old: any) => ({ ...old, fromAccountId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={selectStyle}>
          {accounts.map((a) => <option key={a.id} value={a.id} style={OPTION_STYLE}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Giriş Hesabı">
        <select value={form.toAccountId} onChange={(e) => setForm((old: any) => ({ ...old, toAccountId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={selectStyle}>
          {accounts.map((a) => <option key={a.id} value={a.id} style={OPTION_STYLE}>{a.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tarih"><input type="date" value={form.date} onChange={(e) => setForm((old: any) => ({ ...old, date: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={inputStyle} /></Field>
        <Field label="Tutar"><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((old: any) => ({ ...old, amount: Number(e.target.value) }))} className="w-full px-3 py-2.5 rounded-xl" style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} /></Field>
      </div>
      <Field label="Açıklama"><input value={form.description} onChange={(e) => setForm((old: any) => ({ ...old, description: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={inputStyle} /></Field>
      <button onClick={onSave} disabled={saving} className="w-full py-2.5 rounded-xl text-[14px] font-bold disabled:opacity-60" style={{ background: 'rgba(255,255,255,0.05)', color: TEXT, border: '1px solid rgba(255,255,255,0.12)' }}>
        {saving ? <Loader2 size={14} className="animate-spin inline" /> : <><ArrowRightLeft size={14} className="inline mr-1" /> Transferi İşle</>}
      </button>
    </div>
  );
}

function AccountFormBody({ form, setForm, saving, onSave }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Ad"><input value={form.name} onChange={(e) => setForm((old: any) => ({ ...old, name: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={inputStyle} /></Field>
        <Field label="Tür">
          <select value={form.type} onChange={(e) => setForm((old: any) => ({ ...old, type: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={selectStyle}>
            <option value="BANKA" style={OPTION_STYLE}>Banka</option>
            <option value="NAKIT" style={OPTION_STYLE}>Nakit</option>
            <option value="KREDI_KARTI" style={OPTION_STYLE}>Kredi Kartı</option>
            <option value="DIGER" style={OPTION_STYLE}>Diğer</option>
          </select>
        </Field>
        <Field label="Açılış Bakiyesi"><input type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm((old: any) => ({ ...old, openingBalance: Number(e.target.value) }))} className="w-full px-3 py-2.5 rounded-xl" style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} /></Field>
        <Field label="Renk"><input type="color" value={form.color} onChange={(e) => setForm((old: any) => ({ ...old, color: e.target.value }))} className="w-full h-[42px] rounded-xl" style={{ ...inputStyle, padding: 4 }} /></Field>
      </div>
      <button onClick={onSave} disabled={saving} className="w-full py-2.5 rounded-xl text-[14px] font-bold text-black disabled:opacity-60" style={{ background: GOLD_GRAD }}>
        {saving ? <Loader2 size={14} className="animate-spin inline" /> : <><Plus size={14} className="inline mr-1" /> Hesap Ekle</>}
      </button>
    </div>
  );
}

function MovementTable({ entries, transfers, onDeleteTransfer }: {
  entries: BudgetEntry[];
  transfers: CashflowSummary['transfers'];
  onDeleteTransfer: (id: string) => void;
}) {
  const rows = [
    ...entries.map((e) => ({ ...e, rowType: 'ENTRY' as const })),
    ...transfers.map((t) => ({ ...t, rowType: 'TRANSFER' as const, type: 'TRANSFER' as const, date: t.date })),
  ].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (!rows.length) {
    return <EmptyState label="Bu ay hareket yok." />;
  }
  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[14px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT }}>
              <th className="px-5 py-3.5 text-left font-medium">Tarih</th>
              <th className="px-3 py-3.5 text-left font-medium">Açıklama</th>
              <th className="px-3 py-3.5 text-left font-medium">Hesap / Kategori</th>
              <th className="px-3 py-3.5 text-left font-medium">Tür</th>
              <th className="px-5 py-3.5 text-right font-medium">Tutar</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => {
              const isTransfer = row.rowType === 'TRANSFER';
              const isGelir = !isTransfer && row.type === 'GELIR';
              const color = isTransfer ? GOLD : isGelir ? OK : DEBT;
              const badge = isTransfer
                ? { background: 'rgba(230,200,120,0.12)', color: '#e6c878', border: '1px solid rgba(230,200,120,0.22)' }
                : isGelir
                  ? { background: 'rgba(90,209,138,0.12)', color: '#6ee29c', border: '1px solid rgba(90,209,138,0.22)' }
                  : { background: 'rgba(224,105,122,0.13)', color: '#eaa3ad', border: '1px solid rgba(224,105,122,0.22)' };
              const label = isTransfer ? 'Transfer' : isGelir ? 'Gelir' : 'Gider';
              return (
                <tr key={`${row.rowType}-${row.id}`} style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                  <td className="px-5 py-4 whitespace-nowrap" style={{ color: '#a1a1aa', fontVariantNumeric: 'tabular-nums' }}>{new Date(row.date).toLocaleDateString('tr-TR')}</td>
                  <td className="px-3 py-4 font-medium" style={{ color: TEXT }}>{row.description || '-'}</td>
                  <td className="px-3 py-4" style={{ color: '#a1a1aa' }}>
                    {isTransfer ? `${row.fromAccount?.name} → ${row.toAccount?.name}` : `${row.account?.name || 'Hesapsız'} / ${row.category?.name || 'Cari Tahsilat'}`}
                  </td>
                  <td className="px-3 py-4">
                    <span className="inline-flex rounded-lg px-2.5 py-1 text-[12px] font-semibold" style={badge}>{label}</span>
                  </td>
                  <td className="px-5 py-4 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums', color }}>
                    {isTransfer ? '' : isGelir ? '+' : '-'}{fmt(row.amount)} ₺
                  </td>
                  <td className="px-3 py-4 text-right">
                    {isTransfer && (
                      <button onClick={() => onDeleteTransfer(row.id)} className="p-1.5 rounded-lg" style={{ color: '#eaa3ad', background: 'rgba(224,105,122,0.10)' }} title="Transferi sil">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ====================================================================
// GELİR - GİDER TABLOSU
// ====================================================================
export function GelirGiderTablosuView() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod());
  const { data, isLoading } = useBudgetSummary(year, period);
  if (isLoading || !data) return <LoadingPanel />;

  const rows = data.categoryMonthlyRows || data.categoryRows;
  const incomeRows = rows.filter((r) => r.type === 'GELIR');
  const expenseRows = rows.filter((r) => r.type === 'GIDER');
  const kpi = data.kpi;

  return (
    <div style={{ fontFamily: SANS }}>
      <ViewHeader
        icon={BarChart3}
        title="Gelir-Gider"
        subtitle={`${year} · ofis gelir-gider özeti`}
        actions={<PeriodSelect year={year} period={period} onYear={(next) => { setYear(next); setPeriod(`${next}-${period.slice(5, 7)}`); }} onPeriod={setPeriod} />}
      />

      {/* KPI */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Yıllık Gelir" value={fmt(kpi.annualIncome)} color={OK} />
        <KpiCard label="Yıllık Gider" value={fmt(kpi.annualExpense)} color={DEBT} />
        <KpiCard label="Net" value={(kpi.annualNet >= 0 ? '+' : '') + fmt(kpi.annualNet)} color={kpi.annualNet >= 0 ? GOLD : DEBT} accent />
        <KpiCard label="Plan Farkı" value={(kpi.periodVariance >= 0 ? '+' : '') + fmt(kpi.periodVariance)} color={kpi.periodVariance >= 0 ? OK : DEBT} />
      </div>

      <IncomeExpenseTable title="Gelir kalemleri" dot={OK} rows={incomeRows} color={OK} />
      <IncomeExpenseTable title="Gider kalemleri" dot={DEBT} rows={expenseRows} color={DEBT} />

      <p className="mt-4 text-center text-[12px]" style={{ color: '#52525b' }}>
        Net = gelir − gider · Plan farkı = gerçekleşen − planlanan
      </p>
    </div>
  );
}

function IncomeExpenseTable({ title, dot, rows, color }: { title: string; dot: string; rows: BudgetCategoryRow[]; color: string }) {
  return (
    <div className="mt-7">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        <h2 className="text-[15px] font-semibold" style={{ color: '#fff' }}>{title}</h2>
        <span className="text-[12px]" style={{ color: SOFT }}>· {rows.length} kalem</span>
      </div>
      {rows.length === 0 ? <EmptyState label="Bu türde kalem yok." /> : (
        <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT }}>
                  <th className="px-5 py-3.5 text-left font-medium">Kategori</th>
                  <th className="px-3 py-3.5 text-right font-medium">Bu Ay</th>
                  <th className="px-5 py-3.5 text-right font-medium">Yıl Toplam</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.categoryId} style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color || dot }} />
                        <span className="font-semibold truncate" style={{ color: '#fff' }}>{r.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right font-medium" style={{ fontVariantNumeric: 'tabular-nums', color: r.actual ? color : SOFT }}>{fmt(r.actual)} ₺</td>
                    <td className="px-5 py-4 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums', color }}>{fmt(r.annualActual)} ₺</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// BÜTÇE PLANI
// ====================================================================
export function ButcePlanView() {
  const qc = useQueryClient();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod());
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [categoryForm, setCategoryForm] = useState({ type: 'GIDER' as 'GELIR' | 'GIDER', name: '', color: '#e0697a' });
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, { name: string; color: string; sortOrder: string; isActive: boolean }>>({});
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const { data, isLoading } = useBudgetSummary(year, period);
  const categoriesById = useMemo(() => new Map((data?.categories || []).map((c) => [c.id, c])), [data?.categories]);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const row of data.categoryRows) next[row.categoryId] = row.planned ? fmt(row.planned) : '';
    setPlanDraft(next);
  }, [data?.period, data?.categoryRows]);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, { name: string; color: string; sortOrder: string; isActive: boolean }> = {};
    for (const category of data.categories) {
      next[category.id] = {
        name: category.name,
        color: category.color || (category.type === 'GELIR' ? OK : DEBT),
        sortOrder: String(category.sortOrder ?? 100),
        isActive: category.isActive,
      };
    }
    setCategoryDrafts(next);
  }, [data?.categories]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });

  const savePlans = async () => {
    if (!data) return;
    setSavingPlan(true);
    try {
      await api.put('/cari-kasa/budget/plans', {
        period,
        items: data.categoryRows
          .filter((r) => r.isActive)
          .map((r) => ({ categoryId: r.categoryId, plannedAmount: parseMoneyValue(planDraft[r.categoryId]) })),
      });
      toast.success('Bütçe planı güncellendi');
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Plan kaydedilemedi');
    } finally {
      setSavingPlan(false);
    }
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) { toast.error('Kategori adı girin'); return; }
    setSavingCategory(true);
    try {
      await api.post('/cari-kasa/budget/categories', categoryForm);
      toast.success('Kategori eklendi');
      setCategoryForm((old) => ({ ...old, name: '' }));
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kategori eklenemedi');
    } finally {
      setSavingCategory(false);
    }
  };

  const saveCategoryEdit = async (row: BudgetCategoryRow) => {
    const draft = categoryDrafts[row.categoryId];
    if (!draft?.name.trim()) { toast.error('Kategori adı girin'); return; }
    setSavingCategoryId(row.categoryId);
    try {
      await api.put(`/cari-kasa/budget/categories/${row.categoryId}`, {
        name: draft.name.trim(),
        color: draft.color,
        sortOrder: Number(draft.sortOrder || 100),
        isActive: draft.isActive,
      });
      toast.success('Kategori güncellendi');
      setEditingCategoryId(null);
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kategori güncellenemedi');
    } finally {
      setSavingCategoryId(null);
    }
  };

  const toggleCategoryActive = async (row: BudgetCategoryRow) => {
    setSavingCategoryId(row.categoryId);
    try {
      if (row.isActive) await api.delete(`/cari-kasa/budget/categories/${row.categoryId}`);
      else await api.put(`/cari-kasa/budget/categories/${row.categoryId}`, { isActive: true });
      toast.success(row.isActive ? 'Kategori pasifleştirildi' : 'Kategori aktifleştirildi');
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kategori güncellenemedi');
    } finally {
      setSavingCategoryId(null);
    }
  };

  if (isLoading || !data) return <LoadingPanel />;

  const kpi = data.kpi;

  return (
    <div style={{ fontFamily: SANS }}>
      <ViewHeader
        icon={BarChart3}
        title="Bütçe Planı"
        subtitle={`${year} · plan / gerçekleşen`}
        actions={(
          <>
            <PeriodSelect year={year} period={period} onYear={(next) => { setYear(next); setPeriod(`${next}-${period.slice(5, 7)}`); }} onPeriod={setPeriod} />
            <SecondaryBtn onClick={() => setShowCategoriesModal(true)}><Edit3 className="h-4 w-4" /> Kategoriler</SecondaryBtn>
            <GoldBtn onClick={savePlans} disabled={savingPlan}>
              {savingPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Planı Kaydet
            </GoldBtn>
          </>
        )}
      />

      {/* KPI */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Plan Gelir" value={fmt(kpi.periodPlannedIncome)} color="#7fd9a4" />
        <KpiCard label="Gerçek Gelir" value={fmt(kpi.periodIncome)} color={OK} />
        <KpiCard label="Plan Gider" value={fmt(kpi.periodPlannedExpense)} color="#e09aa6" />
        <KpiCard label="Gerçek Gider" value={fmt(kpi.periodExpense)} color={DEBT} />
      </div>

      {/* PLAN TABLOSU */}
      <div className="mt-6 overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[14px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT }}>
                <th className="px-5 py-3.5 text-left font-medium">Kategori</th>
                <th className="px-3 py-3.5 text-right font-medium">Plan</th>
                <th className="px-3 py-3.5 text-right font-medium">Gerçekleşen</th>
                <th className="px-3 py-3.5 text-right font-medium">Fark</th>
                <th className="px-5 py-3.5 text-left font-medium w-[230px]">Oran</th>
              </tr>
            </thead>
            <tbody>
              {data.categoryRows.map((row) => {
                const isGelir = row.type === 'GELIR';
                const farkColor = row.variance === 0 ? '#9a9aa1' : row.variance >= 0 ? OK : DEBT;
                const oran = row.realizationPct;
                const barColor = oran <= 100 ? OK : isGelir ? OK : DEBT;
                const tipBadge = isGelir
                  ? { background: 'rgba(90,209,138,0.12)', color: '#6ee29c', border: '1px solid rgba(90,209,138,0.22)' }
                  : { background: 'rgba(224,105,122,0.13)', color: '#eaa3ad', border: '1px solid rgba(224,105,122,0.22)' };
                return (
                  <tr key={row.categoryId} style={{ borderTop: `1px solid ${ROW_LINE}`, opacity: row.isActive ? 1 : 0.55 }}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color || (isGelir ? OK : DEBT) }} />
                        <span className="font-semibold truncate" style={{ color: '#fff' }}>{row.name}</span>
                        <span className="inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold" style={tipBadge}>{isGelir ? 'gelir' : 'gider'}</span>
                        {!row.isActive && <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'rgba(255,255,255,0.06)', color: SOFT }}>pasif</span>}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right">
                      <PlanInput value={planDraft[row.categoryId] ?? ''} onChange={(v) => setPlanDraft((old) => ({ ...old, [row.categoryId]: v }))} />
                    </td>
                    <td className="px-3 py-4 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{fmt(row.actual)} ₺</td>
                    <td className="px-3 py-4 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: farkColor }}>{(row.variance >= 0 ? '+' : '') + fmt(row.variance)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 overflow-hidden rounded-full" style={{ height: 6, background: 'rgba(255,255,255,0.07)' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(oran, 100)}%`, background: barColor }} />
                        </div>
                        <span className="text-[12.5px] font-semibold w-12 text-right" style={{ color: '#a1a1aa', fontVariantNumeric: 'tabular-nums' }}>%{oran.toFixed(0)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-center text-[12px]" style={{ color: '#52525b' }}>
        Fark = gerçekleşen − plan · gider kaleminde plan aşımı <span style={{ color: DEBT }}>bordo</span>
      </p>

      {/* KATEGORİLER MODALI */}
      {showCategoriesModal && (
        <Modal title="Kategoriler" onClose={() => setShowCategoriesModal(false)}>
          <div className="space-y-3">
            {/* Yeni kategori */}
            <div className="rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
              <div className="text-[12.5px] font-semibold mb-2" style={{ color: TEXT }}>Yeni Kategori</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button onClick={() => setCategoryForm((old) => ({ ...old, type: 'GELIR', color: '#5ad18a' }))} className="py-2 rounded-lg text-[13px] font-bold" style={{ background: categoryForm.type === 'GELIR' ? 'rgba(90,209,138,0.14)' : 'rgba(255,255,255,0.04)', color: categoryForm.type === 'GELIR' ? OK : SOFT, border: `1px solid ${categoryForm.type === 'GELIR' ? 'rgba(90,209,138,0.30)' : 'rgba(255,255,255,0.08)'}` }}>Gelir</button>
                <button onClick={() => setCategoryForm((old) => ({ ...old, type: 'GIDER', color: '#e0697a' }))} className="py-2 rounded-lg text-[13px] font-bold" style={{ background: categoryForm.type === 'GIDER' ? 'rgba(224,105,122,0.14)' : 'rgba(255,255,255,0.04)', color: categoryForm.type === 'GIDER' ? DEBT : SOFT, border: `1px solid ${categoryForm.type === 'GIDER' ? 'rgba(224,105,122,0.30)' : 'rgba(255,255,255,0.08)'}` }}>Gider</button>
              </div>
              <div className="grid grid-cols-[1fr_56px] gap-2">
                <input value={categoryForm.name} onChange={(e) => setCategoryForm((old) => ({ ...old, name: e.target.value }))} placeholder="Kategori adı" className="w-full px-3 py-2 rounded-lg" style={inputStyle} />
                <input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm((old) => ({ ...old, color: e.target.value }))} className="h-[38px] w-full rounded-lg" style={{ ...inputStyle, padding: 4 }} />
              </div>
              <button onClick={saveCategory} disabled={savingCategory} className="mt-2 w-full py-2 rounded-lg text-[13px] font-bold disabled:opacity-60" style={{ background: 'rgba(230,200,120,0.14)', color: GOLD, border: '1px solid rgba(230,200,120,0.34)' }}>
                {savingCategory ? <Loader2 size={13} className="animate-spin inline" /> : <><Plus size={13} className="inline mr-1" /> Kategori Ekle</>}
              </button>
            </div>

            {/* Mevcut kategoriler */}
            <div className="max-h-[360px] overflow-auto space-y-2 pr-1">
              {data.categoryRows.map((row) => {
                const category = categoriesById.get(row.categoryId);
                const draft = categoryDrafts[row.categoryId] || {
                  name: row.name,
                  color: row.color || (row.type === 'GELIR' ? OK : DEBT),
                  sortOrder: String(category?.sortOrder ?? 100),
                  isActive: row.isActive,
                };
                const editing = editingCategoryId === row.categoryId;
                const color = draft.color || (row.type === 'GELIR' ? OK : DEBT);
                return (
                  <div key={row.categoryId} className="rounded-xl p-3" style={{ border: `1px solid ${editing ? 'rgba(230,200,120,0.38)' : 'rgba(255,255,255,0.08)'}`, background: 'rgba(255,255,255,0.02)' }}>
                    {editing ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-[1fr_56px] gap-2">
                          <input value={draft.name} onChange={(e) => setCategoryDrafts((old) => ({ ...old, [row.categoryId]: { ...draft, name: e.target.value } }))} className="w-full px-3 py-2 rounded-lg" style={inputStyle} />
                          <input type="color" value={color} onChange={(e) => setCategoryDrafts((old) => ({ ...old, [row.categoryId]: { ...draft, color: e.target.value } }))} className="h-[38px] w-full rounded-lg" style={{ ...inputStyle, padding: 4 }} />
                        </div>
                        <div className="grid grid-cols-[80px_1fr] gap-2">
                          <input type="number" value={draft.sortOrder} onChange={(e) => setCategoryDrafts((old) => ({ ...old, [row.categoryId]: { ...draft, sortOrder: e.target.value } }))} className="w-full px-3 py-2 rounded-lg" style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} />
                          <button onClick={() => setCategoryDrafts((old) => ({ ...old, [row.categoryId]: { ...draft, isActive: !draft.isActive } }))} className="rounded-lg px-3 py-2 text-[12.5px] font-bold" style={{ background: draft.isActive ? 'rgba(90,209,138,0.12)' : 'rgba(255,255,255,0.05)', color: draft.isActive ? OK : SOFT, border: '1px solid rgba(255,255,255,0.10)' }}>
                            {draft.isActive ? 'Aktif' : 'Pasif'}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => saveCategoryEdit(row)} disabled={savingCategoryId === row.categoryId} className="rounded-lg px-3 py-2 text-[12.5px] font-bold disabled:opacity-60" style={{ background: 'rgba(230,200,120,0.14)', color: GOLD, border: '1px solid rgba(230,200,120,0.34)' }}>
                            {savingCategoryId === row.categoryId ? <Loader2 size={13} className="animate-spin inline" /> : <><Check size={13} className="inline mr-1" /> Kaydet</>}
                          </button>
                          <button onClick={() => setEditingCategoryId(null)} className="rounded-lg px-3 py-2 text-[12.5px] font-bold" style={{ background: 'rgba(255,255,255,0.05)', color: TEXT, border: '1px solid rgba(255,255,255,0.10)' }}>
                            <X size={13} className="inline mr-1" /> Vazgeç
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color || color }} />
                            <span className="truncate text-[14px] font-semibold" style={{ color: row.isActive ? '#fff' : SOFT }}>{row.name}</span>
                            <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: row.type === 'GELIR' ? 'rgba(90,209,138,0.12)' : 'rgba(224,105,122,0.13)', color: row.type === 'GELIR' ? OK : DEBT }}>{row.type}</span>
                          </div>
                          <div className="mt-1 text-[11.5px]" style={{ color: SOFT }}>Sıra {category?.sortOrder ?? 100} · {row.isActive ? 'Aktif' : 'Pasif'}</div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button onClick={() => setEditingCategoryId(row.categoryId)} className="rounded-lg p-2" style={{ color: GOLD, background: 'rgba(230,200,120,0.10)' }} title="Düzenle"><Edit3 size={14} /></button>
                          <button onClick={() => toggleCategoryActive(row)} disabled={savingCategoryId === row.categoryId} className="rounded-lg p-2 disabled:opacity-50" style={{ color: row.isActive ? DEBT : OK, background: row.isActive ? 'rgba(224,105,122,0.10)' : 'rgba(90,209,138,0.10)' }} title={row.isActive ? 'Pasifleştir' : 'Aktifleştir'}>
                            {savingCategoryId === row.categoryId ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PlanInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative ml-auto w-[140px]">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(formatMoneyDraft(value))}
        className="h-9 w-full rounded-lg py-1.5 pl-3 pr-8 text-right"
        style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] font-bold" style={{ color: SOFT }}>₺</span>
    </div>
  );
}

// ====================================================================
// İSTATİSTİK
// ====================================================================
export function IstatistikView() {
  const { data, isLoading } = useQuery<Istatistik>({
    queryKey: ['cari-istatistikler'],
    queryFn: () => api.get('/cari-kasa/istatistikler').then((r) => r.data),
    refetchInterval: 60000,
  });

  if (isLoading || !data) return <LoadingPanel />;

  const kpi = data.kpi;
  const trend = data.trend || [];
  const maxTrend = Math.max(...trend.map((t) => Math.max(t.tahakkuk, t.tahsilat)), 1);

  const odeme = data.odemeYontemi || [];
  const odemeToplam = odeme.reduce((s, o) => s + o.tutar, 0);
  const odemePalette = ['#e6c878', '#d4b876', '#5ad18a', '#9b9ba3', '#e0697a', '#6f6f77'];

  const borclular = data.enBorclular || [];
  const hasData = trend.some((t) => t.tahakkuk || t.tahsilat) || odeme.length > 0 || borclular.length > 0;

  const milyon = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + 'K';
    return fmt(n);
  };

  return (
    <div style={{ fontFamily: SANS }}>
      <ViewHeader icon={BarChart3} title="İstatistik" subtitle="Son 12 ay · genel bakış" />

      {!hasData ? (
        <div className="mt-6"><EmptyState label="Henüz istatistik için yeterli hareket yok." /></div>
      ) : (
        <>
          {/* KPI */}
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="12 Ay Tahakkuk" value={milyon(kpi.toplamTahakkuk12Ay)} color={OK} />
            <KpiCard label="12 Ay Tahsilat" value={milyon(kpi.toplamTahsilat12Ay)} color={DEBT} />
            <KpiCard label="Net" value={(kpi.toplamTahsilat12Ay - kpi.toplamTahakkuk12Ay >= 0 ? '+' : '') + milyon(kpi.toplamTahsilat12Ay - kpi.toplamTahakkuk12Ay)} color={GOLD} accent />
            <KpiCard label="Tahsilat Oranı" value={'%' + kpi.tahsilatOrani.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} color={OK} suffix="" />
          </div>

          {/* BAR CHART */}
          <div className="mt-6 rounded-2xl px-5 sm:px-6 py-5" style={cardline}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[14px] font-semibold" style={{ color: TEXT }}>Son 12 ay · tahakkuk / tahsilat</div>
              <div className="flex items-center gap-4 text-[12px]" style={{ color: '#a1a1aa' }}>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OK }} />Tahakkuk</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DEBT }} />Tahsilat</span>
              </div>
            </div>
            <div className="mt-7 flex items-end justify-between gap-2 sm:gap-3" style={{ height: 200 }}>
              {trend.map((m) => (
                <div key={m.ay} className="flex h-full flex-1 items-end justify-center gap-[3px] sm:gap-1.5" title={`${ayKisaLabel(m.ay)} · Tahakkuk ${fmt(m.tahakkuk)} ₺ · Tahsilat ${fmt(m.tahsilat)} ₺`}>
                  <div className="w-full max-w-[14px]" style={{ height: `${Math.max(2, (m.tahakkuk / maxTrend) * 100)}%`, background: OK, borderRadius: '5px 5px 2px 2px' }} />
                  <div className="w-full max-w-[14px]" style={{ height: `${Math.max(2, (m.tahsilat / maxTrend) * 100)}%`, background: DEBT, borderRadius: '5px 5px 2px 2px' }} />
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 sm:gap-3 text-[11px]" style={{ color: SOFT }}>
              {trend.map((m) => <div key={m.ay} className="flex-1 text-center" style={{ fontVariantNumeric: 'tabular-nums' }}>{ayKisaLabel(m.ay)}</div>)}
            </div>
          </div>

          {/* İKİ KOLON */}
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Ödeme yöntemi dağılımı */}
            <div className="rounded-2xl px-5 sm:px-6 py-5" style={cardline}>
              <div className="text-[14px] font-semibold" style={{ color: TEXT }}>Tahsilat · ödeme yöntemi dağılımı</div>
              {odeme.length === 0 ? (
                <div className="mt-5 text-[13px]" style={{ color: SOFT }}>Tahsilat kaydı yok.</div>
              ) : (
                <div className="mt-5 space-y-4">
                  {odeme.map((o, i) => {
                    const pct = odemeToplam > 0 ? Math.round((o.tutar / odemeToplam) * 100) : 0;
                    return (
                      <div key={o.yontem}>
                        <div className="flex items-center justify-between text-[13px]">
                          <span style={{ color: '#d4d4d8' }}>{odemeYontemiLabel(o.yontem)}</span>
                          <span className="font-semibold" style={{ color: TEXT, fontVariantNumeric: 'tabular-nums' }}>%{pct} · {fmt(o.tutar)} ₺</span>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: odemePalette[i % odemePalette.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* En borçlu mükellefler */}
            <div className="rounded-2xl px-5 sm:px-6 py-5" style={cardline}>
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-semibold" style={{ color: TEXT }}>En borçlu mükellefler</div>
                <div className="text-[12px]" style={{ color: SOFT }}>{kpi.borcluMukellefAdet} borçlu · {fmt(kpi.toplamAktifBorc)} ₺</div>
              </div>
              {borclular.length === 0 ? (
                <div className="mt-4 text-[13px]" style={{ color: SOFT }}>Borçlu mükellef yok.</div>
              ) : (
                <div className="mt-3">
                  {borclular.map((d) => (
                    <div key={d.id} className="flex items-center justify-between py-3" style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                      <div className="min-w-0">
                        <div className="text-[14px] truncate" style={{ color: '#e4e4e7' }}>{d.ad}</div>
                        {d.taxNumber && <div className="text-[11.5px]" style={{ color: SOFT, fontVariantNumeric: 'tabular-nums' }}>{d.taxNumber}</div>}
                      </div>
                      <span className="text-[14px] font-bold whitespace-nowrap ml-3" style={{ color: DEBT, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.bakiye)} ₺</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default KasaBankaView;
