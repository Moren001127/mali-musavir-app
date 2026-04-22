'use client';

import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  beyanKayitlariApi,
  BeyanKaydi,
  BeyanTipi,
  BEYAN_TIPI_LABEL,
  ImportResult,
  beyanKaydiMukellefAdi,
} from '@/lib/beyan-kayitlari';
import {
  Search, Download, Upload, FileText, Trash2, ChevronRight,
  CheckCircle2, AlertCircle, FileQuestion, Loader2, X as IconX,
  FolderUp, FileX2, Wallet, Archive, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

const GOLD = '#d4b876';

type FilterKey = 'all' | BeyanTipi;

const FILTER_KEYS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'KDV1', label: 'KDV1' },
  { key: 'KDV2', label: 'KDV2' },
  { key: 'MUHSGK', label: 'MUHSGK' },
  { key: 'DAMGA', label: 'Damga' },
  { key: 'POSET', label: 'Poşet' },
  { key: 'KURUMLAR', label: 'Kurumlar' },
  { key: 'GELIR', label: 'Gelir' },
  { key: 'GECICI_VERGI', label: 'Geçici V.' },
  { key: 'EDEFTER', label: 'E-Defter' },
];

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n) + ' ₺';
}

function fmtDonem(d: string): string {
  // "2026-03" → "Mart 2026"; "2025-YIL" → "2025 Yıllık"
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    return `${aylar[Number(m[2]) - 1]} ${m[1]}`;
  }
  if (/^\d{4}-YIL$/.test(d)) return d.replace('-YIL', ' Yıllık');
  return d;
}

