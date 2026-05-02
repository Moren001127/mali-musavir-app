'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { mizanApi, fmtTRY } from '@/lib/mizan';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Download, Search, X, ChevronDown, Users, Calendar, Sparkles, AlertTriangle,
  CheckCircle2, XCircle, Loader2, FileSpreadsheet, Trash2, Eye, Upload,
  FileText, Lock, Unlock,
} from 'lucide-react';

const GOLD = '#d4b876';

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
};
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

const DONEM_TIPLERI = [
  { value: 'AYLIK',     label: 'Aylık' },
  { value: 'GECICI_Q1', label: '1. Dönem (Ocak – Mart)' },
  { value: 'GECICI_Q2', label: '2. Dönem (Nisan – Haziran)' },
  { value: 'GECICI_Q3', label: '3. Dönem (Temmuz – Eylül)' },
  { value: 'GECICI_Q4', label: '4. Dönem (Ekim – Aralık)' },
  { value: 'YILLIK',    label: 'Yıllık' },
] as const;

const AYLAR = [
  { v: '01', l: 'Ocak' }, { v: '02', l: 'Şubat' }, { v: '03', l: 'Mart' },
  { v: '04', l: 'Nisan' }, { v: '05', l: 'Mayıs' }, { v: '06', l: 'Haziran' },
  { v: '07', l: 'Temmuz' }, { v: '08', l: 'Ağustos' }, { v: '09', l: 'Eylül' },
  { v: '10', l: 'Ekim' }, { v: '11', l: 'Kasım' }, { v: '12', l: 'Aralık' },
];

