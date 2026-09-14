'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, FileText, Loader2, Mail, MessageCircle, MessageSquareText, Printer, X } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { beyanKayitlariApi, BEYAN_TIPI_LABEL, type BeyanKaydi } from '@/lib/beyan-kayitlari';
import { CARD, FAINT, GOLD, HAIR, LINE, MUTED, NOTR_DUGME, R_KART, STEEL_BR, TEXT, fmtBeyanDonem, fmtDateTR, fmtTutar } from '../_lib/tema';
import { BaglantiDugme, BosDurum, Cip, DocBtn, GrupSatiri, SekmeBasligi, TabloSarmal, Td, Th } from './ortak/Tablo';

type MukellefBeyanDocKind = 'beyanname' | 'tahakkuk';
type MukellefBeyanTableRow = {
  key: string;
  row: BeyanKaydi;
  kind: MukellefBeyanDocKind;
  tur: string;
  hasFile: boolean;
};

function mukellefBeyanAdi(row: BeyanKaydi): string {
  const t = row.taxpayer;
  return (t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || 'Mükellef').trim();
}

function mukellefBeyanEmail(row: BeyanKaydi): string {
  const emails = [row.taxpayer?.email, ...(row.taxpayer?.emails || [])]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return emails[0] || '';
}

function mukellefBeyanPhone(row: BeyanKaydi): string {
  const phones = [row.taxpayer?.phone, ...(row.taxpayer?.phones || [])]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return phones[0] || '';
}

function mukellefWhatsappPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `90${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `9${digits}`;
  return digits;
}

function mukellefBeyanTipLabel(row: BeyanKaydi): string {
  return BEYAN_TIPI_LABEL[row.beyanTipi] || row.beyanTipi;
}

function mukellefBeyanSubject(row: BeyanKaydi): string {
  return `${mukellefBeyanAdi(row)} - ${mukellefBeyanTipLabel(row)} - ${fmtBeyanDonem(row.donem)}`;
}

function mukellefBeyanMessage(row: BeyanKaydi): string {
  const tutar = row.tahakkukTutari != null ? ` Tahakkuk: ${fmtTutar(row.tahakkukTutari)} TL.` : '';
  return `${fmtBeyanDonem(row.donem)} dönemi ${mukellefBeyanTipLabel(row)} kaydınız hazır.${tutar}`;
}

/** Dönem "2026-08" / "2026-Q3" / "2026-YIL" → yıl grubu. */
function beyanYili(donem: string): string {
  const m = /^(\d{4})/.exec(donem || '');
  return m ? m[1] : 'Diğer';
}

const SUTUN = 7;

// ============================================================
// BEYANNAME SEKMESİ — Beyannameler modülünden bu mükellefe ait kayıtlar
// ============================================================
export function BeyannamelerTab({ taxpayerId }: { taxpayerId: string }) {
  const { data: kayitlar = [], isLoading } = useQuery({
    queryKey: ['beyan-kayitlari', 'mukellef', taxpayerId],
    queryFn: () => beyanKayitlariApi.list({ taxpayerId, limit: 300 }),
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedDocKeys, setSelectedDocKeys] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<{ url: string; title: string; subtitle: string; docKey: string } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); };
  }, []);

  const closePreview = () => {
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setPreview(null);
  };

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const fetchDocumentBlob = async (row: BeyanKaydi, kind: MukellefBeyanDocKind) => {
    const hasFile = kind === 'beyanname' ? !!row.beyannameUrl : !!row.pdfUrl;
    if (!hasFile) return null;
    const endpoint = kind === 'beyanname'
      ? `/beyan-kayitlari/${row.id}/beyanname`
      : `/beyan-kayitlari/${row.id}/pdf`;
    const res = await api.get(endpoint, { responseType: 'blob' });
    return res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
  };

  const openDoc = async (row: BeyanKaydi, kind: 'beyanname' | 'tahakkuk') => {
    const hasFile = kind === 'beyanname' ? !!row.beyannameUrl : !!row.pdfUrl;
    if (!hasFile) {
      toast.warning('Bu kayıt için görüntülenecek PDF yok');
      return;
    }
    const key = `${row.id}:${kind}`;
    setBusyKey(key);
    try {
      const endpoint = kind === 'beyanname'
        ? `/beyan-kayitlari/${row.id}/beyanname`
        : `/beyan-kayitlari/${row.id}/pdf`;
      const res = await api.get(endpoint, { responseType: 'blob' });
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreview({
        url,
        docKey: key,
        title: `${BEYAN_TIPI_LABEL[row.beyanTipi] || row.beyanTipi} · ${fmtBeyanDonem(row.donem)}`,
        subtitle: `${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'}${row.beyanTarihi ? ' · ' + fmtDateTR(row.beyanTarihi.substring(0, 10)) : ''}${row.tahakkukTutari != null ? ' · ' + fmtTutar(row.tahakkukTutari) + ' ₺' : ''}`,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'PDF açılamadı');
    } finally {
      setBusyKey(null);
    }
  };

  const sorted = useMemo(
    () => [...(Array.isArray(kayitlar) ? kayitlar : [])].sort((a, b) => (b.donem || '').localeCompare(a.donem || '')),
    [kayitlar],
  );

  const tableRows = useMemo<MukellefBeyanTableRow[]>(
    () => sorted.flatMap((row) => ([
      { key: `${row.id}:beyanname`, row, kind: 'beyanname' as const, tur: 'E-Beyanname', hasFile: !!row.beyannameUrl },
      { key: `${row.id}:tahakkuk`, row, kind: 'tahakkuk' as const, tur: 'Tahakkuk', hasFile: !!row.pdfUrl },
    ])),
    [sorted],
  );

  /** Yıl grupları (sıra: yeni → eski). */
  const gruplar = useMemo(() => {
    const map = new Map<string, MukellefBeyanTableRow[]>();
    for (const item of tableRows) {
      const yil = beyanYili(item.row.donem);
      if (!map.has(yil)) map.set(yil, []);
      map.get(yil)!.push(item);
    }
    return Array.from(map.entries()).map(([yil, satirlar]) => ({ yil, satirlar }));
  }, [tableRows]);

  const selectedTableRows = useMemo(
    () => tableRows.filter((item) => selectedDocKeys.has(item.key)),
    [tableRows, selectedDocKeys],
  );

  const selectedUniqueRows = useMemo(() => {
    const seen = new Set<string>();
    return selectedTableRows
      .map((item) => item.row)
      .filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });
  }, [selectedTableRows]);

  useEffect(() => {
    const visible = new Set(tableRows.map((item) => item.key));
    setSelectedDocKeys((prev) => {
      const next = new Set(Array.from(prev).filter((key) => visible.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [tableRows]);

  const toggleDocSelection = (key: string, checked?: boolean) => {
    setSelectedDocKeys((prev) => {
      const next = new Set(prev);
      const shouldSelect = checked ?? !next.has(key);
      if (shouldSelect) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const sendEmail = (row: BeyanKaydi) => {
    const email = mukellefBeyanEmail(row);
    if (!email) {
      toast.warning('Mükellef kartında e-posta yok');
      return;
    }
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(mukellefBeyanSubject(row))}&body=${encodeURIComponent(mukellefBeyanMessage(row))}`;
  };

  const sendWhatsapp = (row: BeyanKaydi) => {
    const phone = mukellefWhatsappPhone(mukellefBeyanPhone(row));
    if (!phone) {
      toast.warning('Mükellef kartında telefon yok');
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(mukellefBeyanMessage(row))}`, '_blank', 'noopener,noreferrer');
  };

  const sendSms = (row: BeyanKaydi) => {
    const phone = mukellefBeyanPhone(row).replace(/\s+/g, '');
    if (!phone) {
      toast.warning('Mükellef kartında telefon yok');
      return;
    }
    window.location.href = `sms:${phone}?body=${encodeURIComponent(mukellefBeyanMessage(row))}`;
  };

  const downloadDocument = async (item: MukellefBeyanTableRow) => {
    const blob = await fetchDocumentBlob(item.row, item.kind).catch(() => null);
    if (!blob) {
      toast.warning(`${item.tur} PDF yok`);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mukellefBeyanAdi(item.row)}-${mukellefBeyanTipLabel(item.row)}-${fmtBeyanDonem(item.row.donem)}-${item.tur}.pdf`.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-[13px]" style={{ color: MUTED }}>
        <Loader2 size={15} className="animate-spin" /> Beyannameler yükleniyor…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <BosDurum icon={FileText} title="Beyanname kaydı yok" text="Bu mükellef için Beyannameler modülünden indirilmiş beyanname bulunamadı.">
        <div className="mt-4">
          <BaglantiDugme href={`/panel/beyannameler?taxpayerId=${taxpayerId}`}>Beyannameler modülünü aç <ExternalLink size={13} /></BaglantiDugme>
        </div>
      </BosDurum>
    );
  }

  const hepsiSecili = tableRows.length > 0 && selectedDocKeys.size === tableRows.length;

  return (
    <div className="space-y-3">
      <SekmeBasligi title="E-Beyannameler" text={`Beyannameler modülünden gelen kayıtlar · ${sorted.length} beyanname kaydı`}>
        <BaglantiDugme href={`/panel/beyannameler?taxpayerId=${taxpayerId}`}>
          Beyannameler modülünde aç <ExternalLink size={12} />
        </BaglantiDugme>
      </SekmeBasligi>

      {/* Toplu işlemler — ÜSTTE, her zaman görünür (seçim yoksa soluk) */}
      <div className="flex flex-wrap items-center gap-1.5 border-y py-2" style={{ borderColor: HAIR }}>
        <span className="mr-1 text-[11.5px] font-medium tabular-nums" style={{ color: selectedTableRows.length ? TEXT : MUTED }}>
          {selectedTableRows.length} seçili
        </span>
        <BeyanBulkActionButton
          icon={Mail}
          label="Seçili Beyann. / Tahakk. E-Posta Gönder"
          disabled={selectedTableRows.length === 0}
          onClick={() => selectedTableRows[0] ? sendEmail(selectedTableRows[0].row) : toast.warning('Seçili kayıt yok')}
        />
        <BeyanBulkActionButton
          icon={Mail}
          label="Seçilenlere Gönder"
          disabled={selectedUniqueRows.length === 0}
          onClick={() => selectedUniqueRows[0] ? sendEmail(selectedUniqueRows[0]) : toast.warning('Seçili kayıt yok')}
        />
        <BeyanBulkActionButton
          icon={MessageSquareText}
          label="Seçili Tahakk. SMS Gönder"
          disabled={selectedTableRows.length === 0}
          onClick={() => {
            const target = selectedTableRows.find((item) => item.kind === 'tahakkuk')?.row || selectedUniqueRows[0];
            target ? sendSms(target) : toast.warning('Seçili kayıt yok');
          }}
        />
        <BeyanBulkActionButton
          icon={MessageCircle}
          label="WhatsApp Gönder"
          disabled={selectedUniqueRows.length === 0}
          onClick={() => selectedUniqueRows[0] ? sendWhatsapp(selectedUniqueRows[0]) : toast.warning('Seçili kayıt yok')}
        />
        <BeyanBulkActionButton
          icon={Printer}
          label="Seçilenleri Yazdır"
          disabled={selectedTableRows.length === 0}
          onClick={() => selectedTableRows[0] ? openDoc(selectedTableRows[0].row, selectedTableRows[0].kind) : toast.warning('Seçili kayıt yok')}
        />
        <BeyanBulkActionButton
          icon={Download}
          label={`Seçilenleri İndir (${selectedTableRows.length})`}
          disabled={selectedTableRows.length === 0}
          onClick={() => selectedTableRows.forEach((item) => void downloadDocument(item))}
        />
        <BeyanBulkActionButton
          icon={X}
          label="Seçimi Temizle"
          disabled={selectedDocKeys.size === 0}
          onClick={() => setSelectedDocKeys(new Set())}
        />
      </div>

      <TabloSarmal maxHeight={560} minWidth={960}>
        <colgroup>
          <col style={{ width: 36 }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 64 }} />
        </colgroup>
        <thead>
          <tr>
            <Th center style={{ padding: '7px 4px' }}>
              <input
                type="checkbox"
                checked={hepsiSecili}
                onChange={(e) => setSelectedDocKeys(e.target.checked ? new Set(tableRows.map((item) => item.key)) : new Set())}
                className="h-3.5 w-3.5 cursor-pointer"
                style={{ accentColor: '#4f86c9' }}
                aria-label="Tüm beyannameleri seç"
              />
            </Th>
            <Th>Beyanname Dönemi</Th>
            <Th>Beyanname Türü</Th>
            <Th>Belge Mahiyeti</Th>
            <Th>Tür</Th>
            <Th right>Tutar</Th>
            <Th center>Aç</Th>
          </tr>
        </thead>
        <tbody>
          {gruplar.map((g) => (
            <React.Fragment key={g.yil}>
              <GrupSatiri ad={g.yil} sayi={g.satirlar.length} colSpan={SUTUN} />
              {g.satirlar.map(({ key, row, kind, tur, hasFile }) => {
                const busy = busyKey === key;
                const isBeyan = kind === 'beyanname';
                const secili = selectedDocKeys.has(key);
                return (
                  <tr key={key} className="transition-colors hover:bg-white/[0.03]" style={secili ? { background: 'rgba(79,134,201,0.08)' } : undefined}>
                    <Td center style={{ padding: '6px 4px' }}>
                      <input
                        type="checkbox"
                        checked={secili}
                        onChange={(e) => toggleDocSelection(key, e.target.checked)}
                        className="h-3.5 w-3.5 cursor-pointer"
                        style={{ accentColor: '#4f86c9' }}
                        aria-label={`${BEYAN_TIPI_LABEL[row.beyanTipi] || row.beyanTipi} ${tur} seç`}
                      />
                    </Td>
                    <Td>
                      <div className="truncate font-semibold">{fmtBeyanDonem(row.donem)}</div>
                      <div className="truncate text-[11.5px]" style={{ color: FAINT }}>
                        {row.beyanTarihi ? `Beyan: ${fmtDateTR(row.beyanTarihi.substring(0, 10))}` : 'Beyan tarihi yok'}
                        {row.onayNo ? ` · Onay: ${row.onayNo}` : ''}
                      </div>
                    </Td>
                    <Td><span className="truncate">{BEYAN_TIPI_LABEL[row.beyanTipi] || row.beyanTipi}</span></Td>
                    <Td muted>ASIL</Td>
                    <Td><Cip>{tur}</Cip></Td>
                    <Td right tabular style={{ color: isBeyan ? FAINT : TEXT, fontWeight: isBeyan ? 500 : 600 }}>
                      {isBeyan ? '—' : (row.tahakkukTutari != null ? `${fmtTutar(row.tahakkukTutari)} ₺` : '—')}
                    </Td>
                    <Td center style={{ padding: '4px 6px' }}>
                      <DocBtn label={hasFile ? 'Görüntüle' : 'PDF yok'} disabled={!hasFile} busy={busy} onClick={() => openDoc(row, kind)} muted={!isBeyan} />
                    </Td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </TabloSarmal>

      {mounted && preview && createPortal((
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
          onClick={closePreview}
        >
          <div
            className="flex h-[min(92vh,900px)] w-full max-w-[1180px] flex-col overflow-hidden"
            style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: R_KART }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold" style={{ color: TEXT }}>{preview.title}</div>
                <div className="mt-0.5 truncate text-[11.5px]" style={{ color: FAINT }}>{preview.subtitle}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={preview.url}
                  download={`${preview.title}.pdf`.replace(/[\\/:*?"<>|]/g, '_')}
                  className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                  title="PDF indir"
                  style={NOTR_DUGME}
                >
                  <Download size={15} />
                </a>
                <button
                  type="button"
                  onClick={() => { const f = document.getElementById('mukellef-beyan-pdf') as HTMLIFrameElement | null; f?.contentWindow?.print(); }}
                  className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                  title="Yazdır"
                  style={NOTR_DUGME}
                >
                  <Printer size={15} />
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                  title="Kapat"
                  style={NOTR_DUGME}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <iframe key={preview.docKey} id="mukellef-beyan-pdf" title={preview.title} src={preview.url} className="min-h-0 flex-1 bg-white" />
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

/** Toplu işlem düğmesi — nötr (renk dolgusu yok), 32px. */
function BeyanBulkActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: MUTED }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
