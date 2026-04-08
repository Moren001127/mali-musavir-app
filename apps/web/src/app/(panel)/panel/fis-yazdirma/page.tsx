'use client';

import { useState, useRef, useCallback } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Upload,
  FileImage,
  CheckCircle2,
  ScanLine,
  AlertCircle,
  Pencil,
  Check,
} from 'lucide-react';

/* ─── Tipler ────────────────────────────────────────────────── */
type Stage = 'upload' | 'scanning' | 'confirm' | 'generating' | 'done' | 'error';

interface Detected {
  filename: string;
  date: string; // YYYY-MM-DD
}

interface Unread {
  filename: string;
  thumbnail: string; // base64
}

interface ScanResponse {
  detected: Detected[];
  unread: Unread[];
  total: number;
}

/* ─── Yardımcı ──────────────────────────────────────────────── */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('accessToken') ?? '';
}

function isoToDisplay(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function displayToIso(display: string) {
  // date input'tan gelen değer zaten YYYY-MM-DD
  return display;
}

/* ─── Bileşen ───────────────────────────────────────────────── */
export default function FisYazdirmaPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scan sonuçları
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  // Teyit edilen tarihler (detected olanlar otomatik dolu gelir, unread için kullanıcı doldurur)
  const [allDates, setAllDates] = useState<Record<string, string>>({});
  // Detected listesinde edit modu
  const [editingFile, setEditingFile] = useState<string | null>(null);

  // İstatistikler
  const [wordTotal, setWordTotal] = useState(0);
  const [error, setError] = useState('');

  /* ── Dosya ekleme ── */
  const addFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...arr.filter((f) => !existing.has(f.name))];
    });
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  /* ── OCR Tarama ── */
  const handleScan = async () => {
    if (!files.length) return;
    setStage('scanning');
    setError('');

    const fd = new FormData();
    files.forEach((f) => fd.append('images', f, f.name));

    try {
      const res = await fetch(`${API}/fis-yazdirma/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error(`Sunucu hatası: ${res.status}`);
      const data: ScanResponse = await res.json();

      // allDates'i doldur (detected olanlar otomatik)
      const dates: Record<string, string> = {};
      data.detected.forEach((d) => { dates[d.filename] = d.date; });
      // unread için boş bırak
      data.unread.forEach((u) => { dates[u.filename] = ''; });

      setScanResult(data);
      setAllDates(dates);
      setStage('confirm');
    } catch (e: any) {
      setError(e.message ?? 'Tarama hatası');
      setStage('error');
    }
  };

  /* ── Word Oluştur ── */
  const handleGenerate = async () => {
    if (!scanResult) return;

    // Eksik tarih var mı?
    const missing = scanResult.unread.filter((u) => !allDates[u.filename]);
    if (missing.length > 0) {
      alert(`Lütfen şu ${missing.length} fiş için tarih girin:\n${missing.map((u) => u.filename).join('\n')}`);
      return;
    }

    setStage('generating');

    const fd = new FormData();
    files.forEach((f) => fd.append('images', f, f.name));
    fd.append('allDates', JSON.stringify(allDates));

    try {
      const res = await fetch(`${API}/fis-yazdirma/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Sunucu hatası: ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fisler_${new Date().toISOString().slice(0, 10)}.docx`;
      a.click();
      URL.revokeObjectURL(url);

      setWordTotal(parseInt(res.headers.get('X-Total') ?? String(files.length)));
      setStage('done');
    } catch (e: any) {
      setError(e.message ?? 'Word oluşturma hatası');
      setStage('error');
    }
  };

  /* ── Reset ── */
  const reset = () => {
    setFiles([]);
    setScanResult(null);
    setAllDates({});
    setEditingFile(null);
    setStage('upload');
    setError('');
  };

  /* ── RENDER ── */
  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Fiş Yazdırma"
        subtitle="ÖKC fişi görsellerini yükleyin — OCR ile tarih okunur, Word belgesi oluşturulur"
      />

      {/* ── UPLOAD ── */}
      {(stage === 'upload' || stage === 'error') && (
        <div className="space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            className="rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all duration-200"
            style={{
              borderColor: dragging ? 'var(--gold)' : 'var(--border)',
              background: dragging ? 'var(--gold-pale)' : 'var(--surface)',
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: dragging ? 'var(--gold)' : 'var(--bg)' }}
            >
              <Upload size={28} style={{ color: dragging ? 'white' : 'var(--text-muted)' }} />
            </div>
            <p className="font-bold text-sm" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              Fiş görsellerini buraya sürükleyin
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              ya da <span style={{ color: 'var(--gold)', fontWeight: 600 }}>tıklayarak seçin</span> — JPEG, PNG · Çoklu seçim
            </p>
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </div>

          {files.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileImage size={15} style={{ color: 'var(--gold)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    {files.length} görsel seçildi
                  </span>
                </div>
                <button onClick={reset} className="text-xs" style={{ color: 'var(--danger)' }}>Temizle</button>
              </div>
              <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="text-center">
                    <div
                      className="w-full h-16 rounded-lg flex items-center justify-center"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
                    >
                      <FileImage size={20} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{f.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm flex items-start gap-2"
              style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}>
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            disabled={files.length === 0}
            onClick={handleScan}
            className="btn-primary w-full py-3 text-sm"
          >
            <ScanLine size={16} />
            OCR ile Tara ({files.length} görsel)
          </button>
        </div>
      )}

      {/* ── SCANNING ── */}
      {stage === 'scanning' && (
        <div className="card flex flex-col items-center py-16 gap-5">
          <div
            className="w-20 h-20 rounded-full border-4 border-transparent animate-spin"
            style={{ borderTopColor: 'var(--gold)', borderRightColor: 'var(--navy-400, #3D5A8A)' }}
          />
          <div className="text-center">
            <p className="font-bold text-lg" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              {files.length} görsel OCR ile taranıyor...
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Her fişten tarih okunuyor. 84 fiş için yaklaşık 1-2 dakika sürebilir.
            </p>
          </div>
        </div>
      )}

      {/* ── CONFIRM ── */}
      {stage === 'confirm' && scanResult && (
        <div className="space-y-4">
          {/* Özet Bandı */}
          <div
            className="grid grid-cols-3 gap-4 rounded-xl p-5"
            style={{ background: 'var(--navy)', boxShadow: 'var(--shadow-md)' }}
          >
            {[
              { label: 'Toplam Fiş',       value: scanResult.total,           color: 'white'               },
              { label: 'Tarih Okundu',     value: scanResult.detected.length, color: '#6EE7B7'             },
              { label: 'Teyit Bekliyor',   value: scanResult.unread.length,   color: 'var(--gold-light)'   },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className="text-3xl font-extrabold" style={{ color, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  {value}
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,.5)' }}>{label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* SOL: Tarih Okundu Listesi */}
            {scanResult.detected.length > 0 && (
              <div className="lg:col-span-2">
                <div className="card overflow-hidden">
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                      Tarih Okundu ({scanResult.detected.length})
                    </p>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '600px' }}>
                    {scanResult.detected.map((d) => (
                      <div
                        key={d.filename}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        <CheckCircle2 size={14} style={{ color: '#059669', flexShrink: 0 }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{d.filename}</p>
                          {editingFile === d.filename ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <input
                                type="date"
                                value={allDates[d.filename] ?? d.date}
                                onChange={(e) => setAllDates((p) => ({ ...p, [d.filename]: e.target.value }))}
                                className="input-base py-0.5 text-xs"
                                style={{ maxWidth: 130 }}
                              />
                              <button onClick={() => setEditingFile(null)} className="p-1">
                                <Check size={12} style={{ color: '#059669' }} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                className="text-xs font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: '#ECFDF5', color: '#059669' }}
                              >
                                {isoToDisplay(allDates[d.filename] ?? d.date)}
                              </span>
                              <button onClick={() => setEditingFile(d.filename)}>
                                <Pencil size={10} style={{ color: 'var(--text-muted)' }} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SAĞ: Teyit Gereken Fişler */}
            <div className={scanResult.detected.length > 0 ? 'lg:col-span-3' : 'lg:col-span-5'}>
              {scanResult.unread.length === 0 ? (
                <div className="card flex flex-col items-center py-12 text-center">
                  <CheckCircle2 size={40} style={{ color: '#059669' }} />
                  <p className="font-bold mt-3" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    Tüm fişlerden tarih okundu!
                  </p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                    Doğrudan Word belgesi oluşturabilirsiniz.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                      Teyit Gereken Fişler ({scanResult.unread.length})
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Her fiş için tarih seçin
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 overflow-y-auto" style={{ maxHeight: '600px' }}>
                    {scanResult.unread.map((u) => (
                      <div
                        key={u.filename}
                        className="rounded-xl overflow-hidden"
                        style={{
                          border: allDates[u.filename]
                            ? '2px solid #059669'
                            : '2px solid var(--border)',
                          background: 'var(--surface)',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        {/* Görsel */}
                        {u.thumbnail ? (
                          <img
                            src={u.thumbnail}
                            alt={u.filename}
                            className="w-full object-cover"
                            style={{ height: 180 }}
                          />
                        ) : (
                          <div
                            className="w-full flex items-center justify-center"
                            style={{ height: 180, background: 'var(--bg)' }}
                          >
                            <FileImage size={32} style={{ color: 'var(--text-muted)' }} />
                          </div>
                        )}

                        {/* Dosya adı + tarih input */}
                        <div className="p-2.5 space-y-2">
                          <p className="text-xs font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
                            {u.filename}
                          </p>
                          <input
                            type="date"
                            value={allDates[u.filename] ?? ''}
                            onChange={(e) =>
                              setAllDates((prev) => ({ ...prev, [u.filename]: e.target.value }))
                            }
                            className="input-base w-full text-xs py-1.5"
                            style={{
                              borderColor: allDates[u.filename] ? '#059669' : 'var(--border)',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Alt Butonlar */}
          <div className="flex gap-3 pt-2">
            <button onClick={reset} className="btn-secondary flex-shrink-0 px-6">
              Geri
            </button>
            <button onClick={handleGenerate} className="btn-primary flex-1 py-3">
              {scanResult.unread.filter((u) => !allDates[u.filename]).length > 0 ? (
                <>
                  <AlertCircle size={15} />
                  Word Oluştur ({scanResult.unread.filter((u) => !allDates[u.filename]).length} teyit bekliyor)
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  Word Belgesi Oluştur ({scanResult.total} fiş)
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── GENERATING ── */}
      {stage === 'generating' && (
        <div className="card flex flex-col items-center py-16 gap-5">
          <div
            className="w-16 h-16 rounded-full border-4 border-transparent animate-spin"
            style={{ borderTopColor: 'var(--gold)', borderRightColor: 'var(--navy-400, #3D5A8A)' }}
          />
          <div className="text-center">
            <p className="font-bold" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              Word belgesi hazırlanıyor...
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Fişler tarihe göre sıralanıyor ve belgeye aktarılıyor.
            </p>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {stage === 'done' && (
        <div className="card flex flex-col items-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: '#ECFDF5' }}>
            <CheckCircle2 size={36} style={{ color: '#059669' }} />
          </div>
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              Word Belgesi İndirildi!
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              {wordTotal} fiş tarih sırasında düzenlenerek Word'e aktarıldı.
            </p>
          </div>
          <button onClick={reset} className="btn-primary px-8 mt-2">
            Yeni İşlem Başlat
          </button>
        </div>
      )}
    </div>
  );
}
