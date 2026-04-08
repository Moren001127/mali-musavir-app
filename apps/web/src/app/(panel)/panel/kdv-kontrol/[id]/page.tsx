'use client';
import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kdvApi } from '@/lib/kdv';
import {
  ArrowLeft, Upload, FileSpreadsheet, Image as ImageIcon,
  Play, CheckCircle, XCircle, AlertTriangle, Eye, RefreshCw,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

const TYPE_MAP: Record<string, { label: string; short: string; excelHint: string }> = {
  KDV_191:       { label: '191 İndirilecek KDV', short: '191 Alış', excelHint: 'Luca → Raporlar → KDV Muavin Defteri → 191 hesabı seçili olarak Excel aktar' },
  KDV_391:       { label: '391 Hesaplanan KDV',  short: '391 Satış', excelHint: 'Luca → Raporlar → KDV Muavin Defteri → 391 hesabı seçili olarak Excel aktar' },
  ISLETME_GELIR: { label: 'İşletme Gelir',       short: 'Gelir', excelHint: 'Luca → İşletme Defteri → Gelir Sayfası → Excel aktar' },
  ISLETME_GIDER: { label: 'İşletme Gider',       short: 'Gider', excelHint: 'Luca → İşletme Defteri → Gider Sayfası → Excel aktar' },
  // legacy
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

/* ─── Durum badge'i ─── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    MATCHED:       'bg-green-100 text-green-700',
    PARTIAL_MATCH: 'bg-amber-100 text-amber-700',
    NEEDS_REVIEW:  'bg-orange-100 text-orange-700',
    UNMATCHED:     'bg-red-100 text-red-700',
    CONFIRMED:     'bg-emerald-100 text-emerald-700',
    REJECTED:      'bg-gray-100 text-gray-600',
  };
  const labels: Record<string, string> = {
    MATCHED:       'Eşleşti',
    PARTIAL_MATCH: 'Kısmi',
    NEEDS_REVIEW:  'İnceleme',
    UNMATCHED:     'Eşleşmedi',
    CONFIRMED:     'Teyit Edildi',
    REJECTED:      'Reddedildi',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  );
}

/* ─── OCR Durum ─── */
function OcrBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING:        { label: 'Bekliyor',        cls: 'text-gray-400' },
    PROCESSING:     { label: 'OCR Çalışıyor…',  cls: 'text-blue-500 animate-pulse' },
    SUCCESS:        { label: 'OCR Tamam',        cls: 'text-green-600' },
    LOW_CONFIDENCE: { label: 'Teyit Gerekli',   cls: 'text-orange-500' },
    FAILED:         { label: 'OCR Başarısız',   cls: 'text-red-500' },
  };
  const s = map[status] ?? { label: status, cls: 'text-gray-400' };
  return <span className={`text-xs font-medium ${s.cls}`}>{s.label}</span>;
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
  const excelRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const { data: session } = useQuery({ queryKey: ['kdv-session', id], queryFn: () => kdvApi.getSession(id) });
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['kdv-stats', id],
    queryFn: () => kdvApi.getStats(id),
    refetchInterval: activeTab === 'upload' ? 5000 : false,
  });
  const { data: records } = useQuery({ queryKey: ['kdv-records', id], queryFn: () => kdvApi.getRecords(id) });
  const { data: images, refetch: refetchImages } = useQuery({
    queryKey: ['kdv-images', id],
    queryFn: () => kdvApi.getImages(id),
    refetchInterval: 6000, // OCR sonuçlarını otomatik yenile
  });
  const { data: results } = useQuery({
    queryKey: ['kdv-results', id],
    queryFn: () => kdvApi.getResults(id),
    enabled: activeTab === 'results',
  });

  /* Excel yükleme */
  const uploadExcel = useMutation({
    mutationFn: () => kdvApi.uploadExcel(id, excelFile!),
    onSuccess: (data) => {
      toast.success(`${data.parsed} satır başarıyla okundu`);
      qc.invalidateQueries({ queryKey: ['kdv-records', id] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
      setExcelFile(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Excel yükleme hatası'),
  });

  /* Görsel yükleme — toplu multipart */
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
      if (failed > 0) {
        toast.error(`${failed} görsel yüklenemedi: ${(result.errors ?? []).join(', ')}`);
      }
      toast.success(`${success}/${imageFiles.length} görsel yüklendi. OCR işlemi başladı.`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Görsel yükleme hatası');
    } finally {
      setImageFiles([]);
      setUploadProgress({});
      setUploading(false);
      qc.invalidateQueries({ queryKey: ['kdv-images', id] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
    }
  };

  /* Eşleştirme */
  const reconcile = useMutation({
    mutationFn: () => kdvApi.reconcile(id),
    onSuccess: (data) => {
      toast.success(
        `Eşleştirme tamamlandı: ${data.matched} eşleşti, ${data.unmatched} eşleşmedi, ${data.needsReview} inceleme gerekli`,
      );
      qc.invalidateQueries({ queryKey: ['kdv-results', id] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
      setActiveTab('results');
    },
    onError: () => toast.error('Eşleştirme sırasında hata oluştu'),
  });

  /* Teyit / Reddet */
  const resolve = useMutation({
    mutationFn: ({ resultId, action }: { resultId: string; action: 'CONFIRMED' | 'REJECTED' }) =>
      kdvApi.resolveResult(resultId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kdv-results', id] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
    },
  });

  /* OCR teyit */
  const [ocrEdit, setOcrEdit] = useState<Record<string, { belgeNo: string; date: string; kdvTutari: string }>>({});
  const confirmOcr = useMutation({
    mutationFn: ({ imageId }: { imageId: string }) =>
      kdvApi.confirmOcr(imageId, ocrEdit[imageId] ?? {}),
    onSuccess: () => {
      toast.success('OCR verileri teyit edildi');
      qc.invalidateQueries({ queryKey: ['kdv-images', id] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
    },
  });

  const needsOcrCount = images?.filter(
    (img: any) => ['LOW_CONFIDENCE', 'FAILED'].includes(img.ocrStatus) && !img.isManuallyConfirmed,
  ).length ?? 0;

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex items-center gap-3">
        <Link href="/panel/kdv-kontrol" className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-500" />
        </Link>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900">
            KDV Kontrol — {session?.periodLabel}
            <span className="ml-2 text-sm font-normal text-gray-500">
              {TYPE_MAP[session?.type]?.short ?? session?.type}
            </span>
          </h2>
          {session?.taxpayer && (
            <p className="text-sm text-gray-500 mt-0.5">
              Mükellef: <span className="font-medium text-gray-700">
                {session.taxpayer.companyName || `${session.taxpayer.firstName ?? ''} ${session.taxpayer.lastName ?? ''}`.trim()}
              </span>
            </p>
          )}
        </div>
        {stats && (
          <button
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending || !stats.totalRecords || !stats.totalImages}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Play size={15} />
            {reconcile.isPending ? 'Eşleştiriliyor…' : 'Eşleştirmeyi Başlat'}
          </button>
        )}
      </div>

      {/* Sayaç kartları */}
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

      {/* OCR teyit uyarısı */}
      {needsOcrCount > 0 && (
        <div
          className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3 cursor-pointer"
          onClick={() => setActiveTab('images')}
        >
          <AlertTriangle size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-800">
              {needsOcrCount} görselde OCR sonucu teyit bekleniyor
            </p>
            <p className="text-xs text-orange-600 mt-0.5">
              Görsel sekmesine geçip eksik/hatalı alanları düzeltin, ardından teyit edin.
            </p>
          </div>
        </div>
      )}

      {/* Sekmeler */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          {(['upload', 'images', 'results'] as const).map((tab) => {
            const labels = { upload: 'Yükleme', images: `Görseller (${images?.length ?? 0})`, results: `Sonuçlar (${(results as any[])?.length ?? 0})` };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* YÜKLEME SEKMESİ */}
      {activeTab === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Excel */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-green-600" />
              <h3 className="font-semibold text-gray-900">1. Luca Excel Yükle</h3>
              {records?.length > 0 && (
                <span className="ml-auto text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  {records.length} satır yüklendi
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              {TYPE_MAP[session?.type]?.excelHint ?? 'Luca → Excel aktar'}<br />
              (<strong>{TYPE_MAP[session?.type]?.short ?? ''}</strong> seçili olduğundan emin olun)
            </p>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              onClick={() => excelRef.current?.click()}
            >
              <Upload size={24} className="text-gray-400 mx-auto mb-2" />
              {excelFile ? (
                <p className="text-sm text-gray-700 font-medium">{excelFile.name}</p>
              ) : (
                <p className="text-sm text-gray-400">Excel dosyasını buraya sürükleyin veya tıklayın</p>
              )}
              <p className="text-xs text-gray-400 mt-1">.xlsx veya .xls</p>
            </div>
            <input
              ref={excelRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => uploadExcel.mutate()}
              disabled={!excelFile || uploadExcel.isPending}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-2.5 rounded-lg text-sm font-medium"
            >
              {uploadExcel.isPending ? 'Okunuyor…' : 'Excel\'i Yükle ve Oku'}
            </button>
          </div>

          {/* Görseller */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ImageIcon size={18} className="text-purple-600" />
              <h3 className="font-semibold text-gray-900">2. Belge Görsellerini Yükle</h3>
              {images?.length > 0 && (
                <span className="ml-auto text-xs text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                  {images.length} görsel
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Mihsap'tan veya tarayıcıdan alınan fatura, fiş ve Z raporu görselleri<br />
              (JPEG, PNG — birden fazla dosya seçilebilir)
            </p>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
              onClick={() => imgRef.current?.click()}
            >
              <Upload size={24} className="text-gray-400 mx-auto mb-2" />
              {imageFiles.length > 0 ? (
                <p className="text-sm text-gray-700 font-medium">{imageFiles.length} dosya seçildi</p>
              ) : (
                <p className="text-sm text-gray-400">JPEG/PNG dosyalarını seçin</p>
              )}
            </div>
            <input
              ref={imgRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              multiple
              className="hidden"
              onChange={(e) => setImageFiles(Array.from(e.target.files ?? []))}
            />
            {/* İlerleme */}
            {Object.entries(uploadProgress).map(([name, pct]) => (
              <div key={name} className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span className="truncate max-w-[200px]">{name}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full">
                  <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
            <button
              onClick={handleImageUpload}
              disabled={!imageFiles.length || uploading}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white py-2.5 rounded-lg text-sm font-medium"
            >
              {uploading ? 'Yükleniyor…' : `${imageFiles.length || ''} Görseli Yükle ve OCR Başlat`}
            </button>
          </div>
        </div>
      )}

      {/* GÖRSELLER SEKMESİ */}
      {activeTab === 'images' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{images?.length ?? 0} görsel yüklendi</p>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['kdv-images', id] })} className="text-xs text-gray-400 flex items-center gap-1 hover:text-gray-600">
              <RefreshCw size={12} /> Yenile
            </button>
          </div>
          {images?.map((img: any) => {
            const edit = ocrEdit[img.id] ?? { belgeNo: img.ocrBelgeNo ?? '', date: img.ocrDate ?? '', kdvTutari: img.ocrKdvTutari ?? '' };
            const needsConfirm = ['LOW_CONFIDENCE', 'FAILED'].includes(img.ocrStatus) && !img.isManuallyConfirmed;

            return (
              <div key={img.id} className={`bg-white rounded-xl border p-4 ${needsConfirm ? 'border-orange-300' : 'border-gray-200'}`}>
                <div className="flex items-center gap-3">
                  <ImageIcon size={16} className="text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{img.originalName}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <OcrBadge status={img.ocrStatus} />
                      {img.ocrConfidence !== null && (
                        <span className="text-xs text-gray-400">Güven: %{Math.round(img.ocrConfidence * 100)}</span>
                      )}
                      {img.isManuallyConfirmed && (
                        <span className="text-xs text-emerald-600 font-medium">Teyit edildi</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      kdvApi.getImageUrl(img.id).then(({ url }) => window.open(url, '_blank'));
                    }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                    title="Görseli aç"
                  >
                    <Eye size={15} />
                  </button>
                </div>

                {/* OCR okuma sonuçları */}
                {img.ocrStatus !== 'PENDING' && img.ocrStatus !== 'PROCESSING' && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { key: 'belgeNo', label: 'Belge No', val: img.confirmedBelgeNo || img.ocrBelgeNo },
                      { key: 'date', label: 'Tarih', val: img.confirmedDate || img.ocrDate },
                      { key: 'kdvTutari', label: 'KDV Tutarı', val: img.confirmedKdvTutari || img.ocrKdvTutari },
                    ].map(({ key, label, val }) => (
                      <div key={key}>
                        <p className="text-xs text-gray-500 mb-1">{label}</p>
                        {needsConfirm ? (
                          <input
                            value={edit[key as keyof typeof edit] ?? val ?? ''}
                            onChange={(e) =>
                              setOcrEdit((prev) => ({
                                ...prev,
                                [img.id]: { ...edit, [key]: e.target.value },
                              }))
                            }
                            className="w-full border border-orange-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                            placeholder={`${label} girin`}
                          />
                        ) : (
                          <p className="text-xs font-medium text-gray-800">{val ?? '—'}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Teyit butonu */}
                {needsConfirm && (
                  <button
                    onClick={() => {
                      setOcrEdit((prev) => ({ ...prev, [img.id]: edit }));
                      confirmOcr.mutate({ imageId: img.id });
                    }}
                    disabled={confirmOcr.isPending}
                    className="mt-3 w-full bg-orange-500 hover:bg-orange-600 text-white text-xs py-2 rounded-lg font-medium"
                  >
                    Verileri Teyit Et
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* SONUÇLAR SEKMESİ */}
      {activeTab === 'results' && (
        <div className="space-y-2">
          {!results?.length ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Play size={32} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Henüz eşleştirme yapılmadı.</p>
              <button
                onClick={() => reconcile.mutate()}
                disabled={reconcile.isPending}
                className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Eşleştirmeyi Başlat
              </button>
            </div>
          ) : (
            results.map((r: any) => (
              <div
                key={r.id}
                className={`bg-white rounded-xl border overflow-hidden ${
                  r.status === 'MATCHED' ? 'border-green-200' :
                  r.status === 'NEEDS_REVIEW' ? 'border-orange-200' :
                  r.status === 'UNMATCHED' ? 'border-red-200' : 'border-gray-200'
                }`}
              >
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer"
                  onClick={() => setExpandedResult(expandedResult === r.id ? null : r.id)}
                >
                  <StatusBadge status={r.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex gap-4 text-xs text-gray-600">
                      {r.kdvRecord && (
                        <span>
                          <span className="font-medium">Excel:</span>{' '}
                          {r.kdvRecord.belgeNo ?? '—'} |{' '}
                          {r.kdvRecord.belgeDate
                            ? new Date(r.kdvRecord.belgeDate).toLocaleDateString('tr-TR')
                            : '—'}{' '}
                          | KDV: <span className="font-semibold">{parseFloat(r.kdvRecord.kdvTutari).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</span>
                        </span>
                      )}
                      {r.image && (
                        <span>
                          <span className="font-medium">Görsel:</span>{' '}
                          {r.image.confirmedBelgeNo || r.image.ocrBelgeNo || '—'} |{' '}
                          {r.image.confirmedDate || r.image.ocrDate || '—'} |{' '}
                          KDV: <span className="font-semibold">{r.image.confirmedKdvTutari || r.image.ocrKdvTutari || '—'}</span>
                        </span>
                      )}
                    </div>
                    {r.mismatchReasons?.length > 0 && (
                      <p className="text-xs text-orange-600 mt-0.5">{r.mismatchReasons.join(' • ')}</p>
                    )}
                  </div>
                  {r.matchScore !== null && (
                    <span className="text-xs text-gray-400">%{Math.round(r.matchScore * 100)}</span>
                  )}
                  {expandedResult === r.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                </div>

                {/* Genişletilmiş - Teyit / Reddet */}
                {expandedResult === r.id && ['NEEDS_REVIEW', 'PARTIAL_MATCH', 'UNMATCHED'].includes(r.status) && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 flex gap-3">
                    <button
                      onClick={() => resolve.mutate({ resultId: r.id, action: 'CONFIRMED' })}
                      disabled={resolve.isPending}
                      className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-2 rounded-lg font-medium"
                    >
                      <CheckCircle size={13} /> Teyit Et
                    </button>
                    <button
                      onClick={() => resolve.mutate({ resultId: r.id, action: 'REJECTED' })}
                      disabled={resolve.isPending}
                      className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-2 rounded-lg font-medium"
                    >
                      <XCircle size={13} /> Reddet
                    </button>
                    {r.image && (
                      <button
                        onClick={() => kdvApi.getImageUrl(r.image.id).then(({ url }) => window.open(url, '_blank'))}
                        className="flex items-center gap-1.5 border border-gray-300 text-gray-600 text-xs px-3 py-2 rounded-lg font-medium hover:bg-white"
                      >
                        <Eye size={13} /> Görseli Aç
                      </button>
                    )}
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