export default function BeyannamelerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [importModal, setImportModal] = useState(false);

  const { data: kayitlar = [], isLoading } = useQuery<BeyanKaydi[]>({
    queryKey: ['beyan-kayitlari', filter],
    queryFn: () => beyanKayitlariApi.list({
      beyanTipi: filter === 'all' ? undefined : filter,
      limit: 1000,
    }),
  });

  const { data: ozet } = useQuery({
    queryKey: ['beyan-kayitlari-ozet'],
    queryFn: () => beyanKayitlariApi.ozet(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => beyanKayitlariApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.success('Kayıt silindi');
    },
    onError: (e: any) => toast.error(e?.message || 'Silinemedi'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return kayitlar;
    return kayitlar.filter((k) => {
      const hay = `${beyanKaydiMukellefAdi(k)} ${k.taxpayer?.taxNumber || ''} ${k.onayNo || ''} ${k.donem} ${k.beyanTipi}`.toLowerCase();
      return hay.includes(q);
    });
  }, [kayitlar, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: kayitlar.length };
    for (const k of kayitlar) c[k.beyanTipi] = (c[k.beyanTipi] || 0) + 1;
    return c;
  }, [kayitlar]);

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5 flex-wrap gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Belgeler</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Beyannameler</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Hattat'tan veya başka kaynaktan PDF klasörünü yükle, her beyanname otomatik parse edilip arşivlenir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportModal(true)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            <FolderUp size={15} /> PDF Klasörü Aktar
          </button>
        </div>
      </div>

      {/* ÖZET KARTLARI — rakamsal tutar yok, sadece sayım */}
      {ozet && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OzetCard label="Toplam Beyanname" value={ozet.toplam.toLocaleString('tr-TR')} icon={FileText} />
          <OzetCard label="KDV Kayıtları" value={(ozet.byTip.KDV1 || 0) + (ozet.byTip.KDV2 || 0)} icon={FileText} />
          <OzetCard label="MUHSGK Kayıtları" value={ozet.byTip.MUHSGK || 0} icon={FileText} />
          <OzetCard label="Geçici Vergi" value={ozet.byTip.GECICI_VERGI || 0} icon={FileText} />
        </div>
      )}

      {/* ARAMA + FİLTRELER */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mükellef, VKN, onay no, dönem ara..."
            className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTER_KEYS.map((f) => {
            const active = filter === f.key;
            const count = counts[f.key] || 0;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition-all"
                style={{
                  background: active ? 'rgba(212,184,118,0.16)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: active ? GOLD : 'rgba(250,250,249,0.65)',
                }}
              >
                {f.label} {count > 0 && <span className="opacity-60 ml-0.5">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* LİSTE */}
      {isLoading && <div className="text-stone-500 text-sm">Yükleniyor...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-xl p-16 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <FileText className="w-12 h-12 mx-auto mb-4" style={{ color: 'rgba(250,250,249,0.2)' }} />
          <p className="text-[14px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {search || filter !== 'all' ? 'Filtreye uyan kayıt yok.' : 'Henüz beyanname kaydedilmemiş.'}
          </p>
          {kayitlar.length === 0 && (
            <button
              onClick={() => setImportModal(true)}
              className="mt-4 text-[13px] font-semibold"
              style={{ color: GOLD }}
            >
              + Hattat'tan PDF klasörü yükle
            </button>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <table className="w-full text-[13px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
            <thead style={{ background: 'rgba(184,160,111,0.08)' }}>
              <tr className="text-left text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>
                <th className="px-4 py-3">Mükellef</th>
                <th className="px-4 py-3">Tip</th>
                <th className="px-4 py-3">Dönem</th>
                <th className="px-4 py-3">Onay No</th>
                <th className="px-4 py-3">Beyanname</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => (
                <tr key={k.id} className="group" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium truncate max-w-[260px]" style={{ color: '#fafaf9' }}>
                      {beyanKaydiMukellefAdi(k)}
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {k.taxpayer?.taxNumber}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' }}>
                      {BEYAN_TIPI_LABEL[k.beyanTipi]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px]">{fmtDonem(k.donem)}</td>
                  <td className="px-4 py-2.5 text-[12px] font-mono" style={{ color: 'rgba(250,250,249,0.55)' }}>
                    {k.onayNo || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      {k.beyannameUrl ? (
                        <a
                          href={beyanKayitlariApi.beyannameUrl(k.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}
                        >
                          <FileText size={11} /> Beyanname
                        </a>
                      ) : (
                        <span className="text-[10.5px] italic" style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>
                      )}
                      {k.pdfUrl && (
                        <a
                          href={beyanKayitlariApi.pdfUrl(k.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md"
                          style={{ background: 'rgba(212,184,118,0.1)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' }}
                        >
                          <FileText size={11} /> Tahakkuk
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => {
                          if (confirm(`Bu kaydı silmek istediğine emin misin?\n\n${beyanKaydiMukellefAdi(k)} · ${BEYAN_TIPI_LABEL[k.beyanTipi]} · ${fmtDonem(k.donem)}`)) {
                            deleteMut.mutate(k.id);
                          }
                        }}
                        className="p-1.5 rounded-md hover:bg-rose-500/10"
                        style={{ color: 'rgba(244,63,94,0.7)' }}
                        title="Sil"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* IMPORT MODAL */}
      {importModal && (
        <ImportModal onClose={() => setImportModal(false)} onDone={() => {
          qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
          qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
        }} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ÖZET KARTI
// ════════════════════════════════════════════════════════════
function OzetCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
        <div className="text-[18px] font-semibold tabular-nums mt-0.5" style={{ color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// IMPORT MODAL — klasör/dosya yükleme + AI parse progress
// ════════════════════════════════════════════════════════════
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  type Mod = 'zip' | 'pdf';
  const [mode, setMode] = useState<Mod>('zip');
  const [files, setFiles] = useState<File[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [zipOzet, setZipOzet] = useState<{ mukellefBulundu: number; mukellefYok: number; kayitEklendi: number; mevcut: number; parseHatasi: number } | null>(null);
  const [eslesmeyenler, setEslesmeyenler] = useState<Array<{ klasor: string; hattatId: string; ad: string; pdfSayisi: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const addFiles = (fl: FileList | null) => {
    if (!fl) return;
    const onlyPdf = Array.from(fl).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    setFiles((prev) => {
      const existing = new Set(prev.map((x) => `${x.name}-${x.size}`));
      const fresh = onlyPdf.filter((f) => !existing.has(`${f.name}-${f.size}`));
      return [...prev, ...fresh];
    });
  };

  const start = async () => {
    if (mode === 'pdf' && files.length === 0) return;
    if (mode === 'zip' && !zipFile) return;
    setUploading(true);
    setProgress(0);
    setResults(null);
    setZipOzet(null);
    setEslesmeyenler([]);
    try {
      if (mode === 'zip' && zipFile) {
        const resp = await beyanKayitlariApi.importZip(zipFile, (p) => setProgress(p));
        setResults(resp.sonuclar);
        setZipOzet(resp.ozet);
        setEslesmeyenler(resp.eslesmeyenler);
        if (resp.ozet.kayitEklendi > 0) toast.success(`${resp.ozet.kayitEklendi} beyanname kaydı eklendi`);
        if (resp.ozet.mukellefYok > 0) toast.warning(`${resp.ozet.mukellefYok} mükellef eşleşmedi — aşağıda listelendi`);
      } else {
        const resp = await beyanKayitlariApi.importPdfs(files, (p) => setProgress(p));
        setResults(resp.results);
        const okCount = resp.results.filter((r) => r.durum === 'ok').length;
        const errCount = resp.results.filter((r) => r.durum !== 'ok').length;
        if (okCount > 0) toast.success(`${okCount} beyanname başarıyla eklendi`);
        if (errCount > 0) toast.warning(`${errCount} dosya işlenemedi — detay aşağıda`);
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setZipFile(null);
    setResults(null);
    setZipOzet(null);
    setEslesmeyenler([]);
    setProgress(0);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={uploading ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl flex flex-col overflow-hidden"
        style={{ background: '#11100c', border: '1px solid rgba(184,160,111,0.3)', maxHeight: '85vh' }}
      >
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, color: '#fafaf9' }}>PDF Klasörü Aktar</h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Hattat'tan indirdiğin tahakkuk fişi PDF'lerini toplu yükle. AI her dosyayı okuyup arşive kaydeder.
            </p>
          </div>
          <button onClick={onClose} disabled={uploading} className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-40" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <IconX size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!results && (
            <>
              {/* Mod sekmeleri — ZIP vs PDF */}
              <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <button
                  type="button"
                  onClick={() => setMode('zip')}
                  className="flex-1 py-3 text-[13px] font-semibold transition inline-flex items-center justify-center gap-2"
                  style={{
                    background: mode === 'zip' ? 'rgba(212,184,118,0.14)' : 'transparent',
                    color: mode === 'zip' ? GOLD : 'rgba(250,250,249,0.55)',
                  }}
                >
                  <Archive size={15} /> Hattat ZIP (Önerilen)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('pdf')}
                  className="flex-1 py-3 text-[13px] font-semibold transition inline-flex items-center justify-center gap-2"
                  style={{
                    background: mode === 'pdf' ? 'rgba(212,184,118,0.14)' : 'transparent',
                    color: mode === 'pdf' ? GOLD : 'rgba(250,250,249,0.55)',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Sparkles size={15} /> Tek Tek PDF (AI parse)
                </button>
              </div>

              {/* Açıklama */}
              {mode === 'zip' && (
                <div className="text-[12px] rounded-lg px-3 py-2.5" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.75)' }}>
                  <strong style={{ color: GOLD }}>Hattat ZIP modu</strong> — Hattat'tan dönem bazlı indirdiğin ZIP dosyasını olduğu gibi yükle. Klasör yapısı ve dosya adlarından otomatik parse edilir. AI'a gerek yok, hızlı + doğru.
                </div>
              )}
              {mode === 'pdf' && (
                <div className="text-[12px] rounded-lg px-3 py-2.5" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.75)' }}>
                  <strong style={{ color: GOLD }}>PDF modu</strong> — Tek tek PDF seçersin, Claude AI her birini okuyup parse eder. ZIP modu varsa ONU kullan — çok daha hızlı.
                </div>
              )}

              {/* ZIP MODU — tek dosya */}
              {mode === 'zip' && (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      const f = e.dataTransfer.files[0];
                      if (f && (/\.zip$/i.test(f.name) || f.type === 'application/zip')) setZipFile(f);
                    }}
                    onClick={() => zipRef.current?.click()}
                    className="rounded-xl p-8 text-center cursor-pointer transition-all"
                    style={{
                      background: zipFile ? 'rgba(34,197,94,0.06)' : 'rgba(212,184,118,0.04)',
                      border: `2px dashed ${zipFile ? 'rgba(34,197,94,0.4)' : 'rgba(212,184,118,0.35)'}`,
                    }}
                  >
                    <Archive className="w-12 h-12 mx-auto mb-3" style={{ color: zipFile ? '#22c55e' : GOLD }} />
                    {zipFile ? (
                      <>
                        <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{zipFile.name}</p>
                        <p className="text-[12px] mt-1 tabular-nums" style={{ color: 'rgba(250,250,249,0.6)' }}>
                          {(zipFile.size / 1024 / 1024).toFixed(1)} MB · Yüklemeye hazır
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setZipFile(null); }}
                          className="text-[11px] mt-2"
                          style={{ color: '#f43f5e' }}
                        >
                          Kaldır
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Hattat ZIP dosyasını buraya bırak</p>
                        <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
                          Örn. "2025 1. DÖNEM.zip" · Max 500 MB
                        </p>
                      </>
                    )}
                    <input
                      ref={zipRef}
                      type="file"
                      accept=".zip,application/zip,application/x-zip-compressed"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setZipFile(f);
                      }}
                    />
                  </div>
                </>
              )}

              {/* PDF MODU — mevcut */}
              {mode === 'pdf' && (<>
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); }}
                className="rounded-xl p-8 text-center cursor-pointer transition-all"
                style={{
                  background: 'rgba(212,184,118,0.04)',
                  border: '2px dashed rgba(212,184,118,0.35)',
                }}
                onClick={() => inputRef.current?.click()}
              >
                <FolderUp className="w-12 h-12 mx-auto mb-3" style={{ color: GOLD }} />
                <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
                  PDF dosyaları buraya sürükle
                </p>
                <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  veya aşağıdaki butonlardan seç — tek dosya veya tüm klasör
                </p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.85)' }}
                  >
                    <Upload size={13} /> Dosya Seç
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.85)' }}
                  >
                    <FolderUp size={13} /> Klasör Seç
                  </button>
                </div>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                {/* webkitdirectory tipik olarak TS'de bilinmez; any cast ile */}
                <input
                  ref={folderRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                  // @ts-expect-error - webkitdirectory is non-standard but supported in Chromium/WebKit
                  webkitdirectory=""
                  directory=""
                />
              </div>

              {/* Dosya listesi */}
              {files.length > 0 && (
                <div className="rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-[12.5px] font-semibold" style={{ color: '#fafaf9' }}>
                      {files.length} PDF dosyası hazır
                    </span>
                    <button onClick={() => setFiles([])} className="text-[11px]" style={{ color: '#f43f5e' }}>Temizle</button>
                  </div>
                  <ul className="max-h-[200px] overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    {files.slice(0, 50).map((f, i) => (
                      <li key={i} className="px-4 py-1.5 flex items-center justify-between text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-[10.5px] font-mono ml-3" style={{ color: 'rgba(250,250,249,0.4)' }}>{(f.size / 1024).toFixed(0)} KB</span>
                      </li>
                    ))}
                    {files.length > 50 && (
                      <li className="px-4 py-1.5 text-center text-[11px] italic" style={{ color: 'rgba(250,250,249,0.4)' }}>
                        ... ve {files.length - 50} dosya daha
                      </li>
                    )}
                  </ul>
                </div>
              )}
              </>)}{/* end mode === 'pdf' */}
            </>
          )}

          {/* Upload progress */}
          {uploading && (
            <div className="rounded-xl p-4" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.25)' }}>
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="animate-spin" size={16} style={{ color: GOLD }} />
                <span className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                  {progress < 100 ? `Yükleniyor: %${progress}` : 'AI dosyaları parse ediyor...'}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full transition-all" style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${GOLD}aa, ${GOLD})` }} />
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
                {progress < 100
                  ? 'Dosyalar sunucuya gönderiliyor...'
                  : 'Her PDF Claude AI ile okunuyor, VKN/tip/dönem/tutar çıkarılıyor. Dosya başına ~3-5 saniye sürer.'}
              </p>
            </div>
          )}

          {/* ZIP özet kartları (zip modunda) */}
          {zipOzet && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11.5px]">
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#22c55e' }}>Eklendi</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#22c55e' }}>{zipOzet.kayitEklendi}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(250,250,249,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: 'rgba(250,250,249,0.7)' }}>Zaten Var</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{zipOzet.mevcut}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#22c55e' }}>Mükellef Eşleşti</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#22c55e' }}>{zipOzet.mukellefBulundu}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#f59e0b' }}>Mükellef Yok</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#f59e0b' }}>{zipOzet.mukellefYok}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#ef4444' }}>Parse Hatası</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#ef4444' }}>{zipOzet.parseHatasi}</div>
              </div>
            </div>
          )}

          {/* Eşleşmeyen mükellefler listesi */}
          {eslesmeyenler.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
                <h4 className="text-[13px] font-semibold" style={{ color: '#f59e0b' }}>
                  ⚠ {eslesmeyenler.length} mükellef portalınızda eşleşmedi
                </h4>
                <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
                  Bu mükellefleri ya portal'a eklemeniz ya da isim/VKN'sini Hattat'taki ile eşitlemeniz gerek:
                </p>
              </div>
              <ul className="max-h-[200px] overflow-y-auto divide-y text-[12px]" style={{ borderColor: 'rgba(245,158,11,0.1)' }}>
                {eslesmeyenler.map((e, i) => (
                  <li key={i} className="px-4 py-1.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate" style={{ color: '#fafaf9' }}>{e.ad}</div>
                      <div className="text-[10.5px] font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>Hattat ID: {e.hattatId}</div>
                    </div>
                    <span className="text-[10.5px] opacity-60 whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.6)' }}>{e.pdfSayisi} PDF</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sonuç listesi */}
          {results && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <h4 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>İşlem Sonucu</h4>
                <div className="flex items-center gap-4 mt-2 text-[11.5px]">
                  <span className="flex items-center gap-1.5" style={{ color: '#22c55e' }}>
                    <CheckCircle2 size={13} /> {results.filter((r) => r.durum === 'ok').length} eklendi
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    <FileQuestion size={13} /> {results.filter((r) => r.durum === 'mevcut').length} zaten var
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
                    <AlertCircle size={13} /> {results.filter((r) => r.durum === 'mukellef_yok').length} mükellef yok
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                    <FileX2 size={13} /> {results.filter((r) => r.durum === 'parse_hatasi' || r.durum === 'hata').length} hata
                  </span>
                </div>
              </div>
              <ul className="max-h-[300px] overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {results.map((r, i) => (
                  <li key={i} className="px-4 py-2 text-[12px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate" style={{ color: '#fafaf9' }}>{r.dosyaAdi}</div>
                        {r.parsed?.mukellefAdi && (
                          <div className="text-[10.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                            {r.parsed.mukellefAdi} · {r.parsed.beyanTipi || '?'} · {r.parsed.donem || '?'}
                          </div>
                        )}
                        {r.sebep && (
                          <div className="text-[10.5px] mt-0.5 italic" style={{ color: '#f59e0b' }}>{r.sebep}</div>
                        )}
                      </div>
                      <ResultBadge durum={r.durum} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {!results ? (
            <>
              <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                {mode === 'zip'
                  ? 'ZIP içeriği sunucuda açılır, klasör/dosya adları parse edilir — AI yok, saniyeler içinde biter.'
                  : 'Her PDF için Claude AI ~3-5 saniye sürer. 100 PDF = ~6-8 dakika.'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={uploading}
                  className="px-4 py-2 text-[12.5px] font-medium rounded-md disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
                >
                  İptal
                </button>
                <button
                  onClick={start}
                  disabled={uploading || (mode === 'pdf' ? files.length === 0 : !zipFile)}
                  className="px-5 py-2 text-[12.5px] font-bold rounded-md disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
                >
                  {uploading
                    ? 'Yükleniyor...'
                    : mode === 'zip'
                      ? (zipFile ? 'ZIP\'i İşle' : 'ZIP seçin')
                      : `${files.length} dosyayı yükle`}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={reset}
                className="px-4 py-2 text-[12.5px] font-medium rounded-md"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
              >
                Yeni Yükleme
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2 text-[12.5px] font-bold rounded-md"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
              >
                Kapat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultBadge({ durum }: { durum: ImportResult['durum'] }) {
  const cfg: Record<ImportResult['durum'], { label: string; bg: string; color: string }> = {
    ok:             { label: 'Eklendi',       bg: 'rgba(34,197,94,0.1)',  color: '#22c55e' },
    mevcut:         { label: 'Zaten var',     bg: 'rgba(250,250,249,0.05)', color: 'rgba(250,250,249,0.6)' },
    mukellef_yok:   { label: 'Mükellef yok',  bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' },
    parse_hatasi:   { label: 'Parse hatası',  bg: 'rgba(239,68,68,0.1)',  color: '#ef4444' },
    hata:           { label: 'Hata',          bg: 'rgba(239,68,68,0.1)',  color: '#ef4444' },
  };
  const c = cfg[durum];
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}
