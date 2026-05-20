'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, CheckCircle2, FileSpreadsheet, Loader2, Play, Search, UploadCloud, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { EDefterDonemTipi, edefterControlApi } from '@/lib/edefter-control';

const GOLD = '#d4b876';
const PANEL = 'rgba(255,255,255,0.025)';
const BORDER = 'rgba(255,255,255,0.07)';

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
};

function taxpayerName(t?: Taxpayer | null) {
  if (!t) return '-';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || '-';
}

function apiArray<T>(value: any): T[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function quarterLabel(year: number, quarter: number) {
  const ranges: Record<number, string> = {
    1: 'Ocak-Mart',
    2: 'Nisan-Haziran',
    3: 'Temmuz-Eylül',
    4: 'Ekim-Aralık',
  };
  return `${year} ${quarter}. Dönem (${ranges[quarter] || 'Çeyrek'})`;
}

function formatDonem(donem?: string | null, donemTipi?: string | null) {
  const source = `${donem || ''} ${donemTipi || ''}`;
  const yearMatch = source.match(/\b(20\d{2})\b/);
  const qMatch = source.match(/Q([1-4])/i);
  if (yearMatch && qMatch) return quarterLabel(Number(yearMatch[1]), Number(qMatch[1]));
  return donem || '-';
}

function cleanLucaStatus(value?: string | null) {
  const msg = String(value || '').trim();
  if (!msg) return '';
  if (/%PDF|application\/pdf|Detay Fis Listesi baslik satiri|Luca raporu PDF/i.test(msg)) {
    return 'LUCA rapor türünü PDF verdi. Ajan Rapor Türü alanını Excel (xlsx) yapacak; tekrar Luca’dan Çek deneyin.';
  }
  return msg.length > 320 ? `${msg.slice(0, 320)}...` : msg;
}

function fmtDate(value?: string | Date | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
}

function fmtTRY(value: any) {
  const n = Number(value || 0);
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function periodKey(year: number, quarter: number) {
  return `${year}-Q${quarter}`;
}

function normalizePeriodKey(donem?: string | null, donemTipi?: string | null) {
  const source = `${donem || ''} ${donemTipi || ''}`.trim();
  const yearMatch = source.match(/\b(20\d{2})\b/);
  const qMatch = source.match(/Q([1-4])/i);
  if (yearMatch && qMatch) return periodKey(Number(yearMatch[1]), Number(qMatch[1]));
  return String(donem || '').trim().toUpperCase();
}

function sessionMatchesPeriod(session: any, year: number, quarter: number) {
  return normalizePeriodKey(session?.donem, session?.donemTipi) === periodKey(year, quarter);
}

export default function EDefterAgentPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [lucaStatus, setLucaStatus] = useState('');
  const [lineSearch, setLineSearch] = useState('');
  const [findingSearch, setFindingSearch] = useState('');
  const [focusedFinding, setFocusedFinding] = useState<any | null>(null);
  const linesSectionRef = useRef<HTMLDivElement | null>(null);
  const focusedLineRef = useRef<HTMLTableRowElement | null>(null);

  const donem = `${year}-Q${quarter}`;
  const donemTipi = `GECICI_Q${quarter}` as EDefterDonemTipi;

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => apiArray<Taxpayer>(r.data)),
  });

  useEffect(() => {
    if (!taxpayerId && taxpayers[0]?.id) setTaxpayerId(taxpayers[0].id);
  }, [taxpayers, taxpayerId]);

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ['edefter-control-list', taxpayerId],
    queryFn: () => edefterControlApi.list(taxpayerId || undefined).then((data) => apiArray<any>(data)),
    refetchInterval: 5000,
  });

  const periodSessions = useMemo(
    () => sessions.filter((s: any) => sessionMatchesPeriod(s, year, quarter)),
    [sessions, year, quarter],
  );

  useEffect(() => {
    const latestPeriodSession = periodSessions[0]?.id || null;
    if (!latestPeriodSession) {
      if (selectedSessionId) setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId || !periodSessions.some((s: any) => s.id === selectedSessionId)) {
      setSelectedSessionId(latestPeriodSession);
    }
  }, [periodSessions, selectedSessionId]);

  const selectedSessionInPeriod = !!selectedSessionId && periodSessions.some((s: any) => s.id === selectedSessionId);
  const activeSessionId = selectedSessionInPeriod ? selectedSessionId : periodSessions[0]?.id || null;
  const { data: session } = useQuery<any>({
    queryKey: ['edefter-control-session', activeSessionId],
    queryFn: () => edefterControlApi.get(activeSessionId!),
    enabled: !!activeSessionId,
  });

  const fetchMut = useMutation({
    mutationFn: () =>
      edefterControlApi.fetchFromLucaAgent({
        mukellefId: taxpayerId,
        donem,
        donemTipi,
      }),
    onSuccess: (data) => {
      setLucaJobId(data.jobId);
      setSelectedSessionId(null);
      setLucaStatus(data.mizanJobId
        ? 'Luca ajani Detay Fis Listesi ve Mizan raporlarini hazirliyor...'
        : 'Luca ajani Detay Fis Listesi raporunu hazirliyor; bitince Mizan otomatik siraya alinacak...');
      toast.info('e-Defter Detay Fiş Listesi job oluşturuldu');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Luca job olusturulamadi'),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => edefterControlApi.uploadExcel({ taxpayerId, donem, donemTipi }, file),
    onSuccess: (data: any) => {
      toast.success(`Detay Fiş Listesi yüklendi: ${data.rows} satır`);
      setSelectedSessionId(data.sessionId);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['edefter-control-session', data.sessionId] });
      qc.refetchQueries({ queryKey: ['edefter-control-list', taxpayerId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Excel yuklenemedi'),
  });

  const jobQuery = useQuery({
    queryKey: ['edefter-luca-job', lucaJobId],
    queryFn: () => edefterControlApi.getLucaJob(lucaJobId!),
    enabled: !!lucaJobId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    const data = jobQuery.data;
    if (!data?.job) return;
    const job = data.job;
    const lines = String(job.errorMsg || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const lastLine = cleanLucaStatus(lines[lines.length - 1]);
    const mizanJob = data.mizanJob;
    const mizanStatus = String(mizanJob?.status || '').toLowerCase();
    const mizanDone = !mizanJob || ['done', 'failed', 'cancelled'].includes(mizanStatus);
    if (job.status === 'running') setLucaStatus(lastLine || 'Luca Detay Fis Listesi Excel hazirlaniyor...');
    if (job.status === 'done') {
      setLucaStatus(mizanDone
        ? 'Detay Fis Listesi alindi, Mizan kontrolu de guncellendi'
        : 'Detay Fis Listesi alindi; eslik eden Mizan kontrolu suruyor...');
      if (data.session?.id) setSelectedSessionId(data.session.id);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['edefter-control-session'] });
      qc.refetchQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      if (data.session?.id) qc.refetchQueries({ queryKey: ['edefter-control-session', data.session.id] });
      if (mizanDone) setLucaJobId(null);
      if (!mizanDone) return;
      if (mizanStatus === 'failed') {
        toast.warning('Detay Fis Listesi hazir; Mizan job hata verdi');
        return;
      }
      toast.success('e-Defter ön kontrol verisi hazır');
    }
    if (job.status === 'failed') {
      const friendly = lastLine || cleanLucaStatus(job.errorMsg) || 'Luca job hata verdi';
      setLucaStatus(friendly);
      setLucaJobId(null);
      toast.error(friendly);
    }
  }, [jobQuery.data, qc, taxpayerId]);

  const stats = useMemo(() => {
    const findings = session?.findings || [];
    return {
      error: findings.filter((f: any) => f.severity === 'ERROR').length,
      warn: findings.filter((f: any) => f.severity === 'WARN').length,
      info: findings.filter((f: any) => f.severity === 'INFO').length,
    };
  }, [session]);
  const mizan = session?.companionMizan || jobQuery.data?.mizan || null;
  const mizanAnomalies = mizan?.anomaliler || [];

  const visibleFindings = useMemo(() => {
    const query = findingSearch.trim().toLocaleLowerCase('tr-TR');
    const findings = session?.findings || [];
    if (!query) return findings;
    return findings.filter((f: any) => {
      const haystack = [
        f.severity,
        f.category,
        f.message,
        f.voucherKey,
        f.rowIndex,
        f.hesapKodu,
      ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return haystack.includes(query);
    });
  }, [findingSearch, session]);

  const lines = useMemo(() => session?.lines || [], [session]);
  const visibleLines = useMemo(() => {
    const focusedVoucherKey = focusedFinding?.voucherKey || null;
    const focusedRowIndex = focusedFinding?.rowIndex ? Number(focusedFinding.rowIndex) : null;
    const query = lineSearch.trim().toLocaleLowerCase('tr-TR');
    return lines.filter((line: any) => {
      const matchesFocus = !focusedFinding
        || (focusedVoucherKey && line.voucherKey === focusedVoucherKey)
        || (focusedRowIndex && Number(line.rowIndex) === focusedRowIndex);
      if (!matchesFocus) return false;
      if (!query) return true;
      const haystack = [
        line.rowIndex,
        line.voucherKey,
        line.fisNo,
        line.yevmiyeNo,
        line.evrakNo,
        line.hesapKodu,
        line.hesapAdi,
        line.aciklama,
        fmtDate(line.fisTarihi),
      ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return haystack.includes(query);
    });
  }, [focusedFinding, lineSearch, lines]);

  const focusFinding = (finding: any) => {
    setFocusedFinding(finding);
    setLineSearch('');
    window.setTimeout(() => {
      linesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  useEffect(() => {
    if (!focusedFinding) return;
    const timer = window.setTimeout(() => {
      focusedLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusedFinding, visibleLines.length]);

  useEffect(() => {
    setFocusedFinding(null);
    setLineSearch('');
    setFindingSearch('');
  }, [activeSessionId]);

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={18} style={{ color: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>e-Defter Ön Kontrol</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9' }}>
            Detay Fiş Listesi Analizi
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Luca Detay Fiş Listesi üzerinden e-defter öncesi muhasebe kayıt hatalarını yakalar.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={taxpayerId}
            onChange={(e) => {
              setTaxpayerId(e.target.value);
              setSelectedSessionId(null);
            }}
            className="h-10 rounded-lg px-3 text-sm min-w-[260px]"
            style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }}
          >
            {taxpayers.map((t) => (
              <option key={t.id} value={t.id}>{taxpayerName(t)}</option>
            ))}
          </select>
          <input
            type="number"
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value) || now.getFullYear());
              setSelectedSessionId(null);
            }}
            className="h-10 rounded-lg px-3 text-sm w-24 tabular-nums"
            style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }}
          />
          <div className="flex h-10 rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            {[1, 2, 3, 4].map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuarter(q);
                  setSelectedSessionId(null);
                }}
                className="px-3 text-sm font-semibold"
                style={{ background: quarter === q ? 'rgba(212,184,118,.18)' : PANEL, color: quarter === q ? GOLD : 'rgba(250,250,249,.65)' }}
              >
                {q}. Dönem
              </button>
            ))}
          </div>
          <button
            disabled={!taxpayerId || fetchMut.isPending || !!lucaJobId}
            onClick={() => fetchMut.mutate()}
            className="h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'rgba(212,184,118,.16)', color: GOLD, border: '1px solid rgba(212,184,118,.28)' }}
          >
            {fetchMut.isPending || lucaJobId ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Luca'dan Çek
          </button>
          <label
            className="h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}
          >
            <UploadCloud size={15} />
            Excel Yükle
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMut.mutate(file);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {lucaStatus && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.18)', color: '#bfdbfe' }}>
          {lucaStatus}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Mükellef" value={taxpayerName(selectedTp)} />
        <Kpi label="Dönem" value={quarterLabel(year, quarter)} />
        <Kpi label="Fiş" value={session?.totalVouchers ?? 0} />
        <Kpi label="Satır" value={session?.totalLines ?? 0} />
        <Kpi label="Bulgu" value={session?.findingCount ?? 0} tone={stats.error ? 'red' : stats.warn ? 'amber' : 'green'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
        <div className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Geçmiş Kontroller</h2>
            <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.45)' }}>{periodSessions.length}</span>
          </div>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {periodSessions.map((s: any) => (
              <button
                key={s.id}
                onClick={() => setSelectedSessionId(s.id)}
                className="w-full text-left rounded-lg p-3 border"
                style={{
                  background: activeSessionId === s.id ? 'rgba(212,184,118,.12)' : 'rgba(255,255,255,.02)',
                  borderColor: activeSessionId === s.id ? 'rgba(212,184,118,.28)' : BORDER,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: '#fafaf9' }}>{formatDonem(s.donem, s.donemTipi)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: s.findingCount ? 'rgba(245,158,11,.14)' : 'rgba(34,197,94,.12)', color: s.findingCount ? '#fbbf24' : '#22c55e' }}>
                    {s.findingCount ? `${s.findingCount} bulgu` : 'temiz'}
                  </span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'rgba(250,250,249,.45)' }}>
                  {fmtDate(s.createdAt)} · {s.totalVouchers} fiş · {s.totalLines} satır
                </div>
              </button>
            ))}
            {periodSessions.length === 0 && (
              <div className="text-sm p-4 rounded-lg" style={{ background: 'rgba(255,255,255,.02)', color: 'rgba(250,250,249,.45)' }}>
                Henüz Detay Fiş Listesi çekilmedi.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
            <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Bulgular</h2>
              <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.45)' }}>
                {visibleFindings.length}/{session?.findings?.length || 0}
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge icon={XCircle} label={`Hata ${stats.error}`} color="#ef4444" />
                <Badge icon={AlertTriangle} label={`Uyarı ${stats.warn}`} color="#f59e0b" />
                <Badge icon={CheckCircle2} label={`Bilgi ${stats.info}`} color="#38bdf8" />
                <div className="h-9 rounded-lg px-3 flex items-center gap-2 min-w-[260px]" style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
                  <Search size={14} />
                  <input
                    value={findingSearch}
                    onChange={(e) => setFindingSearch(e.target.value)}
                    placeholder="Bulgu, satir, fis veya hesap ara"
                    className="bg-transparent outline-none text-xs w-full"
                    style={{ color: '#fafaf9' }}
                  />
                </div>
              </div>
            </div>
            <div className="overflow-auto max-h-[560px]">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr style={{ color: 'rgba(250,250,249,.48)', borderBottom: `1px solid ${BORDER}` }}>
                    <th className="text-left py-2 font-medium">Seviye</th>
                    <th className="text-left py-2 font-medium">Kontrol</th>
                    <th className="text-left py-2 font-medium">Açıklama</th>
                    <th className="text-left py-2 font-medium">Satır</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFindings.slice(0, 1000).map((f: any) => (
                    <tr
                      key={f.id}
                      onClick={() => focusFinding(f)}
                      className="cursor-pointer"
                      style={{
                        borderBottom: `1px solid ${BORDER}`,
                        color: '#fafaf9',
                        background: focusedFinding?.id === f.id ? 'rgba(212,184,118,.10)' : 'transparent',
                      }}
                    >
                      <td className="py-2 px-2"><Severity value={f.severity} /></td>
                      <td className="py-2 px-2 text-xs max-w-[240px] break-words">{f.category}</td>
                      <td className="py-2 px-2 min-w-[360px]">{f.message}</td>
                      <td className="py-2 px-2 tabular-nums">{f.rowIndex || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {session && visibleFindings.length === 0 && (session.findings?.length || 0) > 0 && (
                <div className="py-8 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>
                  Bu filtreyle bulgu bulunamadi.
                </div>
              )}
              {(!session?.findings || session.findings.length === 0) && (
                <div className="py-8 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>
                  Bulgu yok. Bu dönem ön kontrol açısından temiz görünüyor.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
            <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={16} style={{ color: GOLD }} />
                <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Mizan Kontrolu</h2>
              </div>
              <span className="text-xs tabular-nums" style={{ color: mizan?.anomalyCount ? '#f59e0b' : 'rgba(250,250,249,.45)' }}>
                {mizan ? `${mizan.hesapCount || 0} hesap, ${mizan.anomalyCount || 0} bulgu` : 'Mizan bekleniyor'}
              </span>
            </div>
            {mizan ? (
              <div className="space-y-2">
                {mizanAnomalies.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="grid grid-cols-1 gap-2 rounded-lg px-3 py-2 text-xs sm:grid-cols-[88px_120px_minmax(0,1fr)]" style={{ background: 'rgba(255,255,255,.025)', color: 'rgba(250,250,249,.78)' }}>
                    <Severity value={a.seviye || 'WARN'} />
                    <span className="font-semibold truncate">{a.tip || '-'}</span>
                    <span className="min-w-0 break-words">{a.hesapKodu ? `${a.hesapKodu} - ` : ''}{a.mesaj || '-'}</span>
                  </div>
                ))}
                {mizanAnomalies.length === 0 && (
                  <div className="rounded-lg px-3 py-3 text-sm" style={{ background: 'rgba(34,197,94,.08)', color: '#86efac' }}>
                    Mizan kontrolunde bulgu yok.
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg px-3 py-3 text-sm" style={{ background: 'rgba(255,255,255,.02)', color: 'rgba(250,250,249,.45)' }}>
                Luca'dan cekim tamamlandiginda Detay Fis Listesi ile ayni donemin mizani burada ayri kontrol olarak gorunecek.
              </div>
            )}
          </div>

          <div ref={linesSectionRef} className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
            <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={16} style={{ color: GOLD }} />
                <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Fiş Satırları</h2>
                <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.45)' }}>
                  {visibleLines.length}/{lines.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {focusedFinding && (
                  <button
                    onClick={() => setFocusedFinding(null)}
                    className="h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
                    style={{ background: 'rgba(212,184,118,.12)', color: GOLD, border: '1px solid rgba(212,184,118,.24)' }}
                  >
                    <XCircle size={13} />
                    Bulgu filtresini temizle
                  </button>
                )}
                <div className="h-9 rounded-lg px-3 flex items-center gap-2 min-w-[260px]" style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
                  <Search size={14} />
                  <input
                    value={lineSearch}
                    onChange={(e) => setLineSearch(e.target.value)}
                    placeholder="Satır, fiş, evrak, hesap veya açıklama ara"
                    className="bg-transparent outline-none text-xs w-full"
                    style={{ color: '#fafaf9' }}
                  />
                </div>
              </div>
            </div>
            <div className="overflow-auto max-h-[520px]">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'rgba(250,250,249,.48)', borderBottom: `1px solid ${BORDER}` }}>
                    <th className="text-left py-2 font-medium">Satır</th>
                    <th className="text-left py-2 font-medium">Tarih</th>
                    <th className="text-left py-2 font-medium">Fiş</th>
                    <th className="text-left py-2 font-medium">Evrak</th>
                    <th className="text-left py-2 font-medium">Hesap</th>
                    <th className="text-left py-2 font-medium">Açıklama</th>
                    <th className="text-right py-2 font-medium">Borç</th>
                    <th className="text-right py-2 font-medium">Alacak</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.slice(0, 1000).map((line: any) => (
                    <tr
                      key={line.id}
                      ref={focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? focusedLineRef : undefined}
                      style={{
                        borderBottom: `1px solid ${BORDER}`,
                        color: 'rgba(250,250,249,.82)',
                        background: focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex)
                          ? 'rgba(212,184,118,.10)'
                          : 'transparent',
                      }}
                    >
                      <td className="py-2 tabular-nums">{line.rowIndex || '-'}</td>
                      <td className="py-2 whitespace-nowrap">{fmtDate(line.fisTarihi)}</td>
                      <td className="py-2">{line.yevmiyeNo || line.fisNo || '-'}</td>
                      <td className="py-2">{line.evrakNo || '-'}</td>
                      <td className="py-2 whitespace-nowrap">{line.hesapKodu || '-'} · {line.hesapAdi || ''}</td>
                      <td className="py-2 min-w-[220px]">{line.aciklama || '-'}</td>
                      <td className="py-2 text-right tabular-nums">{fmtTRY(line.borc)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtTRY(line.alacak)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {session && visibleLines.length === 0 && (
                <div className="py-8 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>
                  Bu filtreyle satır bulunamadı.
                </div>
              )}
              {!session && (
                <div className="py-8 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>
                  Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: any; tone?: 'red' | 'amber' | 'green' }) {
  const color = tone === 'red' ? '#ef4444' : tone === 'amber' ? '#f59e0b' : tone === 'green' ? '#22c55e' : '#fafaf9';
  return (
    <div className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
      <div className="text-xs mb-1" style={{ color: 'rgba(250,250,249,.45)' }}>{label}</div>
      <div className="text-lg font-semibold truncate" style={{ color }}>{String(value ?? '-')}</div>
    </div>
  );
}

function Badge({ icon: Icon, label, color }: { icon: any; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md" style={{ background: `${color}18`, color }}>
      <Icon size={12} /> {label}
    </span>
  );
}

function Severity({ value }: { value: string }) {
  const color = value === 'ERROR' ? '#ef4444' : value === 'WARN' ? '#f59e0b' : '#38bdf8';
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}18`, color }}>{value}</span>;
}
