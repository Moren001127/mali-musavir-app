'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  BarChart3,
  Loader2,
  Plus,
  Save,
  Tags,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';

const GOLD = '#d4b876';
const BORDO = '#9c4656';

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
  plannedIncome: number;
  plannedExpense: number;
  plannedNet: number;
  variance: number;
};

type BudgetCategoryRow = {
  categoryId: string;
  name: string;
  type: 'GELIR' | 'GIDER';
  color: string;
  icon?: string | null;
  isActive: boolean;
  planned: number;
  actual: number;
  variance: number;
  realizationPct: number;
  annualActual: number;
  annualPlanned: number;
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
  category?: { id: string; name: string; color: string; type: 'GELIR' | 'GIDER' } | null;
};

type BudgetSummary = {
  year: number;
  period: string;
  categories: BudgetCategory[];
  months: BudgetMonth[];
  categoryRows: BudgetCategoryRow[];
  entries: BudgetEntry[];
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

const fmt = (n: number | null | undefined) => {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const today = () => new Date().toISOString().slice(0, 10);
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#fafaf9',
  outline: 'none',
  fontSize: 13,
};

export default function ButceTakipView() {
  const qc = useQueryClient();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState(currentPeriod());
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [entryForm, setEntryForm] = useState({
    type: 'GIDER' as 'GELIR' | 'GIDER',
    categoryId: '',
    date: today(),
    amount: 0,
    description: '',
    paymentMethod: 'HAVALE',
    documentNo: '',
  });
  const [categoryForm, setCategoryForm] = useState({
    type: 'GIDER' as 'GELIR' | 'GIDER',
    name: '',
    color: '#ef4444',
  });

  const { data, isLoading } = useQuery<BudgetSummary>({
    queryKey: ['cari-budget-summary', year, period],
    queryFn: () => api.get('/cari-kasa/budget/summary', { params: { year, period } }).then((r) => r.data),
    refetchInterval: 60000,
  });

  const categories = useMemo(
    () => (data?.categories || []).filter((c) => c.isActive),
    [data?.categories],
  );
  const entryCategories = useMemo(
    () => categories.filter((c) => c.type === entryForm.type),
    [categories, entryForm.type],
  );

  useEffect(() => {
    if (!entryCategories.length) return;
    if (!entryCategories.some((c) => c.id === entryForm.categoryId)) {
      setEntryForm((old) => ({ ...old, categoryId: entryCategories[0].id }));
    }
  }, [entryCategories, entryForm.categoryId]);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const row of data.categoryRows) next[row.categoryId] = String(row.planned || '');
    setPlanDraft(next);
  }, [data?.period, data?.categoryRows]);

  const invalidateBudget = () => {
    qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });
  };

  const changeYear = (value: number) => {
    const safe = Number.isFinite(value) ? value : new Date().getFullYear();
    setYear(safe);
    setPeriod(`${safe}-${period.slice(5, 7)}`);
  };

  const saveEntry = async () => {
    if (!entryForm.categoryId) { toast.error('Kategori seçin'); return; }
    if (entryForm.amount <= 0) { toast.error('Tutar pozitif olmalı'); return; }
    setSavingEntry(true);
    try {
      await api.post('/cari-kasa/budget/entries', {
        categoryId: entryForm.categoryId,
        date: entryForm.date,
        amount: entryForm.amount,
        description: entryForm.description || undefined,
        paymentMethod: entryForm.paymentMethod || undefined,
        documentNo: entryForm.documentNo || undefined,
      });
      toast.success('Bütçe hareketi eklendi');
      setEntryForm((old) => ({ ...old, amount: 0, description: '', documentNo: '' }));
      invalidateBudget();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kaydedilemedi');
    } finally {
      setSavingEntry(false);
    }
  };

  const savePlans = async () => {
    if (!data) return;
    setSavingPlan(true);
    try {
      await api.put('/cari-kasa/budget/plans', {
        period,
        items: data.categoryRows
          .filter((r) => r.isActive)
          .map((r) => ({
            categoryId: r.categoryId,
            plannedAmount: Number(planDraft[r.categoryId] || 0),
          })),
      });
      toast.success('Bütçe planı güncellendi');
      invalidateBudget();
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
      invalidateBudget();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kategori eklenemedi');
    } finally {
      setSavingCategory(false);
    }
  };

  const deleteEntry = async (entry: BudgetEntry) => {
    if (entry.source !== 'MANUAL') return;
    if (!confirm('Bu bütçe hareketini silmek istediğinizden emin misiniz?')) return;
    try {
      await api.delete(`/cari-kasa/budget/entries/${entry.id}`);
      toast.success('Hareket silindi');
      invalidateBudget();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Silinemedi');
    }
  };

  if (isLoading || !data) {
    return (
      <div className="py-10 text-center" style={{ color: 'rgba(250,250,249,0.5)' }}>
        <Loader2 className="animate-spin inline mr-2" size={16} />Hesaplanıyor...
      </div>
    );
  }

  const maxMonthly = Math.max(...data.months.map((m) => Math.max(m.income, m.expense, m.plannedIncome, m.plannedExpense)), 1);
  const incomeRows = data.categoryRows.filter((r) => r.type === 'GELIR');
  const expenseRows = data.categoryRows.filter((r) => r.type === 'GIDER');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 border flex flex-wrap items-end gap-3" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="mr-auto">
          <div className="text-[10.5px] font-bold uppercase tracking-[.14em]" style={{ color: 'rgba(212,184,118,0.7)' }}>
            Cari Tahsilat + Ofis Bütçesi
          </div>
          <h2 className="text-[22px] font-semibold mt-1" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
            Bütçe Takip
          </h2>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-[.12em] block mb-1" style={{ color: 'rgba(250,250,249,0.5)' }}>Yıl</label>
          <input
            type="number"
            value={year}
            onChange={(e) => changeYear(Number(e.target.value))}
            className="w-[100px] px-3 py-2 rounded-md tabular-nums"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-[.12em] block mb-1" style={{ color: 'rgba(250,250,249,0.5)' }}>Ay</label>
          <input
            type="month"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              const y = Number(e.target.value.slice(0, 4));
              if (y) setYear(y);
            }}
            className="px-3 py-2 rounded-md tabular-nums"
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <BudgetKpiCard label="Ay Gelir" value={data.kpi.periodIncome} color="#4ade80" icon={TrendingUp} sub={`Plan: ${fmt(data.kpi.periodPlannedIncome)} TL`} />
        <BudgetKpiCard label="Ay Gider" value={data.kpi.periodExpense} color="#fb7185" icon={TrendingDown} sub={`Plan: ${fmt(data.kpi.periodPlannedExpense)} TL`} />
        <BudgetKpiCard label="Ay Net" value={data.kpi.periodNet} color={data.kpi.periodNet >= 0 ? GOLD : BORDO} icon={Wallet} highlight />
        <BudgetKpiCard label="Plan Sapması" value={data.kpi.periodVariance} color={data.kpi.periodVariance >= 0 ? '#4ade80' : '#fca5a5'} icon={Target} sub={`Yıl net: ${fmt(data.kpi.annualNet)} TL`} />
      </div>

      <div className="rounded-2xl p-5 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[13px] font-semibold inline-flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <BarChart3 size={15} style={{ color: GOLD }} /> Aylık Gelir / Gider
          </h3>
          <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Plan çizgileri soluk, gerçekleşenler canlı renk
          </div>
        </div>
        <div className="flex items-end gap-1.5 h-[220px]">
          {data.months.map((month) => {
            const active = month.period === period;
            return (
              <button
                key={month.period}
                onClick={() => setPeriod(month.period)}
                className="flex-1 h-full min-w-[38px] rounded-lg px-1 pt-2 pb-1 flex flex-col justify-end transition"
                style={{
                  background: active ? 'rgba(212,184,118,0.09)' : 'rgba(255,255,255,0.015)',
                  border: `1px solid ${active ? 'rgba(212,184,118,0.32)' : 'rgba(255,255,255,0.04)'}`,
                }}
                title={`${month.period}: Gelir ${fmt(month.income)} TL, Gider ${fmt(month.expense)} TL`}
              >
                <div className="w-full flex items-end gap-0.5 justify-center" style={{ height: 170 }}>
                  <div className="w-1.5 rounded-t" style={{ height: `${Math.max(2, (month.plannedIncome / maxMonthly) * 160)}px`, background: 'rgba(74,222,128,0.22)' }} />
                  <div className="w-2 rounded-t" style={{ height: `${Math.max(2, (month.income / maxMonthly) * 160)}px`, background: '#4ade80' }} />
                  <div className="w-1.5 rounded-t" style={{ height: `${Math.max(2, (month.plannedExpense / maxMonthly) * 160)}px`, background: 'rgba(251,113,133,0.22)' }} />
                  <div className="w-2 rounded-t" style={{ height: `${Math.max(2, (month.expense / maxMonthly) * 160)}px`, background: '#fb7185' }} />
                </div>
                <div className="text-[9.5px] mt-2 text-center" style={{ color: active ? GOLD : 'rgba(250,250,249,0.45)' }}>{month.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] gap-4">
        <div className="space-y-4">
          <CategoryPlanTable title="Gelir Kalemleri" rows={incomeRows} planDraft={planDraft} setPlanDraft={setPlanDraft} />
          <CategoryPlanTable title="Gider Kalemleri" rows={expenseRows} planDraft={planDraft} setPlanDraft={setPlanDraft} />
          <div className="flex justify-end">
            <button
              onClick={savePlans}
              disabled={savingPlan}
              className="px-4 py-2 rounded-md text-[12.5px] font-bold inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
            >
              {savingPlan ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Planı Kaydet
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-4 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: '#fafaf9' }}>Gelir / Gider İşle</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {(['GIDER', 'GELIR'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setEntryForm((old) => ({ ...old, type, categoryId: '' }))}
                  className="px-3 py-2 rounded-md text-[12px] font-bold"
                  style={{
                    background: entryForm.type === type ? (type === 'GELIR' ? 'rgba(74,222,128,0.14)' : 'rgba(251,113,133,0.14)') : 'rgba(255,255,255,0.03)',
                    color: entryForm.type === type ? (type === 'GELIR' ? '#4ade80' : '#fb7185') : 'rgba(250,250,249,0.58)',
                    border: `1px solid ${entryForm.type === type ? (type === 'GELIR' ? 'rgba(74,222,128,0.32)' : 'rgba(251,113,133,0.32)') : 'rgba(255,255,255,0.07)'}`,
                  }}
                >
                  {type === 'GELIR' ? 'Gelir' : 'Gider'}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <Field label="Kategori">
                <select value={entryForm.categoryId} onChange={(e) => setEntryForm({ ...entryForm, categoryId: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inputStyle}>
                  {entryCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tarih">
                  <input type="date" value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inputStyle} />
                </Field>
                <Field label="Tutar">
                  <input type="number" step="0.01" value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: Number(e.target.value) })} className="w-full px-3 py-2 rounded-md tabular-nums" style={inputStyle} />
                </Field>
              </div>
              <Field label="Açıklama">
                <input value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inputStyle} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ödeme">
                  <select value={entryForm.paymentMethod} onChange={(e) => setEntryForm({ ...entryForm, paymentMethod: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inputStyle}>
                    <option value="NAKIT">Nakit</option>
                    <option value="HAVALE">Havale/EFT</option>
                    <option value="POS">POS/Kart</option>
                    <option value="KREDI_KARTI">Kredi Kartı</option>
                    <option value="DIGER">Diğer</option>
                  </select>
                </Field>
                <Field label="Belge No">
                  <input value={entryForm.documentNo} onChange={(e) => setEntryForm({ ...entryForm, documentNo: e.target.value })} className="w-full px-3 py-2 rounded-md" style={inputStyle} />
                </Field>
              </div>
              <button
                onClick={saveEntry}
                disabled={savingEntry}
                className="w-full px-3 py-2 rounded-md text-[12.5px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: entryForm.type === 'GELIR' ? 'linear-gradient(135deg, #4ade80, #22c55e)' : 'linear-gradient(135deg, #fb7185, #e11d48)', color: '#0f0d0b' }}
              >
                {savingEntry ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Kaydet
              </button>
            </div>
          </div>

          <div className="rounded-2xl p-4 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
            <h3 className="text-[13px] font-semibold mb-3 inline-flex items-center gap-2" style={{ color: '#fafaf9' }}>
              <Tags size={14} style={{ color: GOLD }} /> Kategori Ekle
            </h3>
            <div className="grid grid-cols-[90px_1fr_42px] gap-2">
              <select value={categoryForm.type} onChange={(e) => setCategoryForm({ ...categoryForm, type: e.target.value as any, color: e.target.value === 'GELIR' ? '#4ade80' : '#ef4444' })} className="px-2 py-2 rounded-md text-[12px]" style={inputStyle}>
                <option value="GIDER">Gider</option>
                <option value="GELIR">Gelir</option>
              </select>
              <input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="Kategori adı" className="px-3 py-2 rounded-md" style={inputStyle} />
              <input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })} className="h-[38px] rounded-md" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)' }} />
            </div>
            <button
              onClick={saveCategory}
              disabled={savingCategory}
              className="mt-2 w-full px-3 py-2 rounded-md text-[12px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'rgba(212,184,118,0.12)', color: GOLD, border: '1px solid rgba(212,184,118,0.28)' }}
            >
              {savingCategory ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Kategori Ekle
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{period} Hareketleri</h3>
          <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{data.entries.length} satır</div>
        </div>
        {data.entries.length === 0 ? (
          <div className="py-8 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Bu ay için kayıt yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ color: 'rgba(250,250,249,0.5)', background: 'rgba(255,255,255,0.015)' }}>
                  <th className="px-4 py-2 text-left">Tarih</th>
                  <th className="px-4 py-2 text-left">Kaynak</th>
                  <th className="px-4 py-2 text-left">Kategori</th>
                  <th className="px-4 py-2 text-left">Açıklama</th>
                  <th className="px-4 py-2 text-right">Tutar</th>
                  <th className="px-4 py-2 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={`${entry.source}-${entry.id}`} style={{ borderTop: '1px solid rgba(255,255,255,0.035)', color: '#fafaf9' }}>
                    <td className="px-4 py-2 tabular-nums">{new Date(entry.date).toLocaleDateString('tr-TR')}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{
                        background: entry.source === 'CARI_TAHSILAT' ? 'rgba(74,222,128,0.12)' : 'rgba(212,184,118,0.12)',
                        color: entry.source === 'CARI_TAHSILAT' ? '#4ade80' : GOLD,
                      }}>
                        {entry.source === 'CARI_TAHSILAT' ? 'Cari Tahsilat' : 'Manuel'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: entry.category?.color || GOLD }} />
                        {entry.category?.name || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-2 max-w-[360px] truncate" style={{ color: 'rgba(250,250,249,0.72)' }}>{entry.description || '-'}</td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums" style={{ color: entry.type === 'GELIR' ? '#4ade80' : '#fb7185', fontFamily: 'JetBrains Mono, monospace' }}>
                      {entry.type === 'GELIR' ? '+' : '-'}{fmt(entry.amount)} TL
                    </td>
                    <td className="px-4 py-2 text-center">
                      {entry.source === 'MANUAL' ? (
                        <button onClick={() => deleteEntry(entry)} className="p-1.5 rounded-md" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }} title="Sil">
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <span style={{ color: 'rgba(250,250,249,0.28)' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BudgetKpiCard({ label, value, color, icon: Icon, sub, highlight }: {
  label: string;
  value: number;
  color: string;
  icon: any;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl p-4 border" style={{
      background: highlight ? 'rgba(212,184,118,0.075)' : 'rgba(255,255,255,0.02)',
      borderColor: highlight ? 'rgba(212,184,118,0.26)' : 'rgba(255,255,255,0.06)',
    }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color }} />
        <div className="text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
      </div>
      <div className="text-[22px] font-bold tabular-nums" style={{ color, fontFamily: 'JetBrains Mono, monospace' }}>
        {value >= 0 ? '' : '-'}{fmt(Math.abs(value))} TL
      </div>
      {sub && <div className="text-[10.5px] mt-1" style={{ color: 'rgba(250,250,249,0.4)' }}>{sub}</div>}
    </div>
  );
}

function CategoryPlanTable({ title, rows, planDraft, setPlanDraft }: {
  title: string;
  rows: BudgetCategoryRow[];
  planDraft: Record<string, string>;
  setPlanDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{title}</h3>
        <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {fmt(rows.reduce((s, r) => s + r.actual, 0))} TL
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: 'rgba(250,250,249,0.5)' }}>
              <th className="px-4 py-2 text-left">Kategori</th>
              <th className="px-4 py-2 text-right">Plan</th>
              <th className="px-4 py-2 text-right">Gerçekleşen</th>
              <th className="px-4 py-2 text-right">Sapma</th>
              <th className="px-4 py-2 text-left">Oran</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const max = Math.max(row.actual, row.planned, 1);
              const positive = row.variance >= 0;
              return (
                <tr key={row.categoryId} style={{ borderTop: '1px solid rgba(255,255,255,0.035)', color: '#fafaf9' }}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 min-w-[170px]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: row.color }} />
                      <span className="font-semibold">{row.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={planDraft[row.categoryId] ?? ''}
                      onChange={(e) => setPlanDraft((old) => ({ ...old, [row.categoryId]: e.target.value }))}
                      className="w-[120px] px-2 py-1.5 rounded-md text-right tabular-nums"
                      style={inputStyle}
                    />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: row.type === 'GELIR' ? '#4ade80' : '#fb7185' }}>
                    {fmt(row.actual)} TL
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: positive ? '#4ade80' : '#fca5a5' }}>
                    {positive ? '+' : '-'}{fmt(Math.abs(row.variance))} TL
                  </td>
                  <td className="px-4 py-2 min-w-[150px]">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (row.actual / max) * 100)}%`, background: row.color }} />
                      </div>
                      <span className="text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.55)', fontFamily: 'JetBrains Mono, monospace' }}>
                        %{fmt(row.realizationPct).replace(',00', '')}
                      </span>
                    </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] block mb-1" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</label>
      {children}
    </div>
  );
}
