'use client';
import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kdvApi } from '@/lib/kdv';
import {
  ArrowLeft, Upload, FileSpreadsheet, Image as ImageIcon,
  Play, CheckCircle, XCircle, AlertTriangle, Eye, RefreshCw,
  ChevronDown, ChevronUp, FileText, Hash, Calendar, BadgePercent,
  RotateCcw, Maximize2,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

const TYPE_MAP: Record<string, { label: string; short: string; excelHint: string }> = {
  KDV_191:       { label: '191 İndirilecek KDV', short: '191 Alış', excelHint: 'Luca → Raporlar → KDV Muavin Defteri → 191 hesabı seçili olarak Excel aktar' },
  KDV_391:       { label: '391 Hesaplanan KDV',  short: '391 Satış', excelHint: 'Luca → Raporlar → KDV Muavin Defteri → 391 hesabı seçili olarak Excel aktar' },
  ISLETME_GELIR: { label: 'İşletme Gelir',       short: 'Gelir', excelHint: 'Luca → İşletme Defteri → Gelir Sayfası → Excel aktar' },
  ISLETME_GIDER: { label: 'İşletme Gider',       short: 'Gider', excelHint: 'Luca → İşletme Defteri → Gider Sayfası → Excel aktar' },
  ALIS:  { label: '191 İndirilecek KDV', short: '191 Alış', excelHint: 'Luca → KDV Muavin Defteri → Excel aktar' },
  SATIS: { label: '391 Hesaplanan KDV',  short: '391 Satış', excelHint: 'Luca → KDV Muavin Defteri → Excel aktar' },
};

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-0.5 opacity-80">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    MATCHED: 'bg-green-100 text-green-700', PARTIAL_MATCH: 'bg-amber-100 text-amber-700',
    NEEDS_REVIEW: 'bg-orange-100 text-orange-700', UNMATCHED: 'bg-red-100 text-red-700',
    CONFIRMED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-gray-100 text-gray-600',
  };
  const labels: Record<string, string> = {
    MATCHED: 'Eşleşti', PARTIAL_MATCH: 'Kısmi', NEEDS_REVIEW: 'İnceleme',
    UNMATCHED: 'Eşleşmedi', CONFIRMED: 'Teyit Edildi', REJECTED: 'Reddedildi',
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>{labels[status] ?? status}</span>;
}