export default function MizanPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewId = searchParams.get('id');

  const now = new Date();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [donemTipi, setDonemTipi] = useState<any>('AYLIK');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: mizanList = [] } = useQuery<any[]>({
    queryKey: ['mizan-list', taxpayerId],
    queryFn: () => mizanApi.list(taxpayerId || undefined),
    refetchInterval: 5000,
  });

  // Aktif: URL'deki id varsa onu getir, yoksa en son import
  const effectiveId = viewId ||
    mizanList.find((m) => m.taxpayerId === taxpayerId && m.donem === toDonem(year, month, donemTipi))?.id ||
    (mizanList[0]?.id ?? null);

  const { data: mizan } = useQuery<any>({
    queryKey: ['mizan', effectiveId],
    queryFn: () => mizanApi.get(effectiveId!),
    enabled: !!effectiveId,
  });

  const importMut = useMutation({
    mutationFn: () =>
      mizanApi.importFromLuca({
        taxpayerId,
        donem: toDonem(year, month, donemTipi),
        donemTipi,
      }),
    onSuccess: (d: any) => {
      toast.success(`Mizan çekildi — ${d.rows} hesap satırı`);
      qc.invalidateQueries({ queryKey: ['mizan-list'] });
      qc.invalidateQueries({ queryKey: ['mizan', d.mizanId] });
      // Yeni mizana otomatik yönlen
      if (d.mizanId) router.replace(`/panel/mizan?id=${d.mizanId}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Mizan çekilemedi'),
  });

  // === Extension-first Luca çekimi (multi-user) ===
  // Kullanıcının tarayıcısında Luca açıkken moren-agent.js job'u alır,
  // Excel indirir, backend'e yükler. Bu sayede Railway'de headless browser
  // tutma zorunluluğu yok — her personel kendi oturumuyla çekim yapar.
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [lucaStatus, setLucaStatus] = useState<string>('');
  const [lucaLogLines, setLucaLogLines] = useState<string[]>([]);

  const lucaAgentMut = useMutation({
    mutationFn: () =>
      mizanApi.fetchFromLucaAgent({
        mukellefId: taxpayerId,
        donem: toDonem(year, month, donemTipi),
        donemTipi,
      }),
    onSuccess: (d) => {
      setLucaJobId(d.jobId);
      setLucaStatus('Luca sekmesini açık tut — moren-agent 15 sn içinde alacak…');
      setLucaLogLines([]);
      toast.info('Luca job oluşturuldu · Luca sekmesini açık tut', { duration: 5000 });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || e?.message || 'Luca job oluşturulamadı'),
  });

  // Job polling — React Query v5'te onSuccess kaldırıldı, useEffect ile state güncelle
  const lucaJobQuery = useQuery({
    queryKey: ['luca-job', lucaJobId],
    queryFn: () => mizanApi.getLucaJob(lucaJobId!),
    enabled: !!lucaJobId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    const d = lucaJobQuery.data as any;
    if (!d) return;
    // Backend `/mizan/luca-job/:id` endpoint `{job, mizan}` dönüyor;
    // eski kod direkt `d` bekliyordu — her ikisini de destekle.
    const job = d?.job ?? d;
    if (!job?.status) return;
    const s = job.status;
    const log = job.errorMsg || '';
    const lines = log ? log.split('\n').filter((l: string) => l.trim()) : [];
    setLucaLogLines(lines);
    const lastLine = lines[lines.length - 1] || '';
    if (s === 'pending') setLucaStatus(lastLine || 'Luca sekmesindeki agent bekleniyor…');
    else if (s === 'running') setLucaStatus(lastLine || 'Luca sayfasından Excel çekiliyor…');
    else if (s === 'done') {
      setLucaStatus('Tamamlandı ✓');
      setTimeout(() => { setLucaJobId(null); setLucaStatus(''); setLucaLogLines([]); }, 2000);
      toast.success('Mizan Luca\'dan çekildi');
      qc.invalidateQueries({ queryKey: ['mizan-list'] });
      if (d?.mizan?.id) router.replace(`/panel/mizan?id=${d.mizan.id}`);
    } else if (s === 'failed') {
      setLucaStatus(`Hata: ${lastLine || 'bilinmeyen'} — kapatmak için İptal'e basın`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lucaJobQuery.data]);

  // Manuel Excel yükleme — Luca dışında kendi dosyandan (xlsx)
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadMut = useMutation({
    mutationFn: (file: File) =>
      mizanApi.uploadExcel(
        { taxpayerId, donem: toDonem(year, month, donemTipi), donemTipi },
        file,
      ),
    onSuccess: (d: any) => {
      toast.success(`Mizan yüklendi — ${d.rows} hesap satırı`);
      qc.invalidateQueries({ queryKey: ['mizan-list'] });
      qc.invalidateQueries({ queryKey: ['mizan', d.mizanId] });
      if (uploadRef.current) uploadRef.current.value = '';
      // Yeni mizana otomatik yönlen — ekranda hemen görünsün
      if (d.mizanId) router.replace(`/panel/mizan?id=${d.mizanId}`);
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || e?.message || 'Mizan yüklenemedi');
      if (uploadRef.current) uploadRef.current.value = '';
    },
  });

  const handleUploadClick = () => {
    if (!taxpayerId) { toast.error('Önce mükellef seçin'); setPickerOpen(true); return; }
    uploadRef.current?.click();
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      toast.error('Sadece .xlsx / .xls dosyası kabul edilir');
      return;
    }
    uploadMut.mutate(f);
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => mizanApi.remove(id),
    onSuccess: () => {
      toast.success('Mizan silindi');
      qc.invalidateQueries({ queryKey: ['mizan-list'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Silinemedi'),
  });

  const lockMut = useMutation({
    mutationFn: (args: { id: string; note?: string }) => mizanApi.lock(args.id, args.note),
    onSuccess: () => {
      toast.success('Mizan kesin kayıt olarak işaretlendi');
      qc.invalidateQueries({ queryKey: ['mizan-list'] });
      qc.invalidateQueries({ queryKey: ['mizan'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kilitlenemedi'),
  });

  const unlockMut = useMutation({
    mutationFn: (args: { id: string; reason: string }) => mizanApi.unlock(args.id, args.reason),
    onSuccess: () => {
      toast.success('Mizan kilidi açıldı');
      qc.invalidateQueries({ queryKey: ['mizan-list'] });
      qc.invalidateQueries({ queryKey: ['mizan'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kilit açılamadı'),
  });

  const handleLock = (id: string) => {
    const note = prompt('Kesin kayıt notu (opsiyonel — örn: 2026 Mart beyanname no):') || '';
    if (!confirm('Mizan kesin kayıt olarak işaretlenecek. Sonra düzeltme yapılamaz. Devam?')) return;
    lockMut.mutate({ id, note });
  };
  const handleUnlock = (id: string) => {
    const reason = prompt('Kilidi açma sebebi (en az 5 karakter):') || '';
    if (reason.length < 5) return toast.error('En az 5 karakter gerekli');
    unlockMut.mutate({ id, reason });
  };

  const filteredTp = taxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase()),
  );

  const hesaplar = (mizan?.hesaplar ?? []) as any[];
  const anomaliler = (mizan?.anomaliler ?? []) as any[];
  const toplamBorc = mizan?.toplamBorc ?? 0;
  const toplamAlacak = mizan?.toplamAlacak ?? 0;

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Sparkles size={10} className="inline mr-1" /> Kontrol
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          Mizan
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Kendi Excel dosyanı yükle veya Luca'dan tek tuşla çek. Hesap kodu denetimlerini otomatik yap. Geçmiş dönemleri arşivden görüntüle.
        </p>
      </div>

      {/* Komut barı */}
      <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[260px]">
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Users size={11} className="inline mr-1" /> Mükellef
            </label>
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none flex items-center gap-2 text-left"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              <span className="flex-1 truncate" style={{ color: selectedTp ? '#fafaf9' : 'rgba(250,250,249,0.45)' }}>
                {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
              </span>
              {selectedTp && (
                <span onClick={(e) => { e.stopPropagation(); setTaxpayerId(''); }} className="p-0.5 rounded hover:bg-white/10">
                  <X size={13} />
                </span>
              )}
              <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
            </button>
          </div>

          <div>
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Tür
            </label>
            <select
              value={donemTipi}
              onChange={(e) => setDonemTipi(e.target.value)}
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9', minWidth: 220 }}
            >
              {DONEM_TIPLERI.map((t) => (
                <option key={t.value} value={t.value} style={{ background: '#0f0d0b' }}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Calendar size={11} className="inline mr-1" /> Yıl
            </label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9', minWidth: 110 }}
            >
              {Array.from({ length: 6 }, (_, i) => now.getFullYear() + 1 - i).map((y) => (
                <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
              ))}
            </select>
          </div>

          {donemTipi === 'AYLIK' && (
            <div>
              <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                Ay
              </label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2.5 rounded-lg text-sm border outline-none"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9', minWidth: 140 }}
              >
                {AYLAR.map((a) => (
                  <option key={a.v} value={a.v} style={{ background: '#0f0d0b' }}>{a.l}</option>
                ))}
              </select>
            </div>
          )}

          {/* Birincil: Manuel Mizan Yükle */}
          <input
            ref={uploadRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={handleUploadClick}
            disabled={uploadMut.isPending || lucaAgentMut.isPending}
            className="px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            {uploadMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Mizan Yükle
          </button>

          {/* İkincil: Luca'dan Çek — Extension-first (kendi tarayıcından) */}
          <button
            onClick={() => {
              if (!taxpayerId) { toast.error('Önce mükellef seçin'); setPickerOpen(true); return; }
              lucaAgentMut.mutate();
            }}
            disabled={lucaAgentMut.isPending || !!lucaJobId || uploadMut.isPending}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(184,160,111,0.3)',
              color: GOLD,
            }}
            title="Luca sekmeniz açık olmalı — moren-agent mizanı çeker"
          >
            {(lucaAgentMut.isPending || !!lucaJobId) ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {lucaJobId ? 'Luca\'dan Çekiliyor…' : 'Luca\'dan Çek'}
          </button>
        </div>
      </div>

      {/* Luca job durumu — extension Luca sekmesini kullanıyor + progress timeline */}
      {lucaJobId && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            background: 'rgba(184,160,111,0.08)',
            border: '1px solid rgba(184,160,111,0.3)',
            color: '#fafaf9',
          }}
        >
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin" style={{ color: GOLD, flexShrink: 0 }} />
            <div className="flex-1">
              <div style={{ color: GOLD, fontWeight: 600, fontSize: 13 }}>Luca sekmesini açık tut</div>
              <div style={{ color: 'rgba(250,250,249,0.65)', fontSize: 12, marginTop: 2 }}>
                {lucaStatus || 'Moren agent Luca sayfasındaki mizan Excel\'ini indiriyor…'}
              </div>
            </div>
            <button
              onClick={() => { setLucaJobId(null); setLucaStatus(''); setLucaLogLines([]); }}
              className="px-3 py-1.5 rounded-md text-xs"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.6)', border: 0 }}
            >
              İptal
            </button>
          </div>
          {/* Log container ARTIK HER ZAMAN GÖRÜNÜR — boş bile olsa kullanıcı
              bir şey olduğunu görsün, debug için kritik. */}
          <div
            className="mt-3 rounded-md p-2.5 text-[11.5px] font-mono space-y-0.5"
            style={{
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'rgba(250,250,249,0.75)',
              maxHeight: 200,
              overflowY: 'auto',
              minHeight: 60,
            }}
          >
            {lucaLogLines.length === 0 ? (
              <div style={{ color: 'rgba(250,250,249,0.4)', fontStyle: 'italic' }}>
                Agent'tan ilk log satırı bekleniyor… (Luca sekmesi açık ve giriş yapılmış olmalı)
              </div>
            ) : (
              lucaLogLines.map((line, i) => {
                const isErr = /✗|hata|error/i.test(line);
                const isOk = /✓/.test(line);
                return (
                  <div
                    key={i}
                    style={{
                      color: isErr ? '#fca5a5' : isOk ? '#86efac' : 'rgba(250,250,249,0.65)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {line}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* KPI */}
      {mizan && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Kpi label="Toplam Hesap" val={hesaplar.length.toString()} color="#fafaf9" icon={FileText} />
            <Kpi label="Toplam Borç" val={fmtTRY(toplamBorc)} color={GOLD} icon={null} />
            <Kpi label="Toplam Alacak" val={fmtTRY(toplamAlacak)} color={GOLD} icon={null} />
            <Kpi label="Denetim Uyarısı" val={anomaliler.length.toString()} color={anomaliler.length > 0 ? '#f59e0b' : '#22c55e'} icon={AlertTriangle} />
            <Kpi label="Son Güncelleme" val={mizan.createdAt ? new Date(mizan.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'} color="rgba(250,250,249,0.7)" small icon={null} />
          </div>
          {/* Kesin Kayıt ribbon */}
          <div className="flex items-center justify-between rounded-xl p-3" style={{
            background: mizan.locked ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${mizan.locked ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.05)'}`,
          }}>
            {mizan.locked ? (
              <div className="flex items-center gap-2">
                <Lock size={14} style={{ color: '#22c55e' }} />
                <span className="text-[13px] font-semibold" style={{ color: '#22c55e' }}>Kesin Kayıt</span>
                <span className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.65)' }}>
                  · {mizan.lockedAt ? new Date(mizan.lockedAt).toLocaleString('tr-TR') : ''}
                  {mizan.lockNote && ` · ${mizan.lockNote}`}
                </span>
              </div>
            ) : (
              <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                Bu mizan değişikliklere açık. Kesin kayıt olarak işaretledikten sonra düzeltme yapılamaz.
              </div>
            )}
            <button
              onClick={() => mizan.locked ? handleUnlock(mizan.id) : handleLock(mizan.id)}
              disabled={lockMut.isPending || unlockMut.isPending}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold flex items-center gap-1.5"
              style={{
                background: mizan.locked ? 'rgba(244,63,94,0.12)' : 'rgba(184,160,111,0.15)',
                color: mizan.locked ? '#f43f5e' : GOLD,
                border: `1px solid ${mizan.locked ? 'rgba(244,63,94,0.3)' : 'rgba(184,160,111,0.35)'}`,
              }}
            >
              {mizan.locked ? <><Unlock size={12} /> Kilidi Aç</> : <><Lock size={12} /> Kesin Kayıt</>}
            </button>
          </div>
        </>
      )}

      {/* Anomaliler */}
      {anomaliler.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            Hesap Kodu Denetimi
            <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              {anomaliler.length} uyarı
            </span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {anomaliler.map((a, i) => (
              <div
                key={a.id || i}
                className="rounded-lg p-4 flex gap-3"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${a.seviye === 'ERROR' ? 'rgba(244,63,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold"
                  style={{
                    background: a.seviye === 'ERROR' ? 'rgba(244,63,94,0.15)' : 'rgba(245,158,11,0.15)',
                    color: a.seviye === 'ERROR' ? '#f43f5e' : '#f59e0b',
                  }}
                >
                  {a.seviye === 'ERROR' ? <XCircle size={15} /> : <AlertTriangle size={15} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold mb-1" style={{ color: '#fafaf9' }}>{a.tip.replace(/_/g, ' ')}</p>
                  <p className="text-[11.5px] leading-snug" style={{ color: 'rgba(250,250,249,0.65)' }}>{a.mesaj}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hesap Listesi: boş hal bildirimi */}
      {effectiveId && hesaplar.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <FileSpreadsheet size={28} className="mx-auto mb-3" style={{ color: 'rgba(250,250,249,0.35)' }} />
          <p className="text-[13.5px] font-medium" style={{ color: 'rgba(250,250,249,0.7)' }}>Mizan yükleniyor…</p>
          <p className="text-[12px] mt-1.5" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Hesaplar getiriliyor. Birkaç saniye içinde görünecek. Görünmezse sayfayı yenileyin (F5).
          </p>
        </div>
      )}
      {!effectiveId && mizanList.length === 0 && taxpayerId && (
        <div className="rounded-xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(184,160,111,0.20)' }}>
          <FileSpreadsheet size={28} className="mx-auto mb-3" style={{ color: GOLD, opacity: 0.5 }} />
          <p className="text-[13.5px] font-medium" style={{ color: '#fafaf9' }}>Bu mükellef için henüz mizan yok</p>
          <p className="text-[12px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Yukarıdan <strong style={{ color: GOLD }}>Mizan Yükle</strong> veya <strong style={{ color: GOLD }}>Luca'dan Çek</strong> ile başla.
          </p>
        </div>
      )}

      {/* Hesap Listesi */}
      {hesaplar.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            Hesap Listesi
            <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
              {hesaplar.length}
            </span>
          </h3>
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <table className="w-full text-left" style={{ fontVariantNumeric: 'tabular-nums', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.025)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Hesap Kodu', 'Hesap Adı', 'Borç', 'Alacak', 'Borç Bakiye', 'Alacak Bakiye'].map((label, i) => (
                    <th
                      key={label}
                      className={`px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em] ${i >= 2 ? 'text-right' : ''}`}
                      style={{
                        color: 'rgba(250,250,249,0.45)',
                        borderRight: i < 5 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hesaplar.map((h: any, idx: number) => {
                  // Seviyeye göre stil hiyerarşisi:
                  //   0 = Grup (1, 10, 15)               → en koyu zemin, en parlak/kalın yazı
                  //   1 = Ana Hesap (100, 120, 153)      → biraz koyu zemin, kalın yazı
                  //   2 = Kırılım (100.01, 153.01)      → hafif zemin, normal yazı
                  //   3 = Alt Kırılım (153.01.001)       → zeminsiz, soluk yazı
                  const lvl = Number(h.seviye ?? 0);
                  const rowBg =
                    lvl === 0 ? 'rgba(184,160,111,0.06)' :
                    lvl === 1 ? 'rgba(255,255,255,0.025)' :
                    lvl === 2 ? 'rgba(255,255,255,0.012)' :
                    'transparent';
                  const codeColor =
                    lvl === 0 ? GOLD :
                    lvl === 1 ? GOLD :
                    lvl === 2 ? 'rgba(184,160,111,0.75)' :
                    'rgba(184,160,111,0.55)';
                  const codeWeight = lvl <= 1 ? 700 : lvl === 2 ? 500 : 400;
                  const adiColor =
                    lvl === 0 ? '#fafaf9' :
                    lvl === 1 ? 'rgba(250,250,249,0.92)' :
                    lvl === 2 ? 'rgba(250,250,249,0.7)' :
                    'rgba(250,250,249,0.55)';
                  const adiWeight = lvl === 0 ? 700 : lvl === 1 ? 600 : lvl === 2 ? 500 : 400;
                  const numColor = (val: any, hasColor: string) =>
                    Number(val) > 0
                      ? lvl <= 1 ? hasColor : lvl === 2 ? hasColor : `${hasColor}cc`
                      : 'rgba(250,250,249,0.25)';
                  const numWeight = lvl <= 1 ? 600 : lvl === 2 ? 500 : 400;
                  const fontSize = lvl === 0 ? '13px' : lvl === 1 ? '12.5px' : '12px';
                  const cellBorder = '1px solid rgba(255,255,255,0.04)';

                  return (
                    <tr
                      key={h.id}
                      style={{
                        background: rowBg,
                        borderTop: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <td
                        className="px-4 py-2 font-mono"
                        style={{
                          color: codeColor,
                          fontWeight: codeWeight,
                          fontSize,
                          paddingLeft: `${16 + lvl * 18}px`,
                          borderRight: cellBorder,
                        }}
                      >
                        {h.hesapKodu}
                      </td>
                      <td
                        className="px-4 py-2"
                        style={{
                          color: adiColor,
                          fontWeight: adiWeight,
                          fontSize: lvl === 0 ? '13px' : '12.5px',
                          borderRight: cellBorder,
                        }}
                      >
                        {h.hesapAdi}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-mono"
                        style={{
                          color: numColor(h.borcToplami, '#fafaf9'),
                          fontWeight: numWeight,
                          fontSize,
                          borderRight: cellBorder,
                        }}
                      >
                        {Number(h.borcToplami) > 0 ? fmtTRY(h.borcToplami) : '—'}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-mono"
                        style={{
                          color: numColor(h.alacakToplami, '#fafaf9'),
                          fontWeight: numWeight,
                          fontSize,
                          borderRight: cellBorder,
                        }}
                      >
                        {Number(h.alacakToplami) > 0 ? fmtTRY(h.alacakToplami) : '—'}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-mono"
                        style={{
                          color: numColor(h.borcBakiye, '#22c55e'),
                          fontWeight: numWeight,
                          fontSize,
                          borderRight: cellBorder,
                        }}
                      >
                        {Number(h.borcBakiye) > 0 ? fmtTRY(h.borcBakiye) : '—'}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-mono"
                        style={{
                          color: numColor(h.alacakBakiye, '#22c55e'),
                          fontWeight: numWeight,
                          fontSize,
                        }}
                      >
                        {Number(h.alacakBakiye) > 0 ? fmtTRY(h.alacakBakiye) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Geçmiş Mizanlar */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Geçmiş Mizanlar
          <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
            {mizanList.length}
          </span>
        </h3>
        {mizanList.length === 0 ? (
          <div className="rounded-xl py-10 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <FileSpreadsheet size={24} style={{ color: 'rgba(250,250,249,0.3)', margin: '0 auto 8px' }} />
            <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Henüz kayıtlı mizan yok</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Tarih</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Mükellef</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Dönem</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Tür</th>
                  <th className="px-4 py-3 text-center text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Hesap</th>
                  <th className="px-4 py-3 text-center text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Uyarı</th>
                  <th className="px-4 py-3 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {mizanList.map((m: any, idx: number) => (
                  <tr key={m.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="px-4 py-3 font-mono text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>{new Date(m.createdAt).toLocaleDateString('tr-TR')}</td>
                    <td className="px-4 py-3 font-medium">
                      {m.locked && <Lock size={11} style={{ color: '#22c55e', display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />}
                      {m.taxpayer ? taxpayerName(m.taxpayer) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px]">{m.donem}</td>
                    <td className="px-4 py-3 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>{DONEM_TIPLERI.find((d) => d.value === m.donemTipi)?.label || m.donemTipi}</td>
                    <td className="px-4 py-3 text-center font-mono">{m._count?.hesaplar ?? 0}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded" style={{ background: (m._count?.anomaliler ?? 0) > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)', color: (m._count?.anomaliler ?? 0) > 0 ? '#f59e0b' : '#22c55e' }}>
                        {m._count?.anomaliler ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <a href={`/panel/mizan?id=${m.id}`} className="p-1.5 rounded-md" style={{ color: GOLD, background: 'rgba(184,160,111,0.08)' }}><Eye size={14} /></a>
                        <button
                          onClick={() => {
                            if (m.locked) return toast.error('Kesin kayıtlı mizan silinemez');
                            if (confirm('Bu mizanı silmek istediğinize emin misiniz?')) deleteMut.mutate(m.id);
                          }}
                          disabled={m.locked}
                          className="p-1.5 rounded-md disabled:opacity-30"
                          style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}
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
      </div>

      {/* Mükellef Picker Modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }} onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border flex flex-col overflow-hidden" style={{ background: 'rgba(17,14,12,0.98)', borderColor: 'rgba(255,255,255,0.05)', maxHeight: '84vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <h3 className="text-lg font-bold" style={{ color: '#fafaf9' }}>Mükellef Seç</h3>
              <button onClick={() => setPickerOpen(false)} className="p-1"><X size={16} /></button>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)' }}>
                <Search size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
                <input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Ara…" autoFocus className="flex-1 bg-transparent outline-none text-sm" style={{ color: '#fafaf9' }} />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredTp.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTaxpayerId(t.id); setPickerOpen(false); setPickerSearch(''); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left transition-colors"
                  style={{ background: taxpayerId === t.id ? 'rgba(184,160,111,.08)' : 'transparent', color: '#fafaf9' }}
                  onMouseEnter={(e) => { if (taxpayerId !== t.id) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.03)'; }}
                  onMouseLeave={(e) => { if (taxpayerId !== t.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.7)' }}>{taxpayerName(t).charAt(0)}</div>
                  <span className="flex-1 truncate font-medium">{taxpayerName(t)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, val, color, small, icon: Icon }: { label: string; val: string; color: string; small?: boolean; icon: any }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: 'rgba(250,250,249,0.5)' }}>
        {Icon ? <Icon size={12} style={{ color }} /> : null}
        {label}
      </div>
      <p className="leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: small ? 15 : 22, fontWeight: 700, color }}>
        {val}
      </p>
    </div>
  );
}

function toDonem(year: number, month: string, donemTipi: string): string {
  if (donemTipi === 'AYLIK') return `${year}-${month}`; // "2026-03"
  if (donemTipi === 'YILLIK') return `${year}-YILLIK`;
  if (donemTipi.startsWith('GECICI_Q')) {
    const q = donemTipi.slice(-1);
    return `${year}-Q${q}`;
  }
  return `${year}-${month}`;
}
