'use client';

import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  ScanLine,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Plus,
  Save,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Loader2,
  Receipt,
} from 'lucide-react';
import { api } from '@/lib/api';

type OcrDetected = {
  filename: string;
  date: string;
  belge_no?: string;
  cari?: string;
  vergi_no?: string;
  kdv_1?: string;
  kdv_10?: string;
  kdv_20?: string;
  toplam?: string;
};

type AccountingLine = {
  id: string;
  group: 'matrah' | 'vergi' | 'cari';
  accountCode: string;
  description: string;
  rate?: string;
  debit: string;
  credit: string;
};

type DraftInvoice = {
  id: string;
  backendId?: string;
  file: File;
  previewUrl: string;
  previewType: 'image' | 'pdf' | 'other';
  source: 'manual-okc' | 'manual-invoice';
  documentType: 'OKC_FIS' | 'E_FATURA' | 'E_ARSIV' | 'FIS' | 'DIGER';
  invoiceKind: 'Alış' | 'Satış';
  currency: string;
  exchangeRate: string;
  date: string;
  serial: string;
  number: string;
  buyerVkn: string;
  sellerVkn: string;
  vendorName: string;
  customerName: string;
  total: string;
  lines: AccountingLine[];
  status: 'bekliyor' | 'ocr' | 'hazir' | 'kontrol' | 'onaylandi';
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const money = (value?: string) => {
  if (!value) return '0,00';
  const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseAmount = (value?: string) => {
  if (!value) return 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

const makeLine = (
  group: AccountingLine['group'],
  accountCode: string,
  description: string,
  debit: string,
  credit = '0,00',
  rate?: string,
): AccountingLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  group,
  accountCode,
  description,
  rate,
  debit,
  credit,
});

const defaultLinesFromOcr = (detected?: OcrDetected): AccountingLine[] => {
  const kdv20 = parseAmount(detected?.kdv_20);
  const kdv10 = parseAmount(detected?.kdv_10);
  const kdv1 = parseAmount(detected?.kdv_1);
  const total = parseAmount(detected?.toplam);
  const taxTotal = kdv20 + kdv10 + kdv1;
  const matrah = Math.max(total - taxTotal, 0);
  const lines: AccountingLine[] = [
    makeLine('matrah', '770.01.010', 'Gider / matrah', money(String(matrah)), '0,00'),
  ];
  if (kdv20 > 0) lines.push(makeLine('vergi', '191.01.020', 'İndirilecek KDV', money(String(kdv20)), '0,00', '%20'));
  if (kdv10 > 0) lines.push(makeLine('vergi', '191.01.010', 'İndirilecek KDV', money(String(kdv10)), '0,00', '%10'));
  if (kdv1 > 0) lines.push(makeLine('vergi', '191.01.001', 'İndirilecek KDV', money(String(kdv1)), '0,00', '%1'));
  lines.push(makeLine('cari', '320.01.001', 'Cari hesap', '0,00', money(String(total))));
  return lines;
};

const fromApiLine = (line: any): AccountingLine => ({
  id: line.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  group: line.group || 'matrah',
  accountCode: line.accountCode || '',
  description: line.description || '',
  rate: line.rate || '',
  debit: money(line.debit),
  credit: money(line.credit),
});

const applyApiDocument = (draft: DraftInvoice, doc: any): DraftInvoice => ({
  ...draft,
  backendId: doc.id,
  source: doc.source === 'mobile' ? 'manual-okc' : draft.source,
  documentType: doc.documentType || draft.documentType,
  invoiceKind: doc.invoiceKind === 'SATIS' ? 'Satış' : 'Alış',
  currency: doc.currency || draft.currency,
  exchangeRate: doc.exchangeRate ? String(doc.exchangeRate).replace('.', ',') : draft.exchangeRate,
  date: doc.faturaTarihi ? String(doc.faturaTarihi).slice(0, 10) : draft.date,
  serial: doc.seriNo || draft.serial,
  number: doc.belgeNo || draft.number,
  buyerVkn: doc.buyerVkn || draft.buyerVkn,
  sellerVkn: doc.sellerVkn || draft.sellerVkn,
  vendorName: doc.vendorName || draft.vendorName,
  customerName: doc.customerName || draft.customerName,
  total: money(doc.totalAmount),
  lines: Array.isArray(doc.lines) && doc.lines.length ? doc.lines.map(fromApiLine) : draft.lines,
  status: doc.status === 'APPROVED' ? 'onaylandi' : doc.status === 'READY' ? 'hazir' : 'kontrol',
});

function blankDraft(file: File, previewUrl: string): DraftInvoice {
  const isPdf = file.type === 'application/pdf';
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    previewUrl,
    previewType: file.type.startsWith('image/') ? 'image' : isPdf ? 'pdf' : 'other',
    source: 'manual-okc',
    documentType: 'OKC_FIS',
    invoiceKind: 'Alış',
    currency: 'TL',
    exchangeRate: '1',
    date: todayIso(),
    serial: '',
    number: '',
    buyerVkn: '',
    sellerVkn: '',
    vendorName: '',
    customerName: '',
    total: '0,00',
    lines: defaultLinesFromOcr(),
    status: 'bekliyor',
  };
}

export default function FaturaMuhasebelestirmePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<DraftInvoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const selected = drafts.find((d) => d.id === selectedId) || drafts[0] || null;
  const selectedIndex = selected ? drafts.findIndex((d) => d.id === selected.id) : -1;
  const readyCount = drafts.filter((d) => d.status === 'hazir').length;

  const totals = useMemo(() => {
    const debit = selected?.lines.reduce((sum, line) => sum + parseAmount(line.debit), 0) || 0;
    const credit = selected?.lines.reduce((sum, line) => sum + parseAmount(line.credit), 0) || 0;
    return { debit, credit, diff: Math.abs(debit - credit) };
  }, [selected]);

  const addFiles = (files: FileList | File[]) => {
    const next = Array.from(files).filter((file) => file.type.startsWith('image/') || file.type === 'application/pdf');
    if (!next.length) return;
    setDrafts((prev) => {
      const existing = new Set(prev.map((d) => `${d.file.name}-${d.file.size}`));
      const additions = next
        .filter((file) => !existing.has(`${file.name}-${file.size}`))
        .map((file) => blankDraft(file, URL.createObjectURL(file)));
      if (!selectedId && additions[0]) setSelectedId(additions[0].id);
      return [...prev, ...additions];
    });
  };

  const updateSelected = (patch: Partial<DraftInvoice>) => {
    if (!selected) return;
    setDrafts((prev) => prev.map((d) => (d.id === selected.id ? { ...d, ...patch } : d)));
  };

  const updateLine = (lineId: string, patch: Partial<AccountingLine>) => {
    if (!selected) return;
    updateSelected({
      lines: selected.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    });
  };

  const removeSelected = () => {
    if (!selected) return;
    URL.revokeObjectURL(selected.previewUrl);
    setDrafts((prev) => prev.filter((d) => d.id !== selected.id));
    const next = drafts[selectedIndex + 1] || drafts[selectedIndex - 1] || null;
    setSelectedId(next?.id || null);
  };

  const runOcr = async () => {
    const uploadableDrafts = drafts.filter((d) => !d.backendId);
    if (!uploadableDrafts.length) {
      toast.info('Tüm belgeler zaten kalıcı kuyruğa alındı');
      return;
    }
    setScanning(true);
    setDrafts((prev) => prev.map((d) => (!d.backendId ? { ...d, status: 'ocr' } : d)));
    try {
      const fd = new FormData();
      uploadableDrafts.forEach((d) => fd.append('files', d.file));
      fd.append('source', 'manual-web');
      fd.append('documentType', 'OKC_FIS');
      fd.append('invoiceKind', 'ALIS');
      const { data } = await api.post('/fatura-muhasebelestirme/documents/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const documents: any[] = data?.documents || [];
      const byName = new Map(documents.map((doc) => [doc.originalName, doc]));
      setDrafts((prev) =>
        prev.map((d) => {
          const hit = byName.get(d.file.name);
          if (!hit) return !d.backendId ? { ...d, status: 'kontrol' } : d;
          return applyApiDocument(d, hit);
        }),
      );
      toast.success(`${documents.length} belge kalıcı kuyruğa alındı`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Belgeler kaydedilemedi');
      setDrafts((prev) => prev.map((d) => (d.status === 'ocr' ? { ...d, status: 'kontrol' } : d)));
    } finally {
      setScanning(false);
    }
  };

  const saveSelected = async (approve = false) => {
    if (!selected) return;
    if (!selected.backendId) {
      toast.error('Önce OCR Oku ile belgeyi kuyruğa alın');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        documentType: selected.documentType,
        invoiceKind: selected.invoiceKind === 'Satış' ? 'SATIS' : 'ALIS',
        currency: selected.currency,
        exchangeRate: selected.exchangeRate,
        belgeNo: selected.number,
        seriNo: selected.serial,
        faturaTarihi: selected.date,
        sellerVkn: selected.sellerVkn,
        buyerVkn: selected.buyerVkn,
        vendorName: selected.vendorName,
        customerName: selected.customerName,
        totalAmount: selected.total,
        status: 'READY',
        lines: selected.lines.map(({ group, accountCode, description, rate, debit, credit }) => ({
          group,
          accountCode,
          description,
          rate,
          debit,
          credit,
        })),
      };
      const { data } = await api.patch(`/fatura-muhasebelestirme/documents/${selected.backendId}`, payload);
      let doc = data;
      if (approve) {
        const res = await api.post(`/fatura-muhasebelestirme/documents/${selected.backendId}/approve`);
        doc = res.data;
      }
      setDrafts((prev) => prev.map((d) => (d.id === selected.id ? applyApiDocument(d, doc) : d)));
      toast.success(approve ? 'Belge onaylandı' : 'Taslak kaydedildi');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Kaydetme tamamlanamadı');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-900">
      <div className="flex h-[calc(100vh-0px)] min-h-[760px] flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Receipt size={20} />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-normal">Fatura Muhasebeleştirme</h1>
              <p className="text-xs text-slate-500">Fatura, ÖKC fişi ve ileride mobil belgeler için tek onay ekranı</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-600">Onaylanacak: <b className="text-red-500">{drafts.length - readyCount}</b></span>
            <button
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              <Upload size={16} /> Yükle
            </button>
            <button
              onClick={runOcr}
              disabled={scanning || !drafts.length}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {scanning ? <Loader2 className="animate-spin" size={16} /> : <ScanLine size={16} />} OCR Oku
            </button>
          </div>
        </header>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />

        <section className="grid flex-1 grid-cols-[minmax(520px,1fr)_520px] overflow-hidden">
          <div className="flex min-w-0 flex-col border-r border-slate-200 bg-slate-100">
            <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4">
              <div className="flex items-center gap-2">
                <button className="rounded-md border border-slate-200 p-2 text-slate-600" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} title="Uzaklaştır">
                  <ZoomOut size={16} />
                </button>
                <input className="h-1 w-48 accent-blue-600" type="range" min="0.5" max="1.8" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
                <button className="rounded-md border border-slate-200 p-2 text-slate-600" onClick={() => setZoom((z) => Math.min(1.8, z + 0.1))} title="Yakınlaştır">
                  <ZoomIn size={16} />
                </button>
                <button className="rounded-md border border-slate-200 p-2 text-slate-600" onClick={() => setRotation((r) => (r + 90) % 360)} title="Döndür">
                  <RotateCw size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <button className="rounded-md border border-slate-200 p-2" onClick={() => drafts[selectedIndex - 1] && setSelectedId(drafts[selectedIndex - 1].id)} title="Önceki">
                  <ChevronLeft size={16} />
                </button>
                <span>{selected ? `${selectedIndex + 1} / ${drafts.length}` : '0 / 0'}</span>
                <button className="rounded-md border border-slate-200 p-2" onClick={() => drafts[selectedIndex + 1] && setSelectedId(drafts[selectedIndex + 1].id)} title="Sonraki">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {!selected ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                className={`m-6 flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white ${dragging ? 'border-blue-500' : 'border-slate-300'}`}
              >
                <Upload size={34} className="mb-4 text-blue-600" />
                <div className="text-base font-semibold">ÖKC fişlerini veya fatura görsellerini buraya bırakın</div>
                <div className="mt-1 text-sm text-slate-500">JPG, PNG ve PDF kabul edilir. OCR şu an görsellerde çalışır.</div>
                <button onClick={() => inputRef.current?.click()} className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Dosya Seç</button>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center overflow-auto p-6">
                {selected.previewType === 'image' ? (
                  <img
                    src={selected.previewUrl}
                    alt={selected.file.name}
                    className="max-h-full rounded-sm bg-white shadow-sm"
                    style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'center center' }}
                  />
                ) : selected.previewType === 'pdf' ? (
                  <iframe src={selected.previewUrl} className="h-full w-full rounded-sm bg-white shadow-sm" title={selected.file.name} />
                ) : (
                  <div className="rounded-md bg-white p-8 text-center text-slate-500">Bu dosya için önizleme yok.</div>
                )}
              </div>
            )}
          </div>

          <aside className="flex min-w-0 flex-col bg-white">
            <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
              <div className="text-sm font-semibold">Muhasebe Kodları</div>
              <div className="flex gap-2">
                <button onClick={removeSelected} disabled={!selected} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 disabled:opacity-40">
                  <Trash2 size={15} /> Sil
                </button>
                <button onClick={() => saveSelected(false)} disabled={!selected || saving} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                  {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Kaydet
                </button>
                <button onClick={() => saveSelected(true)} disabled={!selected || saving} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                  <CheckCircle2 size={15} /> Onayla
                </button>
              </div>
            </div>

            {selected ? (
              <div className="flex-1 overflow-auto p-4">
                <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <div className="grid grid-cols-4 gap-3">
                    <label className="text-xs font-semibold text-slate-500">
                      Para Birimi
                      <input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={selected.currency} onChange={(e) => updateSelected({ currency: e.target.value })} />
                    </label>
                    <label className="text-xs font-semibold text-slate-500">
                      Kur
                      <input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm" value={selected.exchangeRate} onChange={(e) => updateSelected({ exchangeRate: e.target.value })} />
                    </label>
                    <label className="text-xs font-semibold text-slate-500">
                      Fatura Türü
                      <select className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={selected.invoiceKind} onChange={(e) => updateSelected({ invoiceKind: e.target.value as DraftInvoice['invoiceKind'] })}>
                        <option>Alış</option>
                        <option>Satış</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-500">
                      Belge Türü
                      <select className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={selected.documentType} onChange={(e) => updateSelected({ documentType: e.target.value as DraftInvoice['documentType'] })}>
                        <option value="OKC_FIS">ÖKC Fişi</option>
                        <option value="E_FATURA">E-Fatura</option>
                        <option value="E_ARSIV">E-Arşiv</option>
                        <option value="FIS">Fiş</option>
                        <option value="DIGER">Diğer</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Matrah / Vergi / Cari</div>
                  <div className="divide-y divide-slate-100">
                    {selected.lines.map((line) => (
                      <div key={line.id} className="grid grid-cols-[132px_1fr_82px_96px_96px_34px] gap-2 px-3 py-2">
                        <input className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={line.accountCode} onChange={(e) => updateLine(line.id, { accountCode: e.target.value })} placeholder="Hesap kodu" />
                        <input className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="Açıklama" />
                        <input className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={line.rate || ''} onChange={(e) => updateLine(line.id, { rate: e.target.value })} placeholder="Oran" />
                        <input className="h-9 rounded-md border border-slate-200 px-2 text-right text-sm" value={line.debit} onChange={(e) => updateLine(line.id, { debit: e.target.value })} />
                        <input className="h-9 rounded-md border border-slate-200 px-2 text-right text-sm" value={line.credit} onChange={(e) => updateLine(line.id, { credit: e.target.value })} />
                        <button className="flex h-9 items-center justify-center rounded-md text-red-500 hover:bg-red-50" onClick={() => updateSelected({ lines: selected.lines.filter((l) => l.id !== line.id) })} title="Satırı sil">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => updateSelected({ lines: [...selected.lines, makeLine('matrah', '', '', '0,00', '0,00')] })}
                    className="m-3 inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                  >
                    <Plus size={16} /> Satır Ekle
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-slate-500">
                    Tarih
                    <input type="date" className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={selected.date} onChange={(e) => updateSelected({ date: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Belge No
                    <input className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={selected.number} onChange={(e) => updateSelected({ number: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Satıcı VKN
                    <input className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={selected.sellerVkn} onChange={(e) => updateSelected({ sellerVkn: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Toplam Tutar
                    <input className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-right text-sm font-semibold" value={selected.total} onChange={(e) => updateSelected({ total: e.target.value })} />
                  </label>
                  <label className="col-span-2 text-xs font-semibold text-slate-500">
                    Satıcı Bilgisi
                    <input className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={selected.vendorName} onChange={(e) => updateSelected({ vendorName: e.target.value })} />
                  </label>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span>Borç Toplamı</span><b>{money(String(totals.debit))}</b></div>
                  <div className="mt-1 flex justify-between"><span>Alacak Toplamı</span><b>{money(String(totals.credit))}</b></div>
                  <div className={`mt-2 flex justify-between rounded-md px-2 py-1 ${totals.diff < 0.01 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    <span>Fiş Dengesi</span><b>{totals.diff < 0.01 ? 'Dengede' : money(String(totals.diff))}</b>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-slate-500">
                <div>
                  <FileText size={34} className="mx-auto mb-3 text-slate-400" />
                  <div className="font-medium text-slate-700">Henüz belge seçilmedi</div>
                  <p className="mt-1 text-sm">Sol alana ÖKC fişi veya fatura görseli yükleyin.</p>
                </div>
              </div>
            )}

            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-slate-500">
                <span>Yüklenen Belgeler</span>
                <span>{drafts.length} belge</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {drafts.map((draft) => (
                  <button
                    key={draft.id}
                    onClick={() => setSelectedId(draft.id)}
                    className={`flex min-w-52 items-center gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm ${selected?.id === draft.id ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}
                  >
                    {draft.previewType === 'image' ? <ImageIcon size={17} className="text-blue-600" /> : <FileText size={17} className="text-slate-500" />}
                    <span className="min-w-0 flex-1 truncate">{draft.file.name}</span>
                    {draft.status === 'hazir' ? <CheckCircle2 size={16} className="text-emerald-600" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
