'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarDays,
  Landmark,
  Loader2,
  Plus,
  Save,
  Trash2,
  Wallet,
} from 'lucide-react';

const GOLD = '#d4b876';
const BLUE = '#60a5fa';
const GREEN = '#4ade80';
const RED = '#f87171';
const TEXT = '#f8fafc';
const MUTED = '#cbd5e1';
const SOFT = '#a8b0bc';
const DIM = '#7d8794';
const SURFACE = 'rgba(255,255,255,0.045)';
const BORDER = 'rgba(255,255,255,0.14)';

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

const fmt = (n: number | null | undefined) => {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const today = () => new Date().toISOString().slice(0, 10);
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

const panel: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
};
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.065)',
  border: `1px solid ${BORDER}`,
  color: TEXT,
  outline: 'none',
  fontSize: 14,
  fontWeight: 600,
};

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

function PeriodToolbar({ year, period, onYear, onPeriod }: {
  year: number;
  period: string;
  onYear: (year: number) => void;
  onPeriod: (period: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-[8px]" style={panel}>
        <CalendarDays size={16} style={{ color: GOLD }} />
        <select
          value={year}
          onChange={(e) => onYear(Number(e.target.value))}
          className="rounded-[6px] px-3 py-1.5"
          style={inputStyle}
        >
          {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={period}
          onChange={(e) => onPeriod(e.target.value)}
          className="rounded-[6px] px-3 py-1.5"
          style={inputStyle}
        >
          {monthsOf(year).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color, icon: Icon, sub }: {
  label: string;
  value: number;
  color: string;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="rounded-[10px] p-4" style={panel}>
      <div className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: MUTED }}>
        <Icon size={16} style={{ color }} /> {label}
      </div>
      <div className="mt-2 text-[28px] font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>
        {fmt(value)} TL
      </div>
      {sub && <div className="mt-1 text-[12.5px] font-medium" style={{ color: SOFT }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-[12.5px] font-semibold" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function LoadingPanel({ label = 'Hesaplanıyor...' }: { label?: string }) {
  return (
    <div className="py-12 text-center text-[14px] font-medium" style={{ color: MUTED }}>
      <Loader2 className="animate-spin inline mr-2" size={16} />{label}
    </div>
  );
}

export function KasaBankaView() {
  const qc = useQueryClient();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod());
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

  const maxMonth = Math.max(...data.months.map((m) => Math.max(m.income, m.expense)), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[.08em]" style={{ color: GOLD }}>Kasa/Banka Defteri</div>
          <h2 className="text-[24px] font-semibold mt-1" style={{ color: TEXT }}>Hesap bakiyesi ve nakit akışı</h2>
        </div>
        <PeriodToolbar
          year={year}
          period={period}
          onYear={(next) => { setYear(next); setPeriod(`${next}-${period.slice(5, 7)}`); }}
          onPeriod={setPeriod}
        />
      </div>

      {data.kpi.unassignedCollectionsCount > 0 && (
        <div className="rounded-[10px] px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)' }}>
          <div className="text-[14px] font-medium" style={{ color: '#fde68a' }}>
            {data.kpi.unassignedCollectionsCount} eski tahsilatın hesabı atanmamış. Toplam {fmt(data.kpi.unassignedCollectionsAmount)} TL kasa/banka bakiyesine dahil edilmedi.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard label="Toplam Bakiye" value={data.kpi.totalBalance} color={GOLD} icon={Wallet} />
        <MetricCard label="Bu Ay Gelir" value={data.kpi.monthIncome} color={GREEN} icon={ArrowDownLeft} />
        <MetricCard label="Bu Ay Gider" value={data.kpi.monthExpense} color={RED} icon={ArrowUpRight} />
        <MetricCard label="Net Durum" value={data.kpi.monthNet} color={data.kpi.monthNet >= 0 ? BLUE : RED} icon={Banknote} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {accounts.map((account) => (
          <div key={account.id} className="rounded-[10px] p-4" style={{ ...panel, borderColor: `${account.color || GOLD}55` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {account.type === 'NAKIT' ? <Wallet size={17} style={{ color: account.color }} /> : <Landmark size={17} style={{ color: account.color }} />}
                <div className="text-[17px] font-semibold truncate" style={{ color: TEXT }}>{account.name}</div>
              </div>
              <span className="text-[12px] font-semibold px-2.5 py-1 rounded-[6px]" style={{ background: 'rgba(255,255,255,0.08)', color: MUTED }}>{account.type}</span>
            </div>
            <div className="mt-4 text-[30px] font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: account.color || GOLD }}>
              {fmt(account.currentBalance)} TL
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <MiniStat label="Giriş" value={account.monthInflow} color={GREEN} />
              <MiniStat label="Çıkış" value={account.monthOutflow} color={RED} />
              <MiniStat label="Net" value={account.monthNet} color={account.monthNet >= 0 ? BLUE : RED} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <div className="rounded-[10px] p-4" style={panel}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>Ay Bazında Akış</h3>
              <span className="text-[13px] font-medium" style={{ color: SOFT }}>Transferler gelir/gider toplamını bozmaz</span>
            </div>
            <div className="flex items-end gap-1.5 h-[180px]">
              {data.months.map((m) => (
                <div key={m.period} className="flex-1 min-w-[34px]">
                  <div className="h-[148px] flex items-end gap-0.5">
                    <div className="flex-1 rounded-t-[3px]" style={{ height: `${Math.max(3, (m.income / maxMonth) * 148)}px`, background: GREEN }} />
                    <div className="flex-1 rounded-t-[3px]" style={{ height: `${Math.max(3, (m.expense / maxMonth) * 148)}px`, background: RED }} />
                  </div>
                  <div className="text-[11.5px] font-semibold text-center mt-1" style={{ color: m.period === period ? GOLD : SOFT }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[10px] overflow-hidden" style={panel}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>Bu Ay Hareketleri</h3>
              <span className="text-[13px] font-medium" style={{ color: SOFT }}>{data.recentEntries.length} kayıt</span>
            </div>
            <MovementTable entries={data.recentEntries} transfers={data.transfers} onDeleteTransfer={deleteTransfer} />
          </div>
        </div>

        <div className="space-y-3">
          <EntryForm
            form={entryForm}
            setForm={setEntryForm}
            accounts={accounts}
            categories={entryCategories}
            saving={savingEntry}
            onSave={saveEntry}
          />
          <TransferForm
            form={transferForm}
            setForm={setTransferForm}
            accounts={accounts}
            saving={savingTransfer}
            onSave={saveTransfer}
          />
          <AccountForm
            form={accountForm}
            setForm={setAccountForm}
            saving={savingAccount}
            onSave={saveAccount}
          />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-[8px] p-2.5" style={{ background: 'rgba(255,255,255,0.065)' }}>
      <div className="text-[12px] font-semibold" style={{ color: MUTED }}>{label}</div>
      <div className="mt-1 text-[15px] font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>{fmt(value)}</div>
    </div>
  );
}

function EntryForm({ form, setForm, accounts, categories, saving, onSave }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  accounts: FinancialAccount[];
  categories: BudgetCategory[];
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="rounded-[10px] p-4" style={panel}>
      <div className="flex items-center gap-2 mb-3">
        <Plus size={17} style={{ color: GOLD }} />
        <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>Gelir / Gider Girişi</h3>
      </div>
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setForm((old: any) => ({ ...old, type: 'GELIR' }))} className="py-2.5 rounded-[8px] text-[14px] font-bold" style={{ background: form.type === 'GELIR' ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.06)', color: form.type === 'GELIR' ? GREEN : MUTED, border: `1px solid ${BORDER}` }}>Gelir</button>
          <button onClick={() => setForm((old: any) => ({ ...old, type: 'GIDER' }))} className="py-2.5 rounded-[8px] text-[14px] font-bold" style={{ background: form.type === 'GIDER' ? 'rgba(248,113,113,0.22)' : 'rgba(255,255,255,0.06)', color: form.type === 'GIDER' ? RED : MUTED, border: `1px solid ${BORDER}` }}>Gider</button>
        </div>
        <Field label="Hesap">
          <select value={form.accountId} onChange={(e) => setForm((old: any) => ({ ...old, accountId: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle}>
            <option value="">Hesap seçin</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Kategori">
          <select value={form.categoryId} onChange={(e) => setForm((old: any) => ({ ...old, categoryId: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle}>
            <option value="">Kategori seçin</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tarih"><input type="date" value={form.date} onChange={(e) => setForm((old: any) => ({ ...old, date: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle} /></Field>
          <Field label="Tutar"><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((old: any) => ({ ...old, amount: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-[8px] tabular-nums" style={inputStyle} /></Field>
        </div>
        <Field label="Açıklama"><input value={form.description} onChange={(e) => setForm((old: any) => ({ ...old, description: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle} /></Field>
        <button onClick={onSave} disabled={saving} className="w-full py-2.5 rounded-[8px] text-[14px] font-bold disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
          {saving ? <Loader2 size={14} className="animate-spin inline" /> : <><Save size={14} className="inline mr-1" /> Kaydet</>}
        </button>
      </div>
    </div>
  );
}

function TransferForm({ form, setForm, accounts, saving, onSave }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  accounts: FinancialAccount[];
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="rounded-[10px] p-4" style={panel}>
      <div className="flex items-center gap-2 mb-3">
        <ArrowRightLeft size={17} style={{ color: BLUE }} />
        <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>Hesaplar Arası Transfer</h3>
      </div>
      <div className="space-y-2.5">
        <Field label="Çıkış Hesabı">
          <select value={form.fromAccountId} onChange={(e) => setForm((old: any) => ({ ...old, fromAccountId: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Giriş Hesabı">
          <select value={form.toAccountId} onChange={(e) => setForm((old: any) => ({ ...old, toAccountId: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tarih"><input type="date" value={form.date} onChange={(e) => setForm((old: any) => ({ ...old, date: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle} /></Field>
          <Field label="Tutar"><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((old: any) => ({ ...old, amount: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-[8px] tabular-nums" style={inputStyle} /></Field>
        </div>
        <Field label="Açıklama"><input value={form.description} onChange={(e) => setForm((old: any) => ({ ...old, description: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle} /></Field>
        <button onClick={onSave} disabled={saving} className="w-full py-2.5 rounded-[8px] text-[14px] font-bold disabled:opacity-50" style={{ background: 'rgba(96,165,250,0.18)', color: '#bfdbfe', border: '1px solid rgba(96,165,250,0.34)' }}>
          {saving ? <Loader2 size={14} className="animate-spin inline" /> : 'Transferi İşle'}
        </button>
      </div>
    </div>
  );
}

function AccountForm({ form, setForm, saving, onSave }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="rounded-[10px] p-4" style={panel}>
      <div className="flex items-center gap-2 mb-3">
        <Building2 size={17} style={{ color: GOLD }} />
        <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>Yeni Hesap</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Ad"><input value={form.name} onChange={(e) => setForm((old: any) => ({ ...old, name: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle} /></Field>
        <Field label="Tür">
          <select value={form.type} onChange={(e) => setForm((old: any) => ({ ...old, type: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle}>
            <option value="BANKA">Banka</option>
            <option value="NAKIT">Nakit</option>
            <option value="KREDI_KARTI">Kredi Kartı</option>
            <option value="DIGER">Diğer</option>
          </select>
        </Field>
        <Field label="Açılış"><input type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm((old: any) => ({ ...old, openingBalance: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-[8px] tabular-nums" style={inputStyle} /></Field>
        <Field label="Renk"><input type="color" value={form.color} onChange={(e) => setForm((old: any) => ({ ...old, color: e.target.value }))} className="w-full h-[36px] rounded-[8px]" style={{ ...inputStyle, padding: 4 }} /></Field>
      </div>
      <button onClick={onSave} disabled={saving} className="mt-3 w-full py-2.5 rounded-[8px] text-[14px] font-bold disabled:opacity-50" style={{ background: 'rgba(212,184,118,0.16)', color: GOLD, border: '1px solid rgba(212,184,118,0.36)' }}>
        {saving ? <Loader2 size={14} className="animate-spin inline" /> : 'Hesap Ekle'}
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
    return <div className="py-8 text-center text-[14px] font-medium" style={{ color: SOFT }}>Bu ay hareket yok.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr style={{ color: MUTED }}>
            <th className="px-4 py-2 text-left">Tarih</th>
            <th className="px-4 py-2 text-left">İşlem</th>
            <th className="px-4 py-2 text-left">Hesap / Kategori</th>
            <th className="px-4 py-2 text-left">Açıklama</th>
            <th className="px-4 py-2 text-right">Tutar</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => {
            const isTransfer = row.rowType === 'TRANSFER';
            const color = isTransfer ? BLUE : row.type === 'GELIR' ? GREEN : RED;
            return (
              <tr key={`${row.rowType}-${row.id}`} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: TEXT }}>
                <td className="px-4 py-2 tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{new Date(row.date).toLocaleDateString('tr-TR')}</td>
                <td className="px-4 py-2"><span className="px-2.5 py-1 rounded-[6px] text-[11.5px] font-bold" style={{ background: `${color}24`, color }}>{isTransfer ? 'TRANSFER' : row.type}</span></td>
                <td className="px-4 py-2 font-medium" style={{ color: TEXT }}>
                  {isTransfer ? `${row.fromAccount?.name} → ${row.toAccount?.name}` : `${row.account?.name || 'Hesapsız'} / ${row.category?.name || 'Cari Tahsilat'}`}
                </td>
                <td className="px-4 py-2 truncate max-w-[320px]" style={{ color: SOFT }}>{row.description || '-'}</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>{fmt(row.amount)} TL</td>
                <td className="px-3 py-2 text-right">
                  {isTransfer && <button onClick={() => onDeleteTransfer(row.id)} className="p-1.5 rounded-[6px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.10)' }}><Trash2 size={12} /></button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GelirGiderTablosuView() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod());
  const { data, isLoading } = useBudgetSummary(year, period);
  if (isLoading || !data) return <LoadingPanel />;

  const rows = data.categoryMonthlyRows || data.categoryRows;
  const incomeRows = rows.filter((r) => r.type === 'GELIR');
  const expenseRows = rows.filter((r) => r.type === 'GIDER');

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[.08em]" style={{ color: GOLD }}>Gelir-Gider Tablosu</div>
          <h2 className="text-[24px] font-semibold mt-1" style={{ color: TEXT }}>Ay ay kategori toplamları</h2>
        </div>
        <PeriodToolbar year={year} period={period} onYear={(next) => { setYear(next); setPeriod(`${next}-${period.slice(5, 7)}`); }} onPeriod={setPeriod} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard label="Yıllık Gelir" value={data.kpi.annualIncome} color={GREEN} icon={ArrowDownLeft} />
        <MetricCard label="Yıllık Gider" value={data.kpi.annualExpense} color={RED} icon={ArrowUpRight} />
        <MetricCard label="Yıllık Net" value={data.kpi.annualNet} color={data.kpi.annualNet >= 0 ? BLUE : RED} icon={Banknote} />
        <MetricCard label="Plan Farkı" value={data.kpi.periodVariance} color={data.kpi.periodVariance >= 0 ? GOLD : RED} icon={Wallet} sub={period} />
      </div>

      <CategoryMatrix title="Gelir Kalemleri" rows={incomeRows} months={data.months} color={GREEN} />
      <CategoryMatrix title="Gider Kalemleri" rows={expenseRows} months={data.months} color={RED} />

      <div className="rounded-[10px] overflow-hidden" style={panel}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>{period} hareket detayları</h3>
        </div>
        <MovementTable entries={data.entries} transfers={[]} onDeleteTransfer={() => undefined} />
      </div>
    </div>
  );
}

function CategoryMatrix({ title, rows, months, color }: { title: string; rows: BudgetCategoryRow[]; months: BudgetMonth[]; color: string }) {
  return (
    <div className="rounded-[10px] overflow-hidden" style={panel}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>{title}</h3>
        <span className="text-[13px] font-medium" style={{ color: SOFT }}>{rows.length} kalem</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[1120px]">
          <thead>
            <tr style={{ color: MUTED, background: 'rgba(255,255,255,0.035)' }}>
              <th className="px-3 py-2 text-left w-[210px]">Kalem</th>
              {months.map((m) => <th key={m.period} className="px-2 py-2 text-right">{m.label}</th>)}
              <th className="px-3 py-2 text-right">Yıl Toplam</th>
              <th className="px-3 py-2 text-right">Plan</th>
              <th className="px-3 py-2 text-right">Fark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.categoryId} style={{ borderTop: '1px solid rgba(255,255,255,0.07)', color: TEXT }}>
                <td className="px-3 py-2 font-semibold">
                  <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: row.color || color }} />
                  {row.name}
                </td>
                {months.map((m) => {
                  const cell = row.months?.find((x) => x.period === m.period);
                  return (
                    <td key={m.period} className="px-2 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: cell?.actual ? color : DIM }}>
                      {cell?.actual ? fmt(cell.actual) : '-'}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>{fmt(row.annualActual)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: MUTED }}>{fmt(row.annualPlanned)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: row.annualActual - row.annualPlanned >= 0 ? GREEN : RED }}>{fmt(row.annualActual - row.annualPlanned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ButcePlanView() {
  const qc = useQueryClient();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod());
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [categoryForm, setCategoryForm] = useState({ type: 'GIDER' as 'GELIR' | 'GIDER', name: '', color: '#ef4444' });
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const { data, isLoading } = useBudgetSummary(year, period);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const row of data.categoryRows) next[row.categoryId] = row.planned ? String(row.planned) : '';
    setPlanDraft(next);
  }, [data?.period, data?.categoryRows]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });

  const savePlans = async () => {
    if (!data) return;
    setSavingPlan(true);
    try {
      await api.put('/cari-kasa/budget/plans', {
        period,
        items: data.categoryRows
          .filter((r) => r.isActive)
          .map((r) => ({ categoryId: r.categoryId, plannedAmount: Number(planDraft[r.categoryId] || 0) })),
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

  if (isLoading || !data) return <LoadingPanel />;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[.08em]" style={{ color: GOLD }}>Bütçe Planı</div>
          <h2 className="text-[24px] font-semibold mt-1" style={{ color: TEXT }}>Planlanan ve gerçekleşen karşılaştırması</h2>
        </div>
        <PeriodToolbar year={year} period={period} onYear={(next) => { setYear(next); setPeriod(`${next}-${period.slice(5, 7)}`); }} onPeriod={setPeriod} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard label="Plan Gelir" value={data.kpi.periodPlannedIncome} color={GREEN} icon={ArrowDownLeft} />
        <MetricCard label="Gerçek Gelir" value={data.kpi.periodIncome} color={GREEN} icon={Banknote} />
        <MetricCard label="Plan Gider" value={data.kpi.periodPlannedExpense} color={RED} icon={ArrowUpRight} />
        <MetricCard label="Gerçek Gider" value={data.kpi.periodExpense} color={RED} icon={Wallet} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="rounded-[10px] overflow-hidden" style={panel}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-[16px] font-semibold" style={{ color: TEXT }}>{period} plan tablosu</h3>
            <button onClick={savePlans} disabled={savingPlan} className="px-3.5 py-2 rounded-[8px] text-[14px] font-bold disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
              {savingPlan ? <Loader2 size={13} className="animate-spin inline" /> : <><Save size={13} className="inline mr-1" /> Planı Kaydet</>}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr style={{ color: MUTED }}>
                  <th className="px-4 py-2 text-left">Kalem</th>
                  <th className="px-4 py-2 text-right">Plan</th>
                  <th className="px-4 py-2 text-right">Gerçekleşen</th>
                  <th className="px-4 py-2 text-right">Fark</th>
                  <th className="px-4 py-2 text-right">Oran</th>
                </tr>
              </thead>
              <tbody>
                {data.categoryRows.map((row) => {
                  const color = row.type === 'GELIR' ? GREEN : RED;
                  return (
                    <tr key={row.categoryId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: TEXT }}>
                      <td className="px-4 py-2 font-semibold"><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: row.color || color }} />{row.name}</td>
                      <td className="px-4 py-2 text-right"><input type="number" step="0.01" value={planDraft[row.categoryId] ?? ''} onChange={(e) => setPlanDraft((old) => ({ ...old, [row.categoryId]: e.target.value }))} className="w-[120px] px-2 py-1.5 rounded-[7px] text-right tabular-nums" style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace' }} /></td>
                      <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>{fmt(row.actual)}</td>
                      <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: row.variance >= 0 ? GREEN : RED }}>{fmt(row.variance)}</td>
                      <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: MUTED }}>%{row.realizationPct.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[10px] p-4 h-fit" style={panel}>
          <h3 className="text-[16px] font-semibold mb-3" style={{ color: TEXT }}>Kategori Ekle</h3>
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCategoryForm((old) => ({ ...old, type: 'GELIR', color: '#4ade80' }))} className="py-2.5 rounded-[8px] text-[14px] font-bold" style={{ background: categoryForm.type === 'GELIR' ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.06)', color: categoryForm.type === 'GELIR' ? GREEN : MUTED, border: `1px solid ${BORDER}` }}>Gelir</button>
              <button onClick={() => setCategoryForm((old) => ({ ...old, type: 'GIDER', color: '#ef4444' }))} className="py-2.5 rounded-[8px] text-[14px] font-bold" style={{ background: categoryForm.type === 'GIDER' ? 'rgba(248,113,113,0.22)' : 'rgba(255,255,255,0.06)', color: categoryForm.type === 'GIDER' ? RED : MUTED, border: `1px solid ${BORDER}` }}>Gider</button>
            </div>
            <Field label="Kategori Adı"><input value={categoryForm.name} onChange={(e) => setCategoryForm((old) => ({ ...old, name: e.target.value }))} className="w-full px-3 py-2 rounded-[8px]" style={inputStyle} /></Field>
            <Field label="Renk"><input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm((old) => ({ ...old, color: e.target.value }))} className="w-full h-[36px] rounded-[8px]" style={{ ...inputStyle, padding: 4 }} /></Field>
            <button onClick={saveCategory} disabled={savingCategory} className="w-full py-2.5 rounded-[8px] text-[14px] font-bold disabled:opacity-50" style={{ background: 'rgba(212,184,118,0.16)', color: GOLD, border: '1px solid rgba(212,184,118,0.36)' }}>
              {savingCategory ? <Loader2 size={14} className="animate-spin inline" /> : 'Kategori Ekle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KasaBankaView;
