'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, Eye, Loader2, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { documentsApi } from '@/lib/documents';
import { DocumentCategory } from '@mali-musavir/shared';
import { ALTIN_DUGME, CARD, FAINT, HAIR, LINE, MUTED, NOTR_DUGME, R_KART, RED, STEEL_BR, TEXT, fmtDateTR } from '../_lib/tema';
import { AlanGirdi, AlanSecim, FormGrup, GIRDI_CLS, Satir } from './ortak/Form';
import { BosDurum, GrupSatiri, SekmeBasligi, TabloSarmal, Td, Th } from './ortak/Tablo';

type MukellefDocument = {
  id: string;
  title: string;
  category: string;
  notes?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  updatedAt?: string;
  createdAt?: string;
  tags?: Array<{ tag?: string | null }>;
};

const SUTUN = 5;

/** Dosyalar — manuel evrak yükleme (form grubu) + kenarlıklı gerçek tablo; açıklama satıra tıklayınca açılır. */
export function DosyalarTab({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(DocumentCategory.EVRAK);
  const [progress, setProgress] = useState(0);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [viewBusyDocId, setViewBusyDocId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; downloadUrl: string; title: string; subtitle: string; mimeType?: string | null; docKey: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [acikId, setAcikId] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery<MukellefDocument[]>({
    queryKey: ['documents', 'taxpayer', taxpayerId],
    queryFn: () => documentsApi.findByTaxpayer(taxpayerId),
    enabled: !!taxpayerId,
  });

  const manualDocuments = useMemo(() => documents.filter(isManualMukellefDocument), [documents]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!previewDoc) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewDoc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewDoc]);

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Dosya seçilmedi');
      const cleanTitle = title.trim() || file.name;
      const doc = await documentsApi.upload({
        taxpayerId,
        title: cleanTitle,
        category,
        file,
        tags: ['MANUEL_EVRAK'],
        onProgress: setProgress,
      });
      if (notes.trim()) {
        await documentsApi.update(doc.id, { notes: notes.trim() });
      }
      return doc;
    },
    onSuccess: () => {
      toast.success('Evrak yüklendi');
      setFile(null);
      setTitle('');
      setNotes('');
      setProgress(0);
      qc.invalidateQueries({ queryKey: ['documents', 'taxpayer', taxpayerId] });
    },
    onError: (e: any) => {
      const message = e?.response?.data?.message || e?.message || 'Evrak yüklenemedi';
      toast.error(message === 'Failed to fetch' || message === 'Network Error'
        ? 'Evrak yüklenemedi. Sunucuya erişim veya dosya türü kontrol edilmeli.'
        : message);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (documentId: string) => documentsApi.remove(documentId),
    onSuccess: () => {
      toast.success('Evrak silindi');
      qc.invalidateQueries({ queryKey: ['documents', 'taxpayer', taxpayerId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Evrak silinemedi'),
  });

  const downloadDocument = async (documentId: string) => {
    setBusyDocId(documentId);
    try {
      const res = await documentsApi.getDownloadUrl(documentId);
      const url = res?.url || res?.downloadUrl;
      if (!url) throw new Error('İndirme adresi alınamadı');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Evrak indirilemedi');
    } finally {
      setBusyDocId(null);
    }
  };

  const previewDocument = async (doc: MukellefDocument) => {
    setViewBusyDocId(doc.id);
    try {
      const [previewRes, downloadRes] = await Promise.all([
        documentsApi.getPreviewUrl(doc.id),
        documentsApi.getDownloadUrl(doc.id),
      ]);
      const url = previewRes?.url || previewRes?.previewUrl;
      const downloadUrl = downloadRes?.url || downloadRes?.downloadUrl;
      if (!downloadUrl) throw new Error('Indirme adresi alinamadi');
      if (!url) throw new Error('Görüntüleme adresi alınamadı');
      setPreviewDoc({
        url,
        downloadUrl,
        title: doc.title,
        subtitle: `${documentCategoryLabel(doc.category)} · ${formatBytes(doc.sizeBytes)} · ${fmtDateTR((doc.updatedAt || doc.createdAt || '').substring(0, 10))}`,
        mimeType: previewRes?.mimeType || doc.mimeType,
        docKey: doc.id,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Evrak açılamadı');
    } finally {
      setViewBusyDocId(null);
    }
  };

  const ikonDugme = (aktif: boolean, renk?: string): React.CSSProperties => ({ ...NOTR_DUGME, color: aktif ? TEXT : renk || MUTED });

  return (
    <div className="space-y-5">
      <SekmeBasligi title="Dosyalar" text={`${manualDocuments.length} yüklü evrak · kira kontratı, imza sirküleri, vekaletname ve diğer firma belgeleri.`} />

      <FormGrup
        baslik="Evrak yükle"
        aciklama="Kira kontratı, imza sirküleri, vekaletname…"
        sag={<span className="text-[11.5px]" style={{ color: progress ? STEEL_BR : FAINT }}>{progress ? `Yükleme: %${progress}` : file ? `${file.name} seçildi` : 'Dosya seçilmedi'}</span>}
      >
        <Satir etiket="Dosya" zorunlu>
          {/* Tarayıcının kendi "Dosya Seç" yazısı yerine kontrollü düğme (dil/biçim tutarlı) */}
          <label className={`${GIRDI_CLS} flex cursor-pointer items-center gap-3`}>
            <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <span className="shrink-0 rounded-[4px] px-2 py-0.5 text-[12px] font-bold" style={{ background: 'rgba(79,134,201,0.16)', color: '#74a6e6' }}>Dosya seç</span>
            <span className="truncate" style={{ color: file ? TEXT : FAINT }}>{file ? file.name : 'PDF, görsel veya ofis belgesi'}</span>
          </label>
        </Satir>
        <Satir etiket="Kategori">
          <AlanSecim value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
            <option value={DocumentCategory.EVRAK}>Evrak</option>
            <option value={DocumentCategory.SOZLESME}>Sözleşme</option>
            <option value={DocumentCategory.FATURA}>Fatura</option>
            <option value={DocumentCategory.DIGER}>Diğer</option>
          </AlanSecim>
        </Satir>
        <Satir etiket="Başlık">
          <AlanGirdi value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name || 'Belge adı'} />
        </Satir>
        <Satir etiket="Açıklama">
          <AlanGirdi value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Örn. 2026 kira kontratı, imza sirküleri, vekaletname" />
        </Satir>
        <div className="flex justify-end md:col-span-full">
          <button
            type="button"
            onClick={() => uploadMut.mutate()}
            disabled={!file || uploadMut.isPending}
            className="inline-flex h-9 items-center gap-2 px-4 text-[13px] font-bold transition hover:brightness-105 disabled:opacity-50"
            style={{ background: '#4f86c9', color: '#fff', borderRadius: 8 }}
          >
            {uploadMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Evrakı Yükle
          </button>
        </div>
      </FormGrup>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-[13px]" style={{ color: MUTED }}>
          <Loader2 size={15} className="animate-spin" /> Evraklar yükleniyor...
        </div>
      ) : manualDocuments.length === 0 ? (
        <BosDurum icon={BookOpen} title="Evrak yok" text="Bu mükellef için evrak yüklenmedi." />
      ) : (
        <TabloSarmal minWidth={720}>
          <colgroup>
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 128 }} />
          </colgroup>
          <thead>
            <tr>
              <Th>Belge</Th>
              <Th>Kategori</Th>
              <Th right>Boyut</Th>
              <Th>Tarih</Th>
              <Th center>Eylemler</Th>
            </tr>
          </thead>
          <tbody>
            {manualDocuments.map((doc) => {
              const acik = acikId === doc.id;
              return (
                <React.Fragment key={doc.id}>
                  <tr
                    className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    onClick={() => setAcikId((v) => (v === doc.id ? null : doc.id))}
                    title={acik ? 'Açıklamayı kapat' : 'Açıklamayı aç'}
                  >
                    <Td>
                      <div className="truncate font-bold">{doc.title}</div>
                      {!acik && <div className="truncate text-[11.5px]" style={{ color: doc.notes ? MUTED : FAINT }}>{doc.notes || 'Açıklama yok'}</div>}
                    </Td>
                    <Td muted>{documentCategoryLabel(doc.category)}</Td>
                    <Td right muted tabular>{formatBytes(doc.sizeBytes)}</Td>
                    <Td muted tabular>{fmtDateTR((doc.updatedAt || doc.createdAt || '').substring(0, 10))}</Td>
                    <Td center style={{ padding: '4px 6px' }}>
                      <div className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => previewDocument(doc)}
                          disabled={viewBusyDocId === doc.id}
                          className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                          style={ikonDugme(true)}
                          title="Görüntüle"
                        >
                          {viewBusyDocId === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadDocument(doc.id)}
                          disabled={busyDocId === doc.id}
                          className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                          style={ikonDugme(false)}
                          title="İndir"
                        >
                          {busyDocId === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm('Bu evrak silinsin mi?')) deleteMut.mutate(doc.id);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                          style={ikonDugme(false, RED)}
                          title="Sil"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                  {acik && (
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <Td colSpan={SUTUN} muted style={{ padding: '8px 14px', whiteSpace: 'pre-wrap' }}>
                        <span className="text-[11.5px] font-medium" style={{ color: FAINT }}>Açıklama · </span>
                        {doc.notes || 'Açıklama yok'}
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </TabloSarmal>
      )}

      {mounted && previewDoc && createPortal((
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="flex h-[min(92vh,900px)] w-full max-w-[1120px] flex-col overflow-hidden"
            style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: R_KART }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold" style={{ color: TEXT }}>{previewDoc.title}</div>
                <div className="mt-0.5 truncate text-[11.5px]" style={{ color: FAINT }}>{previewDoc.subtitle}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={previewDoc.downloadUrl}
                  download={previewDoc.title.replace(/[\\/:*?"<>|]/g, '_')}
                  className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                  title="Evrakı indir"
                  style={NOTR_DUGME}
                >
                  <Download size={15} />
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="inline-flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                  title="Kapat"
                  style={NOTR_DUGME}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            {previewDoc.mimeType?.startsWith('image/') ? (
              <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                <img src={previewDoc.url} alt={previewDoc.title} className="mx-auto max-h-full max-w-full object-contain" />
              </div>
            ) : previewDoc.mimeType?.includes('pdf') || /\.pdf$/i.test(previewDoc.title) ? (
              <iframe key={previewDoc.docKey} title={previewDoc.title} src={previewDoc.url} className="min-h-0 flex-1 bg-white" />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center" style={{ color: MUTED }}>
                Bu dosya tipi tarayici icinde onizlenemiyor. Indirmek icin indir butonunu kullanin.
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function isManualMukellefDocument(doc: MukellefDocument): boolean {
  const title = String(doc.title || '').toLocaleUpperCase('tr-TR');
  const notes = String(doc.notes || '').toLocaleUpperCase('tr-TR');
  const category = String(doc.category || '').toLocaleUpperCase('tr-TR');
  const tags = (doc.tags || []).map((item) => String(item.tag || '').toLocaleUpperCase('tr-TR')).join(' ');
  const combined = `${title} ${notes} ${category} ${tags}`;
  if (category === String(DocumentCategory.BEYANNAME).toLocaleUpperCase('tr-TR')) return false;
  if (title.startsWith('DBS_')) return false;
  if (combined.includes('GIB_BEYANNAME') || combined.includes('GİB_BEYANNAME')) return false;
  if (combined.includes('GIB_TAHAKKUK') || combined.includes('GİB_TAHAKKUK')) return false;
  if (combined.includes('PORTALDAN OTOMATIK') || combined.includes('PORTALDAN OTOMATİK')) return false;
  if (combined.includes('PORTAL-AUTOMATION') || combined.includes('OTOMATIK') || combined.includes('OTOMATİK')) return false;
  return true;
}

function documentCategoryLabel(category?: string | null): string {
  if (category === DocumentCategory.SOZLESME) return 'Sözleşme';
  if (category === DocumentCategory.FATURA) return 'Fatura';
  if (category === DocumentCategory.BEYANNAME) return 'Beyanname';
  if (category === DocumentCategory.EVRAK) return 'Evrak';
  return 'Diğer';
}

function formatBytes(value?: number | null): string {
  const size = Number(value || 0);
  if (!size) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}