function OcrStatusChip({ status }: { status: string }) {
  const m: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    PENDING:        { label: 'Bekliyor',      bg: 'bg-gray-100',   text: 'text-gray-500',  dot: 'bg-gray-400' },
    PROCESSING:     { label: 'İşleniyor…',   bg: 'bg-blue-50',    text: 'text-blue-600',  dot: 'bg-blue-500' },
    SUCCESS:        { label: 'Başarılı',      bg: 'bg-green-50',   text: 'text-green-700', dot: 'bg-green-500' },
    LOW_CONFIDENCE: { label: 'Teyit Gerekli',bg: 'bg-orange-50',  text: 'text-orange-700',dot: 'bg-orange-400' },
    FAILED:         { label: 'Başarısız',     bg: 'bg-red-50',     text: 'text-red-700',   dot: 'bg-red-500' },
  };
  const s = m[status] ?? m.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot} ${status === 'PROCESSING' ? 'animate-pulse' : ''}`} />
      {s.label}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#16a34a' : pct >= 55 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-bold w-8 text-right" style={{ color }}>%{pct}</span>
    </div>
  );
}

export default function KdvSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'upload' | 'results' | 'images'>('upload');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [expandedRaw, setExpandedRaw] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const excelRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const { data: session } = useQuery({ queryKey: ['kdv-session', id], queryFn: () => kdvApi.getSession(id) });
  const { data: stats } = useQuery({ queryKey: ['kdv-stats', id], queryFn: () => kdvApi.getStats(id), refetchInterval: 5000 });
  const { data: records } = useQuery({ queryKey: ['kdv-records', id], queryFn: () => kdvApi.getRecords(id) });
  const { data: images, refetch: refetchImages } = useQuery({
    queryKey: ['kdv-images', id],
    queryFn: () => kdvApi.getImages(id),
    refetchInterval: (query: any) => {
      const d = query?.state?.data;
      const anyProcessing = Array.isArray(d) && d.some((i: any) => ['PENDING', 'PROCESSING'].includes(i.ocrStatus));
      return anyProcessing ? 3000 : 8000;
    },
  });
  const { data: results } = useQuery({ queryKey: ['kdv-results', id], queryFn: () => kdvApi.getResults(id), enabled: activeTab === 'results' });

  const uploadExcel = useMutation({
    mutationFn: () => kdvApi.uploadExcel(id, excelFile!),
    onSuccess: (data) => { toast.success(`${data.parsed} satır başarıyla okundu`); qc.invalidateQueries({ queryKey: ['kdv-records', id] }); qc.invalidateQueries({ queryKey: ['kdv-stats', id] }); setExcelFile(null); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Excel yükleme hatası'),
  });

  const [uploading, setUploading] = useState(false);
  const handleImageUpload = async () => {
    if (!imageFiles.length) return;
    setUploading(true);
    try {
      const result = await kdvApi.uploadImages(id, imageFiles, (uploaded, total) => {
        const pct = Math.round((uploaded / total) * 100);
        imageFiles.forEach((f) => setUploadProgress((p) => ({ ...p, [f.name]: pct })));
      });
      const success = result.uploaded ?? imageFiles.length;
      const failed = result.failed ?? 0;
      if (failed > 0) toast.error(`${failed} görsel yüklenemedi`);
      toast.success(`${success}/${imageFiles.length} görsel yüklendi — OCR başladı`);
      setActiveTab('images');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Görsel yükleme hatası');
    } finally {
      setImageFiles([]); setUploadProgress({}); setUploading(false);
      qc.invalidateQueries({ queryKey: ['kdv-images', id] }); qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
    }
  };

  const reconcile = useMutation({
    mutationFn: () => kdvApi.reconcile(id),
    onSuccess: (data) => { toast.success(`Eşleştirme: ${data.matched} ✓ ${data.unmatched} ✗ ${data.needsReview} inceleme`); qc.invalidateQueries({ queryKey: ['kdv-results', id] }); qc.invalidateQueries({ queryKey: ['kdv-stats', id] }); setActiveTab('results'); },
    onError: () => toast.error('Eşleştirme sırasında hata'),
  });

  const resolve = useMutation({
    mutationFn: ({ resultId, action }: { resultId: string; action: string }) => kdvApi.resolveResult(resultId, action as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kdv-results', id] }); qc.invalidateQueries({ queryKey: ['kdv-stats', id] }); },
  });

  const [ocrEdit, setOcrEdit] = useState<Record<string, any>>({});
  const confirmOcr = useMutation({
    mutationFn: ({ imageId }: { imageId: string }) => kdvApi.confirmOcr(imageId, ocrEdit[imageId] ?? {}),
    onSuccess: () => { toast.success('Teyit edildi'); qc.invalidateQueries({ queryKey: ['kdv-images', id] }); qc.invalidateQueries({ queryKey: ['kdv-stats', id] }); },
  });

  const loadImageUrl = async (imgId: string) => {
    if (imageUrls[imgId]) { window.open(imageUrls[imgId], '_blank'); return; }
    try {
      const { url } = await kdvApi.getImageUrl(imgId);
      setImageUrls((p) => ({ ...p, [imgId]: url }));
      window.open(url, '_blank');
    } catch { toast.error('Görsel açılamadı'); }
  };

  const needsOcrCount = images?.filter((img: any) => ['LOW_CONFIDENCE', 'FAILED'].includes(img.ocrStatus) && !img.isManuallyConfirmed).length ?? 0;
  const processingCount = images?.filter((img: any) => ['PENDING', 'PROCESSING'].includes(img.ocrStatus)).length ?? 0;

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex items-center gap-3">
        <Link href="/panel/kdv-kontrol" className="p-2 rounded-lg hover:bg-gray-100"><ArrowLeft size={18} className="text-gray-500" /></Link>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900">KDV Kontrol — {session?.periodLabel}
            <span className="ml-2 text-sm font-normal text-gray-500">{TYPE_MAP[session?.type]?.short ?? session?.type}</span>
          </h2>
          {session?.taxpayer && (
            <p className="text-sm text-gray-500 mt-0.5">Mükellef: <span className="font-medium text-gray-700">
              {session.taxpayer.companyName || `${session.taxpayer.firstName ?? ''} ${session.taxpayer.lastName ?? ''}`.trim()}
            </span></p>
          )}
        </div>
        <button onClick={() => reconcile.mutate()} disabled={reconcile.isPending || !stats?.totalRecords || !stats?.totalImages}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Play size={15} />{reconcile.isPending ? 'Eşleştiriliyor…' : 'Eşleştirmeyi Başlat'}
        </button>
      </div>

      {/* Sayaçlar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatBadge label="Excel Satırı" value={stats.totalRecords} color="bg-white border-gray-200 text-gray-800" />
          <StatBadge label="Görsel" value={stats.totalImages} color="bg-white border-gray-200 text-gray-800" />
          <StatBadge label="Eşleşti" value={stats.matched} color="bg-green-50 border-green-200 text-green-800" />
          <StatBadge label="Kısmi" value={stats.partialMatch} color="bg-amber-50 border-amber-200 text-amber-800" />
          <StatBadge label="İnceleme" value={stats.needsReview} color="bg-orange-50 border-orange-200 text-orange-800" />
          <StatBadge label="Eşleşmedi" value={stats.unmatched} color="bg-red-50 border-red-200 text-red-800" />
          <StatBadge label="Teyit Edildi" value={stats.confirmed} color="bg-emerald-50 border-emerald-200 text-emerald-800" />
          <StatBadge label="OCR Teyit Bekler" value={stats.needsOcrConfirm} color="bg-purple-50 border-purple-200 text-purple-800" />
        </div>
      )}

      {/* Uyarı bantları */}
      {processingCount > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-3">
          <RefreshCw size={16} className="text-blue-500 animate-spin flex-shrink-0" />
          <p className="text-sm text-blue-700">{processingCount} görsel için OCR devam ediyor — otomatik yenileniyor…</p>
        </div>
      )}
      {needsOcrCount > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('images')}>
          <AlertTriangle size={16} className="text-orange-500 flex-shrink-0" />
          <p className="text-sm text-orange-700"><span className="font-semibold">{needsOcrCount} görselde</span> teyit bekleniyor — Görseller sekmesine tıklayın</p>
        </div>
      )}

      {/* Sekmeler */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          {(['upload', 'images', 'results'] as const).map((tab) => {
            const labels = { upload: 'Yükleme', images: `Görseller (${images?.length ?? 0})`, results: `Sonuçlar (${(results as any[])?.length ?? 0})` };
            return (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── YÜKLEME SEKMESİ ── */}
      {activeTab === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-green-600" />
              <h3 className="font-semibold text-gray-900">1. Luca Excel Yükle</h3>
              {records?.length > 0 && <span className="ml-auto text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">{records.length} satır yüklendi</span>}
            </div>
            <p className="text-xs text-gray-500">{TYPE_MAP[session?.type]?.excelHint ?? 'Luca → Excel aktar'}<br />(<strong>{TYPE_MAP[session?.type]?.short ?? ''}</strong> seçili olduğundan emin olun)</p>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors" onClick={() => excelRef.current?.click()}>
              <Upload size={24} className="text-gray-400 mx-auto mb-2" />
              {excelFile ? <p className="text-sm text-gray-700 font-medium">{excelFile.name}</p> : <p className="text-sm text-gray-400">Excel dosyasını buraya sürükleyin veya tıklayın</p>}
              <p className="text-xs text-gray-400 mt-1">.xlsx veya .xls</p>
            </div>
            <input ref={excelRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)} />
            <button onClick={() => uploadExcel.mutate()} disabled={!excelFile || uploadExcel.isPending}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-2.5 rounded-lg text-sm font-medium">
              {uploadExcel.isPending ? 'Okunuyor…' : 'Excel\'i Yükle ve Oku'}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ImageIcon size={18} className="text-purple-600" />
              <h3 className="font-semibold text-gray-900">2. Belge Görsellerini Yükle</h3>
              {images?.length > 0 && <span className="ml-auto text-xs text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">{images.length} görsel</span>}
            </div>
            <p className="text-xs text-gray-500">Mihsap'tan veya tarayıcıdan alınan fatura, fiş ve Z raporu görselleri (JPEG, PNG)</p>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors" onClick={() => imgRef.current?.click()}>
              <Upload size={24} className="text-gray-400 mx-auto mb-2" />
              {imageFiles.length > 0 ? <p className="text-sm text-gray-700 font-medium">{imageFiles.length} dosya seçildi</p> : <p className="text-sm text-gray-400">JPEG/PNG dosyalarını seçin</p>}
            </div>
            <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/jpg" multiple className="hidden" onChange={(e) => setImageFiles(Array.from(e.target.files ?? []))} />
            {Object.entries(uploadProgress).map(([name, pct]) => (
              <div key={name} className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500"><span className="truncate max-w-[200px]">{name}</span><span>{pct}%</span></div>
                <div className="h-1.5 bg-gray-200 rounded-full"><div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
              </div>
            ))}
            <button onClick={handleImageUpload} disabled={!imageFiles.length || uploading}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white py-2.5 rounded-lg text-sm font-medium">
              {uploading ? 'Yükleniyor…' : `${imageFiles.length || ''} Görseli Yükle ve OCR Başlat`}
            </button>
          </div>
        </div>
      )}

      {/* ── GÖRSELLER / OCR SEKMESİ ── */}
      {activeTab === 'images' && (
        <div className="space-y-3">
          {/* Üst bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold text-gray-700">{images?.length ?? 0} görsel</p>
              {processingCount > 0 && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full animate-pulse">{processingCount} işleniyor</span>}
              {needsOcrCount > 0 && <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">{needsOcrCount} teyit bekliyor</span>}
            </div>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['kdv-images', id] })} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg">
              <RefreshCw size={12} /> Yenile
            </button>
          </div>

          {images?.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <ImageIcon size={32} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Henüz görsel yüklenmedi.</p>
              <button onClick={() => setActiveTab('upload')} className="mt-3 text-sm text-indigo-600 hover:underline">Yükleme sekmesine git</button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            {images?.map((img: any, idx: number) => {
              const confirmed = img.isManuallyConfirmed;
              const needsConfirm = ['LOW_CONFIDENCE', 'FAILED'].includes(img.ocrStatus) && !confirmed;
              const hasData = img.ocrStatus === 'SUCCESS' || img.ocrStatus === 'LOW_CONFIDENCE' || confirmed;
              const edit = ocrEdit[img.id] ?? { belgeNo: img.ocrBelgeNo ?? '', date: img.ocrDate ?? '', kdvTutari: img.ocrKdvTutari ?? '' };

              const borderColor = confirmed ? 'border-emerald-300' : needsConfirm ? 'border-orange-300' : img.ocrStatus === 'SUCCESS' ? 'border-green-200' : img.ocrStatus === 'FAILED' ? 'border-red-200' : 'border-gray-200';

              return (
                <div key={img.id} className={`bg-white rounded-2xl border ${borderColor} overflow-hidden shadow-sm`}>
                  {/* Başlık satırı */}
                  <div className={`px-4 py-3 flex items-center gap-3 ${needsConfirm ? 'bg-orange-50' : confirmed ? 'bg-emerald-50' : img.ocrStatus === 'SUCCESS' ? 'bg-green-50' : 'bg-gray-50'}`}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: 'var(--navy)' }}>{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{img.originalName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{(img.sizeBytes / 1024).toFixed(0)} KB</p>
                    </div>
                    <OcrStatusChip status={confirmed ? 'SUCCESS' : img.ocrStatus} />
                    <button onClick={() => loadImageUrl(img.id)} className="p-2 rounded-lg hover:bg-white/70 text-gray-500 transition-colors" title="Görseli yeni sekmede aç">
                      <Maximize2 size={15} />
                    </button>
                  </div>

                  {/* OCR Güven çubuğu */}
                  {img.ocrConfidence !== null && (
                    <div className="px-4 pt-3 pb-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-400 font-medium">OCR Güven Skoru</span>
                        {confirmed && <span className="text-[11px] text-emerald-600 font-semibold">✓ Manuel Teyit Edildi</span>}
                      </div>
                      <ConfidenceBar value={img.ocrConfidence} />
                    </div>
                  )}

                  {/* OCR Sonuçları */}
                  {(hasData || img.ocrStatus === 'PENDING' || img.ocrStatus === 'PROCESSING') && (
                    <div className="px-4 pt-3 pb-2">
                      {img.ocrStatus === 'PENDING' && (
                        <div className="flex items-center gap-2 py-4 text-gray-400 text-sm">
                          <RefreshCw size={14} className="animate-spin" /> OCR kuyruğa alındı…
                        </div>
                      )}
                      {img.ocrStatus === 'PROCESSING' && (
                        <div className="flex items-center gap-2 py-4 text-blue-600 text-sm">
                          <RefreshCw size={14} className="animate-spin" /> OCR metni okuyuyor…
                        </div>
                      )}
                      {hasData && (
                        <div className="grid grid-cols-3 gap-3">
                          {/* Belge No */}
                          <div className="rounded-xl border border-gray-100 p-3 bg-gray-50">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Hash size={12} className="text-gray-400" />
                              <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Belge No</span>
                            </div>
                            {needsConfirm ? (
                              <input value={edit.belgeNo} onChange={e => setOcrEdit(p => ({ ...p, [img.id]: { ...edit, belgeNo: e.target.value } }))}
                                className="w-full text-sm font-semibold border border-orange-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                                placeholder="Belge numarası" />
                            ) : (
                              <p className="text-sm font-bold text-gray-900">{img.confirmedBelgeNo || img.ocrBelgeNo || <span className="text-gray-300 font-normal">Okunamadı</span>}</p>
                            )}
                          </div>
                          {/* Tarih */}
                          <div className="rounded-xl border border-gray-100 p-3 bg-gray-50">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Calendar size={12} className="text-gray-400" />
                              <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Tarih</span>
                            </div>
                            {needsConfirm ? (
                              <input value={edit.date} onChange={e => setOcrEdit(p => ({ ...p, [img.id]: { ...edit, date: e.target.value } }))}
                                className="w-full text-sm font-semibold border border-orange-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                                placeholder="GG.AA.YYYY" />
                            ) : (
                              <p className="text-sm font-bold text-gray-900">{img.confirmedDate || img.ocrDate || <span className="text-gray-300 font-normal">Okunamadı</span>}</p>
                            )}
                          </div>
                          {/* KDV Tutarı */}
                          <div className="rounded-xl border border-gray-100 p-3 bg-gray-50">
                            <div className="flex items-center gap-1.5 mb-2">
                              <BadgePercent size={12} className="text-gray-400" />
                              <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">KDV Tutarı</span>
                            </div>
                            {needsConfirm ? (
                              <input value={edit.kdvTutari} onChange={e => setOcrEdit(p => ({ ...p, [img.id]: { ...edit, kdvTutari: e.target.value } }))}
                                className="w-full text-sm font-semibold border border-orange-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                                placeholder="0,00" />
                            ) : (
                              <p className="text-sm font-bold text-gray-900">{img.confirmedKdvTutari || img.ocrKdvTutari || <span className="text-gray-300 font-normal">Okunamadı</span>}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* FAILED durumu */}
                  {img.ocrStatus === 'FAILED' && !confirmed && (
                    <div className="px-4 pb-3">
                      <div className="rounded-xl bg-red-50 border border-red-100 p-3 grid grid-cols-3 gap-3">
                        {(['belgeNo', 'date', 'kdvTutari'] as const).map((k, i) => {
                          const labels = ['Belge No', 'Tarih', 'KDV Tutarı'];
                          return (
                            <div key={k}>
                              <p className="text-[11px] text-red-400 mb-1">{labels[i]}</p>
                              <input value={edit[k]} onChange={e => setOcrEdit(p => ({ ...p, [img.id]: { ...edit, [k]: e.target.value } }))}
                                className="w-full text-sm border border-red-200 rounded-lg px-2 py-1.5 focus:outline-none bg-white"
                                placeholder={labels[i]} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Ham metin (açılır) */}
                  {img.ocrRawText && (
                    <div className="px-4 pb-2">
                      <button onClick={() => setExpandedRaw(expandedRaw === img.id ? null : img.id)}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
                        <FileText size={12} />
                        {expandedRaw === img.id ? 'Ham metni gizle' : 'Ham OCR metnini göster'}
                        {expandedRaw === img.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {expandedRaw === img.id && (
                        <pre className="mt-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-xl p-3 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed">
                          {img.ocrRawText}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Teyit butonu */}
                  {needsConfirm && (
                    <div className="px-4 pb-4 pt-1">
                      <button onClick={() => { setOcrEdit(p => ({ ...p, [img.id]: edit })); confirmOcr.mutate({ imageId: img.id }); }}
                        disabled={confirmOcr.isPending}
                        className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm py-2.5 rounded-xl font-semibold transition-colors">
                        <CheckCircle size={15} /> Verileri Teyit Et
                      </button>
                    </div>
                  )}
                  {img.ocrStatus === 'FAILED' && !confirmed && (
                    <div className="px-4 pb-4 pt-1">
                      <button onClick={() => { setOcrEdit(p => ({ ...p, [img.id]: edit })); confirmOcr.mutate({ imageId: img.id }); }}
                        disabled={confirmOcr.isPending}
                        className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white text-sm py-2.5 rounded-xl font-semibold transition-colors">
                        <CheckCircle size={15} /> Manuel Giriş ile Teyit Et
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SONUÇLAR SEKMESİ ── */}
      {activeTab === 'results' && (
        <div className="space-y-2">
          {!results?.length ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Play size={32} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Henüz eşleştirme yapılmadı.</p>
              <button onClick={() => reconcile.mutate()} disabled={reconcile.isPending}
                className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                Eşleştirmeyi Başlat
              </button>
            </div>
          ) : (
            results.map((r: any) => (
              <div key={r.id} className={`bg-white rounded-xl border overflow-hidden ${r.status === 'MATCHED' ? 'border-green-200' : r.status === 'NEEDS_REVIEW' ? 'border-orange-200' : r.status === 'UNMATCHED' ? 'border-red-200' : 'border-gray-200'}`}>
                <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpandedResult(expandedResult === r.id ? null : r.id)}>
                  <StatusBadge status={r.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex gap-4 text-xs text-gray-600">
                      {r.kdvRecord && <span><span className="font-medium">Excel:</span> {r.kdvRecord.belgeNo ?? '—'} | {r.kdvRecord.belgeDate ? new Date(r.kdvRecord.belgeDate).toLocaleDateString('tr-TR') : '—'} | KDV: <span className="font-semibold">{parseFloat(r.kdvRecord.kdvTutari).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</span></span>}
                      {r.image && <span><span className="font-medium">Görsel:</span> {r.image.confirmedBelgeNo || r.image.ocrBelgeNo || '—'} | {r.image.confirmedDate || r.image.ocrDate || '—'} | KDV: <span className="font-semibold">{r.image.confirmedKdvTutari || r.image.ocrKdvTutari || '—'}</span></span>}
                    </div>
                    {r.mismatchReasons?.length > 0 && <p className="text-xs text-orange-600 mt-0.5">{r.mismatchReasons.join(' • ')}</p>}
                  </div>
                  {r.matchScore !== null && <span className="text-xs text-gray-400">%{Math.round(r.matchScore * 100)}</span>}
                  {expandedResult === r.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                </div>
                {expandedResult === r.id && ['NEEDS_REVIEW', 'PARTIAL_MATCH', 'UNMATCHED'].includes(r.status) && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 flex gap-3">
                    <button onClick={() => resolve.mutate({ resultId: r.id, action: 'CONFIRMED' })} disabled={resolve.isPending}
                      className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-2 rounded-lg font-medium"><CheckCircle size={13} /> Teyit Et</button>
                    <button onClick={() => resolve.mutate({ resultId: r.id, action: 'REJECTED' })} disabled={resolve.isPending}
                      className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-2 rounded-lg font-medium"><XCircle size={13} /> Reddet</button>
                    {r.image && <button onClick={() => loadImageUrl(r.image.id)} className="flex items-center gap-1.5 border border-gray-300 text-gray-600 text-xs px-3 py-2 rounded-lg font-medium hover:bg-white"><Eye size={13} /> Görseli Aç</button>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
