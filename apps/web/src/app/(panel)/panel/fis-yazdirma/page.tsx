'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import TaxpayerSelect from '@/components/ui/TaxpayerSelect';
import { API_BASE, authorizedFetch } from '@/lib/api';
import {
  Upload,
  FileImage,
  CheckCircle2,
  ScanLine,
  AlertCircle,
  Pencil,
  Check,
  Download,
  X,
  Loader2,
  FileText,
  Clock,
  Trash2,
  Search,
  ChevronDown,
  Printer,
} from 'lucide-react';

/* ─── Tipler ────────────────────────────────────────────────── */
type Stage = 'upload' | 'scanning' | 'confirm' | 'generating' | 'done' | 'error';

interface Detected {
  filename: string;
  date: string; // YYYY-MM-DD
  belge_no?: string;
  cari?: string;
  vergi_no?: string;
  kdv_1?: string;
  kdv_10?: string;
  kdv_20?: string;
  toplam?: string;
}

interface Unread {
  filename: string;
  thumbnail: string;
}

interface ScanResponse {
  detected: Detected[];
  unread: Unread[];
  total: number;
}

/* ─── Yardımcı ──────────────────────────────────────────────── */
const API = API_BASE;

/**
 * Tek seferde gonderilebilecek en fazla gorsel — sunucudaki FIS_MAX_GORSEL
 * (apps/api/src/fis-yazdirma/fis-yazdirma.controller.ts) ile AYNI olmali.
 * Asilirsa multer istegi govde yuklenirken keser ve tarayici sebebini
 * goremeden "Failed to fetch" yazar.
 */
const FIS_MAX_GORSEL = 1000;

function isoToDisplay(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/* ─── Elapsed Timer ─────────────────────────────────────────── */
function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startTime]);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <span className="text-xs" style={{ color: 'rgba(255,255,255,.4)' }}>
      {min > 0 ? `${min}dk ${sec}s` : `${sec}s`} geçti
    </span>
  );
}

/* ─── Bileşen ───────────────────────────────────────────────── */
export default function FisYazdirmaPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scan sonuçları
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [allDates, setAllDates] = useState<Record<string, string>>({});
  const [allExtra, setAllExtra] = useState<Record<string, Omit<Detected, 'filename' | 'date'>>>({});
  const [editingFile, setEditingFile] = useState<string | null>(null);

  // MIHSAP faturaTarihi = muhasebede işlendiği kabul tarihi (fişin üzerindeki
  // fiziksel tarih değil). Bu tarih yasal/muhasebe açısından doğru olandır,
  // o yüzden OCR'a gerek yok — DB'den direkt kullan.
  const [knownDates, setKnownDates] = useState<Record<string, string>>({});


  // Simüle sayaç (scanning ekranı)
  const [simScanned, setSimScanned] = useState(0);
  const [scanStartTime, setScanStartTime] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // İstatistikler
  const [wordTotal, setWordTotal] = useState(0);
  const [error, setError] = useState('');

  // Yeni: Mükellef + dönem + sayfa/fiş
  const [mukellefName, setMukellefName] = useState('');
  const [donem, setDonem] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [pagesPerSheet, setPagesPerSheet] = useState<4 | 8 | 12>(8);
  const [taxpayers, setTaxpayers] = useState<Array<{ id: string; name: string }>>([]);
  // Kapak mükellef picker (KDV Kontrol / Mihsap deseni)
  const [mukellefPickerOpen, setMukellefPickerOpen] = useState(false);
  const [mukellefPickerSearch, setMukellefPickerSearch] = useState('');

  // Faturalardan çek modal
  const [showFetchModal, setShowFetchModal] = useState(false);
  const [fetchMukellefId, setFetchMukellefId] = useState('');
  const [fetchDonem, setFetchDonem] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState('');
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number } | null>(null);

  // Geçmiş çıktılar (Word arşivi)
  interface OutputRec {
    id: string;
    mukellefName: string | null;
    donem: string | null;
    fileCount: number;
    pagesPerSheet: number | null;
    filename: string;
    fileSize: number;
    createdAt: string;
    printStatus: 'REQUESTED' | 'PRINTING' | 'DONE' | 'FAILED' | null;
    printedAt: string | null;
    printError: string | null;
    printDeviceId: string | null;
  }
  const [outputs, setOutputs] = useState<OutputRec[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const [showOutputs, setShowOutputs] = useState(false);
  const [markingPrintId, setMarkingPrintId] = useState<string | null>(null);

  const loadOutputs = async () => {
    setOutputsLoading(true);
    try {
      const res = await authorizedFetch(`${API}/fis-yazdirma/outputs?limit=100`);
      if (res.ok) {
        const list = await res.json();
        setOutputs(Array.isArray(list) ? list : []);
      }
    } catch {
      /* sessiz */
    } finally {
      setOutputsLoading(false);
    }
  };

  useEffect(() => {
    loadOutputs();
  }, []);

  const downloadOutput = async (id: string, filename: string) => {
    try {
      const res = await authorizedFetch(`${API}/fis-yazdirma/outputs/${id}/download`);
      if (!res.ok) throw new Error('İndirilemedi');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`İndirme hatası: ${e.message ?? 'bilinmeyen'}`);
    }
  };

  const removeOutput = async (id: string) => {
    if (!confirm('Bu arşiv kaydını silmek istediğinizden emin misiniz?')) return;
    try {
      const res = await authorizedFetch(`${API}/fis-yazdirma/outputs/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Silinemedi');
      setOutputs((prev) => prev.filter((o) => o.id !== id));
    } catch (e: any) {
      alert(`Silme hatası: ${e.message ?? 'bilinmeyen'}`);
    }
  };

  const setOutputPrinted = async (output: OutputRec, printed: boolean) => {
    setMarkingPrintId(output.id);
    try {
      const res = await authorizedFetch(`${API}/fis-yazdirma/outputs/${output.id}/print-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ printed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? 'Yazdırma durumu güncellenemedi');
      }
      const updated = await res.json();
      setOutputs((prev) => prev.map((o) => (o.id === output.id ? { ...o, ...updated } : o)));
    } catch (e: any) {
      alert(`Yazdırma durumu hatası: ${e.message ?? 'bilinmeyen'}`);
    } finally {
      setMarkingPrintId(null);
    }
  };

  const formatSize = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(
        2,
        '0',
      )}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes(),
      ).padStart(2, '0')}`;
    } catch {
      return iso;
    }
  };

  const printSummary = outputs.reduce(
    (acc, o) => {
      if (o.printStatus === 'DONE') acc.printed += 1;
      else acc.unprinted += 1;
      return acc;
    },
    { printed: 0, unprinted: 0 },
  );

  const printStatusInfo = (o: OutputRec) => {
    switch (o.printStatus) {
      case 'DONE':
        return {
          label: 'Yazdırıldı',
          detail: o.printedAt ? formatDateTime(o.printedAt) : undefined,
          color: '#22c55e',
          bg: 'rgba(34,197,94,0.12)',
          border: 'rgba(34,197,94,0.24)',
          icon: CheckCircle2,
        };
      case 'REQUESTED':
        return {
          label: 'Kuyrukta',
          detail: 'agent bekliyor',
          color: '#d4b876',
          bg: 'rgba(212,184,118,0.12)',
          border: 'rgba(212,184,118,0.25)',
          icon: Clock,
        };
      case 'PRINTING':
        return {
          label: 'Yazdırılıyor',
          detail: o.printDeviceId || undefined,
          color: '#60a5fa',
          bg: 'rgba(96,165,250,0.12)',
          border: 'rgba(96,165,250,0.24)',
          icon: Loader2,
        };
      case 'FAILED':
        return {
          label: 'Yazdırılamadı',
          detail: o.printError || undefined,
          color: '#f43f5e',
          bg: 'rgba(244,63,94,0.12)',
          border: 'rgba(244,63,94,0.24)',
          icon: AlertCircle,
        };
      default:
        return {
          label: 'Yazdırılmadı',
          detail: 'bekliyor',
          color: '#d4b876',
          bg: 'rgba(212,184,118,0.10)',
          border: 'rgba(212,184,118,0.22)',
          icon: X,
        };
    }
  };

  useEffect(() => {
    authorizedFetch(`${API}/taxpayers`)
      .then((r) => r.json())
      .then((list: any[]) =>
        setTaxpayers(
          (list || []).map((t: any) => ({
            id: t.id,
            name: t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)',
          })),
        ),
      )
      .catch(() => {});
  }, []);


  /* ── Dosya ekleme ── */
  const addFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...arr.filter((f) => !existing.has(f.name))];
    });
  };

  /* ── Faturalardan Çek: mükellef+dönem fiş JPEG'lerini otomatik yükle ── */
  const handleFetchFromInvoices = async () => {
    if (!fetchMukellefId) {
      alert('Lütfen mükellef seçin');
      return;
    }
    if (!fetchDonem) {
      alert('Lütfen dönem seçin');
      return;
    }

    setFetchLoading(true);
    setFetchStatus('Fişler listeleniyor...');
    setFetchProgress(null);

    try {
      // 1) Mükellefin o dönemdeki FIS türü faturalarını listele
      const listUrl = `${API}/agent/mihsap/invoices?mukellefId=${encodeURIComponent(
        fetchMukellefId,
      )}&donem=${encodeURIComponent(fetchDonem)}&belgeTuru=FIS&limit=500`;

      const listRes = await authorizedFetch(listUrl);
      if (!listRes.ok) throw new Error(`Liste alınamadı: ${listRes.status}`);
      const invoices: any[] = await listRes.json();

      if (!invoices.length) {
        setFetchStatus(`Bu dönemde FIS bulunamadı. Önce "Faturalar" sayfasından MIHSAP'tan çekin.`);
        setFetchLoading(false);
        return;
      }

      // Hepsini dene — backend proxy ve blob mime type'a göre resim olup olmadığı anlaşılacak
      setFetchProgress({ current: 0, total: invoices.length });
      setFetchStatus(`${invoices.length} fiş indiriliyor...`);

      const fetched: File[] = [];
      const datesFromDb: Record<string, string> = {};
      let skippedNonImage = 0;
      // İNDİRİLEMEYEN FİŞ SESSİZCE DÜŞÜYORDU: döngü hatada `continue` diyor,
      // uyarı ise YALNIZCA hiçbiri inmediğinde gösteriliyordu. 456 fişin
      // 454'ü inince ekran "454 fiş yüklendi" yazıyor, Word 2 EKSİK fişle
      // üretiliyordu ve kimse fark etmiyordu. Artık sayılıyor ve söyleniyor.
      let basarisiz = 0;
      let firstError: { status: number; message: string } | null = null;
      for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];
        setFetchProgress({ current: i + 1, total: invoices.length });

        try {
          // ÖNCE KENDİ ARŞİVİMİZ (Drive), bulunamazsa uç kendisi MIHSAP'a düşer.
          // Eskiden doğrudan MIHSAP CDN'ine gidiliyordu: her fiş için canlı
          // dış istek demekti — MIHSAP yavaşlarsa/kesilirse fiş sessizce
          // düşüyordu. Oysa belgeler zaten Drive'a yedekleniyor
          // (Haziran/YORGUN NAKLİYAT: 456 fişin 456'sı yedekli).
          const imgRes = await authorizedFetch(
            `${API}/agent/drive/invoices/${inv.id}/file`,
          );
          if (!imgRes.ok) {
            basarisiz++;
            if (!firstError) {
              let msg = imgRes.statusText || '';
              try {
                const j = await imgRes.clone().json();
                msg = j.message || msg;
              } catch {
                /* ignore */
              }
              firstError = { status: imgRes.status, message: msg };
            }
            continue;
          }
          const blob = await imgRes.blob();

          // Sadece image türündekileri al
          if (!blob.type.startsWith('image/')) {
            skippedNonImage++;
            continue;
          }

          const ext = blob.type.split('/')[1]?.split(';')[0] || 'jpg';
          // ÖNEMLİ: Aynı mükellef içinde farklı tedarikçilerden gelen faturaların
          // faturaNo'ları çakışabilir (örn. iki farklı tedarikçinin "0070" fatura numarası).
          // Dosya ismini sadece faturaNo ile oluşturursak, knownDates ve allDates
          // sözlüklerinde son indirilen tarih diğerlerini ezer ve Word'de hepsi aynı
          // tarihte görünür. Bu nedenle invoice.id'nin son 8 karakterini sonuna ekleyip
          // dosya ismini GARANTİLİ olarak unique yapıyoruz.
          const idTail = String(inv.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || Math.random().toString(36).slice(2, 10);
          const baseNo = (inv.faturaNo || inv.id).toString().replace(/[^\w.-]/g, '_');
          const safeName = `${baseNo}_${idTail}.${ext}`;
          const file = new File([blob], safeName, { type: blob.type });
          fetched.push(file);

          // DB'deki faturaTarihi = muhasebede işlendiği kabul tarihi.
          // Fiş geç gelmiş olsa bile bu tarih yasal/muhasebe açısından doğrudur.
          // ÖNEMLİ: Postgres UTC olarak saklıyor, .slice(0,10) UTC gününü verir.
          // Türkiye saatinde (UTC+3) günü almak için toLocaleDateString / getDate kullanmak gerekir.
          // Aksi halde Postgres "2026-02-28T21:00:00.000Z" = TR 01.03.2026 gibi kayıtlar
          // Word çıktısında 28.02.2026 gibi yanlış güne kayar.
          const rawDate = inv.faturaTarihi || inv.belgeTarihi || inv.tarih;
          if (rawDate) {
            const d = new Date(rawDate as any);
            if (!isNaN(d.getTime())) {
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              const iso = `${y}-${m}-${day}`;
              if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
                datesFromDb[safeName] = iso;
              }
            }
          }
        } catch (e: any) {
          basarisiz++;
          if (!firstError) firstError = { status: 0, message: e?.message || 'network' };
          continue;
        }
      }

      if (!fetched.length) {
        if (skippedNonImage === invoices.length) {
          setFetchStatus(
            `${invoices.length} fişin hiçbiri görsel değil (XML/PDF). Fiş yazdırma sadece JPEG/PNG destekler.`,
          );
        } else if (firstError) {
          const hint =
            firstError.status === 404
              ? ' — backend henüz deploy olmamış olabilir (proxy endpoint eksik).'
              : firstError.status === 401 || firstError.status === 403
              ? ' — yetki sorunu (oturum süresi dolmuş olabilir).'
              : firstError.status === 0
              ? ' — ağ hatası / backend erişilemiyor.'
              : '';
          setFetchStatus(
            `Hata: backend ${firstError.status} döndü: ${firstError.message}${hint}`,
          );
        } else {
          setFetchStatus('Hiçbir fiş indirilemedi. Sebep belirsiz.');
        }
        setFetchLoading(false);
        return;
      }

      // 5) Dosyaları mevcut listeye ekle + kapak bilgilerini doldur
      addFiles(fetched);
      // DB'den gelen muhasebe kabul tarihlerini merge et (handleScan OCR'ı atlar)
      if (Object.keys(datesFromDb).length) {
        setKnownDates((prev) => ({ ...prev, ...datesFromDb }));
      }
      const selected = taxpayers.find((t) => t.id === fetchMukellefId);
      if (selected) setMukellefName(selected.name);
      setDonem(fetchDonem);

      const withDate = Object.keys(datesFromDb).length;
      const skipNote = skippedNonImage > 0 ? ` (${skippedNonImage} adet görsel olmayan atlandı)` : '';
      const dateNote = withDate > 0 ? ` — ${withDate} tanesinin kabul tarihi DB'den hazır, OCR'a girmez.` : '';

      if (basarisiz > 0) {
        // EKSİK BELGEYLE DEVAM ETMEK, eksik olduğunu bilmemekten iyidir —
        // ama kullanıcı bunu GÖRMELİ. Modal kapanmıyor ki fark edilsin.
        setFetchStatus(
          `DİKKAT: ${invoices.length} fişten ${basarisiz} tanesi indirilemedi, ${fetched.length} tanesi yüklendi. ` +
          `Bu hâliyle Word ${basarisiz} fiş EKSİK olur. "Faturalardan Çek"e tekrar basarsanız eksikler tamamlanır` +
          (firstError ? ` (ilk hata: ${firstError.status || 'ağ'} ${firstError.message})` : '') + '.',
        );
        setFetchLoading(false);
        setFetchProgress(null);
        return; // modal AÇIK kalsın
      }

      setFetchStatus(`${fetched.length} fiş başarıyla yüklendi${skipNote}.${dateNote}`);
      setTimeout(() => {
        setShowFetchModal(false);
        setFetchLoading(false);
        setFetchProgress(null);
        setFetchStatus('');
      }, 900);
    } catch (e: any) {
      setFetchStatus(`Hata: ${e.message ?? 'bilinmeyen'}`);
      setFetchLoading(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  /* ── Simüle sayaç başlat/durdur ── */
  const startSimCounter = (total: number) => {
    setSimScanned(0);
    const intervalMs = Math.max(400, Math.round((total * 4000) / total));
    intervalRef.current = setInterval(() => {
      setSimScanned((prev) => {
        if (prev >= total - 1) return prev;
        return prev + 1;
      });
    }, intervalMs);
  };

  const stopSimCounter = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopSimCounter();
  }, []);

  /* ── OCR Tarama ──
   * Akıllı: MIHSAP'tan DB tarihi bilinen fişler OCR'a girmez (ücretsiz + anında).
   * DB'deki faturaTarihi = muhasebede işlendiği kabul tarihidir — yasal olarak doğrudur.
   * Sadece manuel yüklenen / DB tarihi olmayanlar Claude'a gönderilir.
   */
  const handleScan = async () => {
    if (!files.length) return;
    setStage('scanning');
    setError('');
    setScanStartTime(Date.now());

    // Dosyaları ikiye ayır: DB tarihi olanlar vs OCR gerekenler
    const filesNeedOcr = files.filter((f) => !knownDates[f.name]);
    const filesFromDb = files.filter((f) => !!knownDates[f.name]);

    const dates: Record<string, string> = {};
    const extra: Record<string, Omit<Detected, 'filename' | 'date'>> = {};
    const detectedAll: Detected[] = [];

    filesFromDb.forEach((f) => {
      const iso = knownDates[f.name];
      dates[f.name] = iso;
      detectedAll.push({ filename: f.name, date: iso });
    });

    // Hiç OCR gereken dosya yoksa API'yi hiç çağırma — anında confirm ekranına geç
    if (!filesNeedOcr.length) {
      setScanResult({
        detected: detectedAll,
        unread: [],
        total: files.length,
      });
      setAllDates(dates);
      setAllExtra(extra);
      setStage('confirm');
      return;
    }

    if (filesNeedOcr.length > FIS_MAX_GORSEL) {
      setError(
        `${filesNeedOcr.length} görselin tarihi okunacak. Bu ekran tek seferde en fazla ` +
        `${FIS_MAX_GORSEL} görsel gönderebilir. Fişleri iki gruba bölün.`,
      );
      setStage('error');
      return;
    }

    // Sadece OCR gereken dosyaları backend'e yolla
    startSimCounter(filesNeedOcr.length);
    const fd = new FormData();
    filesNeedOcr.forEach((f) => fd.append('images', f, f.name));
    if (donem && /^\d{4}-\d{2}$/.test(donem)) fd.append('donem', donem);

    try {
      const res = await authorizedFetch(`${API}/fis-yazdirma/scan`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(`Sunucu hatası: ${res.status}`);
      const data: ScanResponse = await res.json();

      stopSimCounter();

      data.detected.forEach((d) => {
        dates[d.filename] = d.date;
        extra[d.filename] = {
          belge_no:  d.belge_no,
          cari:      d.cari,
          vergi_no:  d.vergi_no,
          kdv_1:     d.kdv_1,
          kdv_10:    d.kdv_10,
          kdv_20:    d.kdv_20,
          toplam:    d.toplam,
        } as any;
        detectedAll.push(d);
      });
      data.unread.forEach((u) => { dates[u.filename] = ''; });

      setScanResult({
        detected: detectedAll,
        unread: data.unread,
        total: files.length,
      });
      setAllDates(dates);
      setAllExtra(extra);
      setStage('confirm');
    } catch (e: any) {
      stopSimCounter();
      setError(e.message ?? 'Tarama hatası');
      setStage('error');
    }
  };

  /* ── Word Oluştur ── */
  // Sunucudaki FIS_MAX_GORSEL ile AYNI olmalı (fis-yazdirma.controller.ts).
  // Aşılırsa multer isteği gövde yüklenirken keser ve tarayıcı sebebini
  // göremeden "Failed to fetch" yazar — bu yüzden GÖNDERMEDEN ÖNCE bakıyoruz.
  
  const handleGenerate = async () => {
    if (!scanResult) return;

    const missing = scanResult.unread.filter((u) => !allDates[u.filename]);
    if (missing.length > 0) {
      alert(`Lütfen şu ${missing.length} fiş için tarih girin:\n${missing.map((u) => u.filename).join('\n')}`);
      return;
    }

    if (files.length > FIS_MAX_GORSEL) {
      setError(
        `${files.length} görsel seçili. Bu ekran tek seferde en fazla ${FIS_MAX_GORSEL} görsel ` +
        `gönderebilir. Fişleri iki gruba bölüp iki ayrı Word oluşturun.`,
      );
      setStage('error');
      return;
    }

    setStage('generating');

    const fd = new FormData();
    files.forEach((f) => fd.append('images', f, f.name));
    fd.append('allDates', JSON.stringify(allDates));
    if (mukellefName) fd.append('mukellef', mukellefName);
    if (donem) fd.append('donem', donem);
    fd.append('pagesPerSheet', String(pagesPerSheet));

    try {
      const res = await authorizedFetch(`${API}/fis-yazdirma/process`, {
        method: 'POST',
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
      // Arşiv listesini yenile
      loadOutputs();
    } catch (e: any) {
      // Ham "Failed to fetch" kullanıcıya hiçbir şey anlatmıyor; bağlantının
      // koptuğunu söyleyip ne yapacağını yazıyoruz.
      const ham = String(e?.message || '');
      setError(
        /failed to fetch|networkerror|load failed/i.test(ham)
          ? `Sunucuyla bağlantı koptu (${files.length} görsel gönderilirken). ` +
            'İnternet bağlantınızı kontrol edip tekrar deneyin; sürerse fişleri iki gruba bölün.'
          : ham || 'Word oluşturma hatası',
      );
      setStage('error');
    }
  };

  /* ── Reset ── */
  const reset = () => {
    stopSimCounter();
    setFiles([]);
    setScanResult(null);
    setAllDates({});
    setAllExtra({});
    setKnownDates({});
    setEditingFile(null);
    setSimScanned(0);
    setScanStartTime(0);
    setStage('upload');
    setError('');
  };

  /* ── RENDER ── */
  return (
    <div className="max-w-7xl space-y-3">
      {/* HEADER — AI Maliyet imzası: üst renk şeridi + radial parıltı + degrade ikon kutusu */}
      <div
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.06)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }}
        />
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Kontrol</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span
              className="grid place-items-center rounded-xl flex-shrink-0"
              style={{ width: 46, height: 46, background: 'linear-gradient(135deg, #d4b876, #b8a06f)', boxShadow: '0 8px 22px rgba(212,184,118,0.32)' }}
            >
              <Printer size={24} style={{ color: '#1a1410' }} />
            </span>
            <div>
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 }}>Fiş Yazdırma</h1>
              <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                ÖKC fişi görsellerini yükleyin — OCR ile tarih okunur, Word belgesi oluşturulur
              </p>
            </div>
          </div>
          {outputs.length > 0 && (
            <span
              className="hidden sm:inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold flex-shrink-0"
              style={{ background: 'rgba(212,184,118,0.10)', border: '1px solid rgba(212,184,118,0.28)', color: '#d4b876' }}
            >
              <Clock size={15} />
              {outputs.length} arşiv çıktısı
            </span>
          )}
        </div>
      </div>

      {/* ── UPLOAD ── */}
      {(stage === 'upload' || stage === 'error') && (
        <div className="space-y-4">
          {/* Faturalardan Çek butonu */}
          <div
            className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            style={{
              background: 'linear-gradient(135deg, rgba(212,184,118,.085) 0%, rgba(212,184,118,.02) 100%)',
              borderColor: 'rgba(212,184,118,.22)',
            }}
          >
            <span
              className="grid place-items-center rounded-xl flex-shrink-0"
              style={{ width: 40, height: 40, background: 'rgba(212,184,118,0.13)' }}
            >
              <Download size={19} style={{ color: '#d4b876' }} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
                Faturalardan Otomatik Çek
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Mükellef ve dönem seçip daha önce MIHSAP'tan indirilmiş fişleri otomatik yükleyin.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFetchModal(true)}
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410', boxShadow: '0 6px 18px rgba(212,184,118,0.28)' }}
            >
              <Download size={15} />
              Faturalardan Çek
            </button>
          </div>

          {/* Kapak bilgileri kartı */}
          <div
            className="rounded-xl border p-4"
            style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
          >
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
              <span className="grid place-items-center rounded-lg flex-shrink-0" style={{ width: 30, height: 30, background: 'rgba(212,184,118,0.12)' }}>
                <FileText size={16} style={{ color: '#d4b876' }} />
              </span>
              Kapak Sayfası Bilgileri <span className="font-medium" style={{ color: 'rgba(250,250,249,0.45)' }}>(opsiyonel)</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Mükellef
                </label>
                <button
                  type="button"
                  onClick={() => setMukellefPickerOpen(true)}
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none flex items-center gap-2 text-left hover:brightness-110 transition"
                  style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
                >
                  <span className="flex-1 truncate" style={{ color: mukellefName ? '#fafaf9' : 'rgba(250,250,249,0.45)' }}>
                    {mukellefName || 'Mükellef seç ya da boş bırakın'}
                  </span>
                  {mukellefName && (
                    <span
                      onClick={(e) => { e.stopPropagation(); setMukellefName(''); }}
                      className="p-0.5 rounded hover:bg-white/10"
                      style={{ color: 'rgba(250,250,249,0.5)' }}
                    >
                      <X size={13} />
                    </span>
                  )}
                  <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
                </button>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Dönem
                </label>
                <input
                  type="month"
                  value={donem}
                  onChange={(e) => setDonem(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                  style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Fiş Boyutu
                </label>
                <div className="flex gap-1">
                  {/* Eskiden "Sayfa Başına Fiş" yazıyordu ama bu söz TUTULMUYORDU:
                      8 seçilse bile sayfada 4 fiş çıkıyordu, çünkü sayfaya kaç
                      fiş sığacağı fişlerin BOYUNA bağlı. Seçim aslında fişin
                      büyüklüğünü belirliyor; etiket artık bunu dürüstçe söylüyor. */}
                  {([
                    [4, 'Büyük', '10,6 cm'],
                    [8, 'Orta', '5,2 cm'],
                    [12, 'Küçük', '4,1 cm'],
                  ] as Array<[number, string, string]>).map(([n, ad, cm]) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPagesPerSheet(n as any)}
                      title={`Fiş genişliği ${cm} — büyük seçim daha okunaklı, küçük seçim daha az sayfa`}
                      className="flex-1 rounded-lg border px-2 py-2 text-sm font-medium leading-tight"
                      style={{
                        background: pagesPerSheet === n ? 'rgba(184,160,111,.15)' : 'rgba(255,255,255,0.03)',
                        borderColor: pagesPerSheet === n ? '#b8a06f' : 'rgba(255,255,255,0.05)',
                        color: pagesPerSheet === n ? '#b8a06f' : '#fafaf9',
                      }}
                    >
                      {ad}
                      <span className="block text-[10px] opacity-60">{cm}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            className="rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all duration-200"
            style={{
              borderColor: dragging ? '#d4b876' : 'rgba(212,184,118,0.28)',
              background: dragging
                ? 'rgba(212,184,118,0.12)'
                : 'radial-gradient(60% 80% at 50% 0%, rgba(212,184,118,0.05), transparent 60%), rgba(255,255,255,0.015)',
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border"
              style={{
                background: dragging ? '#d4b876' : 'linear-gradient(135deg, rgba(212,184,118,0.18), rgba(212,184,118,0.06))',
                borderColor: dragging ? 'transparent' : 'rgba(212,184,118,0.2)',
              }}
            >
              <Upload size={28} style={{ color: dragging ? '#1a1410' : '#d4b876' }} />
            </div>
            <p className="font-bold text-sm" style={{ color: '#fafaf9', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              Fiş görsellerini buraya sürükleyin
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
              ya da <span style={{ color: '#d4b876', fontWeight: 600 }}>tıklayarak seçin</span> — JPEG, PNG · Çoklu seçim
            </p>
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </div>

          {files.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileImage size={15} style={{ color: '#d4b876' }} />
                  <span className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
                    {files.length} görsel seçildi
                  </span>
                </div>
                <button onClick={reset} className="text-xs" style={{ color: '#f43f5e' }}>Temizle</button>
              </div>
              <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="text-center">
                    <div
                      className="w-full h-16 rounded-lg flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <FileImage size={20} style={{ color: 'rgba(250,250,249,0.45)' }} />
                    </div>
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>{f.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm flex items-start gap-2"
              style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.28)', color: '#fb7185' }}>
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            disabled={files.length === 0}
            onClick={handleScan}
            className="btn-primary w-full py-3 text-sm"
            style={{
              background: 'linear-gradient(135deg, #e7cf95, #d4b876 55%, #b8a06f)',
              borderColor: 'transparent',
              color: '#1a1410',
              fontWeight: 700,
              boxShadow: files.length === 0 ? 'none' : '0 8px 24px rgba(212,184,118,0.3)',
            }}
          >
            <ScanLine size={16} />
            OCR ile Tara ({files.length} görsel)
          </button>

          {/* Geçmiş Çıktılar */}
          <div
            className="rounded-xl border mt-2"
            style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
          >
            <button
              type="button"
              onClick={() => setShowOutputs((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <Clock size={15} style={{ color: 'rgba(250,250,249,0.45)' }} />
                <span className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
                  Geçmiş Word Çıktıları
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: 'rgba(184,160,111,.15)', color: '#b8a06f' }}
                >
                  {outputs.length}
                </span>
                {outputs.length > 0 && (
                  <div className="hidden sm:flex items-center gap-1.5">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
                    >
                      {printSummary.printed} yazdırıldı
                    </span>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: 'rgba(255,255,255,0.045)', color: 'rgba(250,250,249,0.55)' }}
                    >
                      {printSummary.unprinted} bekliyor
                    </span>
                  </div>
                )}
              </div>
              <span className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
                {showOutputs ? 'Gizle' : 'Göster'}
              </span>
            </button>

            {showOutputs && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {outputsLoading ? (
                  <div className="px-4 py-8 text-center text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    Yükleniyor...
                  </div>
                ) : outputs.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <FileText
                      size={28}
                      className="mx-auto mb-2"
                      style={{ color: 'rgba(250,250,249,0.45)' }}
                    />
                    <p className="text-sm" style={{ color: '#fafaf9' }}>
                      Henüz arşivlenmiş Word çıktısı yok.
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Oluşturduğunuz her Word belgesi buraya otomatik kaydedilir.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    {outputs.map((o) => {
                      const info = printStatusInfo(o);
                      const StatusIcon = info.icon;
                      const isMarking = markingPrintId === o.id;
                      const isPrinted = o.printStatus === 'DONE';
                      return (
                        <div
                          key={o.id}
                          className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center"
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ background: 'rgba(184,160,111,.12)' }}
                            >
                              <FileText size={16} style={{ color: '#b8a06f' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className="text-sm font-medium truncate"
                                style={{ color: '#fafaf9' }}
                              >
                                {o.mukellefName || '(mükellef yok)'}
                                {o.donem && (
                                  <span
                                    className="ml-2 text-xs font-normal"
                                    style={{ color: 'rgba(250,250,249,0.45)' }}
                                  >
                                    · {o.donem}
                                  </span>
                                )}
                              </p>
                              <p
                                className="text-[11px] mt-0.5 truncate"
                                style={{ color: 'rgba(250,250,249,0.45)' }}
                              >
                                {o.fileCount} fiş · {formatSize(o.fileSize)} ·{' '}
                                {formatDateTime(o.createdAt)}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:flex-shrink-0">
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                              style={{ background: info.bg, borderColor: info.border, color: info.color }}
                              title={info.detail}
                            >
                              <StatusIcon size={13} className={o.printStatus === 'PRINTING' ? 'animate-spin' : ''} />
                              {info.label}
                              {info.detail && (
                                <span className="hidden md:inline font-normal opacity-75">
                                  · {info.detail}
                                </span>
                              )}
                            </span>
                            <button
                              onClick={() => setOutputPrinted(o, !isPrinted)}
                              disabled={isMarking}
                              className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50"
                              title={isPrinted ? 'Yazdırılmadı olarak işaretle' : 'Yazdırıldı olarak işaretle'}
                              style={{
                                color: isPrinted ? 'rgba(250,250,249,0.65)' : '#d4b876',
                                background: isPrinted ? 'rgba(255,255,255,0.045)' : 'rgba(212,184,118,0.08)',
                                border: `1px solid ${isPrinted ? 'rgba(255,255,255,0.08)' : 'rgba(212,184,118,0.22)'}`,
                              }}
                            >
                              {isMarking ? <Loader2 size={13} className="animate-spin" /> : isPrinted ? <X size={13} /> : <CheckCircle2 size={13} />}
                              {isPrinted ? 'Geri al' : 'İşaretle'}
                            </button>
                            <button
                              onClick={() => downloadOutput(o.id, o.filename)}
                              className="h-8 w-8 rounded-lg inline-flex items-center justify-center hover:bg-white/5 transition-colors"
                              title="İndir"
                              style={{ color: '#b8a06f' }}
                            >
                              <Download size={15} />
                            </button>
                            <button
                              onClick={() => removeOutput(o.id)}
                              className="h-8 w-8 rounded-lg inline-flex items-center justify-center hover:bg-white/5 transition-colors"
                              title="Sil"
                              style={{ color: '#f43f5e' }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SCANNING — Animasyonlu Ekran (koyu imza kartı) ── */}
      {stage === 'scanning' && (
        <div
          className="relative overflow-hidden rounded-2xl border p-8 flex flex-col items-center gap-6"
          style={{
            borderColor: 'rgba(212,184,118,0.2)',
            background: 'radial-gradient(90% 120% at 50% 0%, rgba(212,184,118,0.1), transparent 60%), #0f0d0b',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          }}
        >
          <div
            className="absolute inset-x-0 top-0 h-1"
            style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }}
          />
          {/* Pulsing halka animasyonu */}
          <div className="relative w-28 h-28 flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full opacity-20 animate-ping"
              style={{ background: '#d4b876' }}
            />
            <div
              className="absolute inset-2 rounded-full opacity-30 animate-ping"
              style={{ background: '#d4b876', animationDelay: '0.4s' }}
            />
            <div
              className="w-20 h-20 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: '#d4b876', borderRightColor: 'rgba(212,184,118,.2)' }}
            />
            <ScanLine size={28} className="absolute" style={{ color: '#d4b876' }} />
          </div>

          {/* Başlık */}
          <div className="text-center space-y-1">
            <p className="text-lg font-bold" style={{ color: '#fafaf9', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              OCR Tarama Devam Ediyor
            </p>
            <p className="text-sm" style={{ color: 'rgba(250,250,249,.5)' }}>
              {files.length} fiş için yaklaşık {Math.ceil(files.length * 4 / 60)} dakika sürebilir
            </p>
            {scanStartTime > 0 && <ElapsedTimer startTime={scanStartTime} />}
          </div>

          {/* Progress Bar */}
          <div className="w-full max-w-md">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'rgba(250,250,249,.45)' }}>
              <span>İlerleme</span>
              <span>%{Math.round((simScanned / Math.max(files.length, 1)) * 100)}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(simScanned / Math.max(files.length, 1)) * 100}%`,
                  background: 'linear-gradient(90deg, #b8a06f 0%, #d4b876 60%, #e7cf95 100%)',
                }}
              />
            </div>
          </div>

          {/* 3 Canlı Sayaç */}
          <div className="grid grid-cols-3 gap-4 w-full max-w-md">
            {[
              { label: 'Toplam Fiş',  value: files.length,                             color: '#fafaf9'   },
              { label: 'Taranan',     value: simScanned,                                color: '#34d399'   },
              { label: 'Kalan',       value: Math.max(0, files.length - simScanned),   color: '#d4b876'   },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-xl py-3 text-center border"
                style={{ background: 'rgba(255,255,255,.025)', borderColor: 'rgba(255,255,255,.06)' }}
              >
                <p className="text-2xl font-extrabold" style={{ color, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  {value}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(250,250,249,.45)' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CONFIRM ── */}
      {stage === 'confirm' && scanResult && (
        <div className="space-y-4">
          {/* Özet Bandı — sakin kartlar + ince vurgu çizgisi (imza kuralı) */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Toplam Fiş',     value: scanResult.total,           color: '#d4b876', bg: 'linear-gradient(135deg, rgba(212,184,118,0.12), rgba(212,184,118,0.02))', border: 'rgba(212,184,118,0.25)' },
              { label: 'Tarih Okundu',   value: scanResult.detected.length, color: '#34d399', bg: 'linear-gradient(135deg, rgba(52,211,153,0.1), transparent)',          border: 'rgba(52,211,153,0.22)' },
              { label: 'Teyit Bekliyor', value: scanResult.unread.length,   color: '#fafaf9', bg: 'rgba(255,255,255,0.022)',                                            border: 'rgba(255,255,255,0.06)' },
            ].map(({ label, value, color, bg, border }) => (
              <div
                key={label}
                className="relative overflow-hidden rounded-2xl border p-5"
                style={{ background: bg, borderColor: border }}
              >
                <span className="absolute left-0 top-0 bottom-0" style={{ width: 3, background: color }} />
                <p className="text-3xl font-extrabold" style={{ color, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  {value}
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>{label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* SOL: Tarih Okundu */}
            {scanResult.detected.length > 0 && (
              <div className="lg:col-span-2">
                <div className="card overflow-hidden">
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.03)' }}>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Tarih Okundu ({scanResult.detected.length})
                    </p>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '600px' }}>
                    {scanResult.detected.map((d) => (
                      <div
                        key={d.filename}
                        className="flex items-start gap-3 px-4 py-2.5"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                      >
                        <CheckCircle2 size={14} style={{ color: '#34d399', flexShrink: 0, marginTop: 2 }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: 'rgba(250,250,249,0.7)' }}>{d.filename}</p>
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
                                <Check size={12} style={{ color: '#34d399' }} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              <span
                                className="text-xs font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399' }}
                              >
                                {isoToDisplay(allDates[d.filename] ?? d.date)}
                              </span>
                              {knownDates[d.filename] && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: 'rgba(96,165,250,0.14)', color: '#60a5fa' }}
                                  title="MIHSAP'ta işlendiği kabul tarihi (muhasebe açısından doğru olan)"
                                >
                                  DB
                                </span>
                              )}
                              <button onClick={() => setEditingFile(d.filename)}>
                                <Pencil size={10} style={{ color: 'rgba(250,250,249,0.45)' }} />
                              </button>
                            </div>
                          )}
                          {/* Ek alanlar (varsa) */}
                          {(d.belge_no || d.cari || d.toplam) && (
                            <p className="text-[10px] mt-1 truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>
                              {[d.belge_no && `No: ${d.belge_no}`, d.toplam && `Top: ${d.toplam}`]
                                .filter(Boolean).join(' | ')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SAĞ: Teyit Gereken */}
            <div className={scanResult.detected.length > 0 ? 'lg:col-span-3' : 'lg:col-span-5'}>
              {scanResult.unread.length === 0 ? (
                <div className="card flex flex-col items-center py-12 text-center">
                  <CheckCircle2 size={40} style={{ color: '#34d399' }} />
                  <p className="font-bold mt-3" style={{ color: '#fafaf9', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    Tüm fişlerden tarih okundu!
                  </p>
                  <p className="text-sm mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    Doğrudan Word belgesi oluşturabilirsiniz.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Teyit Gereken ({scanResult.unread.length})
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Her fiş için tarih seçin · "Öncekinden kopyala" ile hızlandırın
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        // Tüm boş teyit fişlerine donem'in 1. günü doldur
                        const base = donem ? `${donem}-01` : '';
                        if (!base) return;
                        setAllDates((prev) => {
                          const next = { ...prev };
                          scanResult.unread.forEach((u) => {
                            if (!next[u.filename]) next[u.filename] = base;
                          });
                          return next;
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(184,160,111,.12)', color: '#b8a06f' }}
                    >
                      Hepsine Dönem Başı ({donem}-01)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Son dolu tarihi bul, boşları onunla doldur
                        const dates = scanResult.unread.map((u) => allDates[u.filename]).filter(Boolean);
                        const last = dates[dates.length - 1];
                        if (!last) return;
                        setAllDates((prev) => {
                          const next = { ...prev };
                          scanResult.unread.forEach((u) => {
                            if (!next[u.filename]) next[u.filename] = last;
                          });
                          return next;
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
                    >
                      Boşları Son Tarihle Doldur
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 overflow-y-auto" style={{ maxHeight: '600px' }}>
                    {scanResult.unread.map((u, idx) => {
                      const prev = idx > 0 ? scanResult.unread[idx - 1] : null;
                      const prevDate = prev ? allDates[prev.filename] : '';
                      return (
                        <div
                          key={u.filename}
                          className="rounded-xl overflow-hidden"
                          style={{
                            border: allDates[u.filename] ? '2px solid #34d399' : '2px solid rgba(255,255,255,0.05)',
                            background: 'rgba(255,255,255,0.03)',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                          }}
                        >
                          {u.thumbnail ? (
                            <img src={u.thumbnail} alt={u.filename} className="w-full object-cover" style={{ height: 180 }} />
                          ) : (
                            <div className="w-full flex items-center justify-center" style={{ height: 180, background: 'rgba(255,255,255,0.03)' }}>
                              <FileImage size={32} style={{ color: 'rgba(250,250,249,0.45)' }} />
                            </div>
                          )}
                          <div className="p-2.5 space-y-2">
                            <p className="text-xs font-medium truncate" style={{ color: 'rgba(250,250,249,0.7)' }}>
                              {u.filename}
                            </p>
                            <input
                              type="date"
                              value={allDates[u.filename] ?? ''}
                              onChange={(e) => setAllDates((prev) => ({ ...prev, [u.filename]: e.target.value }))}
                              className="input-base w-full text-xs py-1.5"
                              style={{ borderColor: allDates[u.filename] ? '#34d399' : 'rgba(255,255,255,0.05)' }}
                            />
                            {prevDate && !allDates[u.filename] && (
                              <button
                                type="button"
                                onClick={() => setAllDates((p) => ({ ...p, [u.filename]: prevDate }))}
                                className="w-full text-[10px] py-1 rounded"
                                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.45)' }}
                              >
                                ⬆ Önceki: {isoToDisplay(prevDate)}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Alt Butonlar */}
          <div className="flex flex-wrap gap-3 pt-2">
            <button onClick={reset} className="btn-secondary flex-shrink-0 px-6">
              Geri
            </button>
            <button
              onClick={handleGenerate}
              className="btn-primary flex-1 py-3"
              style={{
                background: 'linear-gradient(135deg, #e7cf95, #d4b876 55%, #b8a06f)',
                borderColor: 'transparent',
                color: '#1a1410',
                fontWeight: 700,
                boxShadow: '0 8px 24px rgba(212,184,118,0.3)',
              }}
            >
              {scanResult.unread.filter((u) => !allDates[u.filename]).length > 0 ? (
                <><AlertCircle size={15} />Word Oluştur ({scanResult.unread.filter((u) => !allDates[u.filename]).length} teyit bekliyor)</>
              ) : (
                <><CheckCircle2 size={15} />Word Belgesi Oluştur ({scanResult.total} fiş)</>
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
            style={{ borderTopColor: '#d4b876', borderRightColor: '#d4b876' }}
          />
          <div className="text-center">
            <p className="font-bold" style={{ color: '#fafaf9', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              Word belgesi hazırlanıyor...
            </p>
            <p className="text-sm mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Fişler tarihe göre sıralanıyor ve belgeye aktarılıyor.
            </p>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {stage === 'done' && (
        <div className="card flex flex-col items-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(52,211,153,0.12)' }}>
            <CheckCircle2 size={36} style={{ color: '#34d399' }} />
          </div>
          <div>
            <h2 className="text-xl font-bold" style={{ color: '#fafaf9', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              Word Belgesi İndirildi!
            </h2>
            <p className="text-sm mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
              {wordTotal} fiş tarih sırasında düzenlenerek Word'e aktarıldı.
            </p>
          </div>
          <div className="flex gap-3 mt-2">
            <button
              onClick={reset}
              className="btn-primary px-8"
              style={{
                background: 'linear-gradient(135deg, #e7cf95, #d4b876 55%, #b8a06f)',
                borderColor: 'transparent',
                color: '#1a1410',
                fontWeight: 700,
                boxShadow: '0 8px 24px rgba(212,184,118,0.3)',
              }}
            >
              Yeni İşlem Başlat
            </button>
          </div>
        </div>
      )}

      {/* ── FATURALARDAN ÇEK MODAL — Portal ile body'ye ── */}
      {showFetchModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{
            background: 'rgba(0,0,0,.85)',
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
          onClick={() => !fetchLoading && setShowFetchModal(false)}
        >
          <div
            className="rounded-2xl max-w-lg w-full p-6 space-y-4"
            style={{
              background: '#12100c',
              border: '1px solid rgba(184,160,111,0.18)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,.7)',
              color: '#fafaf9',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold" style={{ color: '#fafaf9', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  Faturalardan Fiş Çek
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Seçtiğiniz mükellefin ilgili dönemindeki JPEG fişler yüklenir.
                </p>
              </div>
              <button
                onClick={() => !fetchLoading && setShowFetchModal(false)}
                disabled={fetchLoading}
                className="p-1 rounded hover:bg-white/5"
                style={{ color: 'rgba(250,250,249,0.45)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Mükellef *
                </label>
                <TaxpayerSelect
                  taxpayers={taxpayers.map((t) => ({
                    id: t.id,
                    companyName: t.name,
                    taxNumber: (t as any).taxNumber || null,
                  }))}
                  value={fetchMukellefId}
                  onChange={setFetchMukellefId}
                  disabled={fetchLoading}
                  placeholder="— mükellef seçin —"
                />
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Dönem *
                </label>
                <input
                  type="month"
                  value={fetchDonem}
                  onChange={(e) => setFetchDonem(e.target.value)}
                  disabled={fetchLoading}
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                  style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
                />
              </div>
            </div>

            {fetchStatus && (
              <div
                className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                style={{
                  background: fetchStatus.startsWith('Hata') ? 'rgba(244,63,94,0.1)' : 'rgba(212,184,118,.08)',
                  color: fetchStatus.startsWith('Hata') ? '#fb7185' : '#fafaf9',
                }}
              >
                {fetchLoading && <Loader2 size={14} className="animate-spin flex-shrink-0" />}
                <span>{fetchStatus}</span>
              </div>
            )}

            {fetchProgress && (
              <div>
                <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  <span>İndiriliyor</span>
                  <span>
                    {fetchProgress.current} / {fetchProgress.total}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${(fetchProgress.current / Math.max(fetchProgress.total, 1)) * 100}%`,
                      background: '#b8a06f',
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowFetchModal(false)}
                disabled={fetchLoading}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
              >
                İptal
              </button>
              <button
                onClick={handleFetchFromInvoices}
                disabled={fetchLoading || !fetchMukellefId || !fetchDonem}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410' }}
              >
                {fetchLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Çekiliyor
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    Fişleri Çek
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* KAPAK MÜKELLEF PICKER MODAL (KDV Kontrol / Mihsap deseni) */}
      {mukellefPickerOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[8vh]"
          style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }}
          onClick={() => setMukellefPickerOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
            style={{ background: 'rgba(17,14,12,0.98)', borderColor: 'rgba(255,255,255,0.05)', maxHeight: '84vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'linear-gradient(135deg, rgba(184,160,111,.08), transparent)' }}
            >
              <div>
                <h3 className="text-lg font-bold" style={{ color: '#fafaf9' }}>Mükellef Seç</h3>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  {taxpayers.length} mükellef · kapak sayfası için
                </p>
              </div>
              <button
                onClick={() => setMukellefPickerOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5"
                style={{ color: 'rgba(250,250,249,0.45)' }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)' }}
              >
                <Search size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
                <input
                  value={mukellefPickerSearch}
                  onChange={(e) => setMukellefPickerSearch(e.target.value)}
                  placeholder="Mükellef adı ara…"
                  autoFocus
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: '#fafaf9' }}
                />
                {mukellefPickerSearch && (
                  <button onClick={() => setMukellefPickerSearch('')} style={{ color: 'rgba(250,250,249,0.45)' }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {taxpayers.filter((t) => t.name.toLowerCase().includes(mukellefPickerSearch.toLowerCase())).length === 0 ? (
                <div className="text-sm p-8 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Sonuç yok</div>
              ) : (
                taxpayers
                  .filter((t) => t.name.toLowerCase().includes(mukellefPickerSearch.toLowerCase()))
                  .map((t) => {
                    const checked = mukellefName === t.name;
                    const initial = t.name.charAt(0).toUpperCase();
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setMukellefName(t.name);
                          setMukellefPickerOpen(false);
                          setMukellefPickerSearch('');
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left transition-colors"
                        style={{ background: checked ? 'rgba(184,160,111,.08)' : 'transparent', color: '#fafaf9' }}
                        onMouseEnter={(e) => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.03)'; }}
                        onMouseLeave={(e) => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{
                            background: checked ? 'linear-gradient(135deg, #b8a06f, #8b7649)' : 'rgba(255,255,255,0.05)',
                            color: checked ? '#0f0d0b' : 'rgba(250,250,249,0.45)',
                          }}
                        >
                          {initial}
                        </div>
                        <span className="flex-1 truncate font-medium">{t.name}</span>
                      </button>
                    );
                  })
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
