'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { earsivApi, fmtTRY, type EarsivTip, type BelgeKaynak, type EarsivFatura } from '@/lib/earsiv';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Download, Search, Users, Calendar, Sparkles, Loader2, FileText,
  ArrowDown, Package, X, CheckSquare, Square, Upload,
} from 'lucide-react';

const GOLD = '#d4b876';

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  isEFaturaMukellefi?: boolean;
};
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

export default function EarsivPage() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [tip, setTip] = useState<EarsivTip>('SATIS');
  const [belgeKaynak, setBelgeKaynak] = useState<BelgeKaynak>('EARSIV');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [lucaStatus, setLucaStatus] = useState('');
  const [lucaLogLines, setLucaLogLines] = useState<string[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Mükellef listesi
  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data as Taxpayer[]),
  });

  // E-arşiv fatura listesi
  const donem = `${year}-${String(month).padStart(2, '0')}`;
  const { data: listData, isLoading } = useQuery({
    queryKey: ['earsiv-list', taxpayerId, donem, tip, belgeKaynak, search],
    queryFn: () => earsivApi.list({
      taxpayerId: taxpayerId || undefined,
      donem,
      tip,
      belgeKaynak,
      search: search || undefined,
      pageSize: 200,
    }),
    enabled: !!taxpayerId,
  });
  const rows = listData?.rows ?? [];

  // Luca'dan Çek
  const lucaMut = useMutation({
    mutationFn: () =>
      earsivApi.fetchFromLuca({ mukellefId: taxpayerId, donem, tip, belgeKaynak }),
    onSuccess: (d) => {
      setLucaJobId(d.jobId);
      setLucaStatus('Luca sekmesini açık tut — moren-agent 15 sn içinde alacak…');
      toast.info('Luca job oluşturuldu');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || e?.message || 'Job oluşturulamadı'),
  });

  // Job polling
  const lucaJobQuery = useQuery({
    queryKey: ['earsiv-luca-job', lucaJobId],
    queryFn: () => earsivApi.getLucaJob(lucaJobId!),
    enabled: !!lucaJobId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    const d: any = lucaJobQuery.data;
    if (!d) return;
    const job = d?.job ?? d;
    if (!job?.status) return;
    const errorLog = job.errorMsg || '';
    const lines = errorLog ? errorLog.split('\n').filter((l: string) => l.trim()) : [];
    setLucaLogLines(lines);
    const lastLine = lines[lines.length - 1] || '';
    if (job.status === 'pending' || job.status === 'running') {
      setLucaStatus(lastLine || 'Agent çalışıyor…');
    } else if (job.status === 'done') {
      setLucaStatus('Tamamlandı ✓');
      toast.success('E-arşiv faturalar Luca\'dan çekildi');
      qc.invalidateQueries({ queryKey: ['earsiv-list'] });
      setTimeout(() => { setLucaJobId(null); setLucaStatus(''); setLucaLogLines([]); }, 2000);
    } else if (job.status === 'failed') {
      setLucaStatus(`Hata: ${lastLine || 'bilinmeyen'} — kapatmak için İptal`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lucaJobQuery.data]);

  // Manuel ZIP yükleme
  const uploadMut = useMutation({
    mutationFn: (file: File) =>
      earsivApi.uploadZip({ taxpayerId, donem, tip, belgeKaynak }, file),
    onSuccess: (d) => {
      toast.success(`ZIP yüklendi · ${d.inserted} fatura eklendi (${d.skipped} mükerrer atlandı)`);
      qc.invalidateQueries({ queryKey: ['earsiv-list'] });
      if (uploadRef.current) uploadRef.current.value = '';
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || e?.message || 'ZIP yüklenemedi');
      if (uploadRef.current) uploadRef.current.value = '';
    },
  });
  const handleUploadClick = () => {
    if (!taxpayerId) {
      toast.error('Önce mükellef seçin');
      setPickerOpen(true);
      return;
    }
    uploadRef.current?.click();
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) {
      toast.error('Sadece .zip dosyası kabul edilir');
      return;
    }
    uploadMut.mutate(f);
  };

  // Toplu indirme
  const downloadMut = useMutation({
    mutationFn: () => earsivApi.downloadBulk([...selected]),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `earsiv-${tip.toLowerCase()}-${donem}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${selected.size} fatura ZIP olarak indirildi`);
    },
    onError: (e: any) => toast.error(e?.message || 'İndirme başarısız'),
  });

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const filteredTp = useMemo(
    () => taxpayers.filter((t) => taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase())),
    [taxpayers, pickerSearch],
  );
  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const totals = useMemo(() => {
    let m = 0, k = 0, t = 0;
    rows.forEach((r) => {
      m += parseFloat(String(r.matrah ?? 0)) || 0;
      k += parseFloat(String(r.kdvTutari ?? 0)) || 0;
      t += parseFloat(String(r.toplamTutar ?? 0)) || 0;
    });
    return { matrah: m, kdv: k, toplam: t };
  }, [rows]);

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Sparkles size={10} className="inline mr-1" /> Otomasyon
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          E-Arşiv / E-Fatura
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Luca'dan toplu fatura çek, portal üzerinden listele ve indirme yap.
        </p>
      </div>

      {/* Belge tipi sekme barı — mükellef e-fatura mükellefi ise 4 sekme, değilse 2 */}
      {selectedTp && (
        <div className="flex flex-wrap gap-2 mb-2">
          {(() => {
            const isEFM = !!selectedTp.isEFaturaMukellefi;
            const tabs: Array<{ key: string; label: string; tip: EarsivTip; bk: BelgeKaynak; renk: string }> = [
              { key: 'EARSIV_SATIS', label: 'E-Arşiv · Giden (SATIŞ)', tip: 'SATIS', bk: 'EARSIV', renk: '#22c55e' },
              { key: 'EARSIV_ALIS', label: 'E-Arşiv · Gelen (ALIŞ)', tip: 'ALIS', bk: 'EARSIV', renk: '#22c55e' },
            ];
            if (isEFM) {
              tabs.push(
                { key: 'EFATURA_SATIS', label: 'E-Fatura · Giden (SATIŞ)', tip: 'SATIS', bk: 'EFATURA', renk: '#3b82f6' },
                { key: 'EFATURA_ALIS', label: 'E-Fatura · Gelen (ALIŞ)', tip: 'ALIS', bk: 'EFATURA', renk: '#3b82f6' },
              );
            }
            return tabs.map((t) => {
              const aktif = tip === t.tip && belgeKaynak === t.bk;
              return (
                <button
                  key={t.key}
                  onClick={() => { setTip(t.tip); setBelgeKaynak(t.bk); setSelected(new Set()); }}
                  className="px-4 py-2 rounded-md text-sm font-semibold transition"
                  style={{
                    background: aktif ? `${t.renk}20` : 'rgba(255,255,255,0.03)',
                    color: aktif ? t.renk : 'rgba(250,250,249,0.6)',
                    border: `1px solid ${aktif ? t.renk + '50' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {t.label}
                </button>
              );
            });
          })()}
          {!selectedTp.isEFaturaMukellefi && (
            <span className="text-[11px] italic self-center ml-2" style={{ color: 'rgba(250,250,249,0.4)' }}>
              · Bu mükellef e-fatura mükellefi değil. E-fatura sekmeleri kapalı.
            </span>
          )}
        </div>
      )}

      {/* Filtreler */}
      <div className="rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Mükellef */}
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-[.16em] mb-1.5 block" style={{ color: '#b8a06f' }}>
            <Users size={10} className="inline mr-1" /> Mükellef
          </label>
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            <span>{selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}</span>
            <Search size={14} style={{ color: GOLD }} />
          </button>
        </div>
        {/* Yıl */}
        <div>
          <label className="text-[10px] uppercase tracking-[.16em] mb-1.5 block" style={{ color: '#b8a06f' }}>
            <Calendar size={10} className="inline mr-1" /> Yıl
          </label>
          <input
            type="number"
            min={2020}
            max={2099}
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10) || now.getFullYear())}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        {/* Ay */}
        <div>
          <label className="text-[10px] uppercase tracking-[.16em] mb-1.5 block" style={{ color: '#b8a06f' }}>
            Ay
          </label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}. Ay</option>
            ))}
          </select>
        </div>
      </div>

      {/* Aksiyonlar */}
      <div className="flex gap-3 flex-wrap items-center">
        <button
          disabled={!taxpayerId || lucaMut.isPending || !!lucaJobId || uploadMut.isPending}
          onClick={() => lucaMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: GOLD, color: '#1a1a18', border: 0 }}
        >
          {lucaMut.isPending || lucaJobId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {lucaJobId ? 'Çekiliyor…' : `Luca'dan ${belgeKaynak === 'EFATURA' ? 'E-Fatura' : 'E-Arşiv'} ${tip === 'SATIS' ? 'Giden' : 'Gelen'} Çek`}
        </button>

        {/* Manuel ZIP yükleme */}
        <input
          ref={uploadRef}
          type="file"
          accept=".zip"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          disabled={uploadMut.isPending || lucaMut.isPending || !!lucaJobId}
          onClick={handleUploadClick}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}
          title="Luca'dan elle indirdiğin ZIP'i yükle"
        >
          {uploadMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          ZIP Yükle
        </button>

        <button
          disabled={selected.size === 0 || downloadMut.isPending}
          onClick={() => downloadMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'rgba(184,160,111,0.15)', color: GOLD, border: '1px solid rgba(184,160,111,0.3)' }}
        >
          {downloadMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
          Seçili {selected.size > 0 ? `(${selected.size})` : ''} ZIP İndir
        </button>

        <input
          placeholder="Fatura no, satıcı, alıcı, vergi no ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-md text-sm"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
        />
      </div>

      {/* Job durumu */}
      {lucaJobId && (
        <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.3)', color: '#fafaf9' }}>
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin" style={{ color: GOLD, flexShrink: 0 }} />
            <div className="flex-1">
              <div style={{ color: GOLD, fontWeight: 600, fontSize: 13 }}>Luca sekmesini açık tut</div>
              <div style={{ color: 'rgba(250,250,249,0.65)', fontSize: 12, marginTop: 2 }}>
                {lucaStatus || 'moren-agent çalışıyor…'}
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
          {/* Log container — agent'tan gelen ilerleme satırları */}
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
                const isOk = /✓|✅/.test(line);
                return (
                  <div key={i} style={{ color: isErr ? '#ef4444' : isOk ? '#10b981' : 'rgba(250,250,249,0.75)' }}>
                    {line}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Özet */}
      {rows.length > 0 && (
        <div className="rounded-lg p-3 grid grid-cols-3 gap-3 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="text-[10px] uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.5)' }}>Matrah</div>
            <div style={{ color: GOLD, fontSize: 18, fontWeight: 600 }}>{fmtTRY(totals.matrah)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.5)' }}>KDV</div>
            <div style={{ color: '#fafaf9', fontSize: 18, fontWeight: 600 }}>{fmtTRY(totals.kdv)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.5)' }}>Toplam</div>
            <div style={{ color: '#fafaf9', fontSize: 18, fontWeight: 600 }}>{fmtTRY(totals.toplam)}</div>
          </div>
        </div>
      )}

      {/* Tablo */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {!taxpayerId ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Önce mükellef seç…
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <Loader2 size={16} className="inline animate-spin mr-2" /> Yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Bu dönem için kayıtlı fatura yok. Yukarıdan <strong>Luca'dan Çek</strong> ile getir.
          </div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.6)' }}>
                <th className="px-2 py-2 w-8 text-left">
                  <button onClick={toggleAll}>
                    {selected.size === rows.length && rows.length > 0
                      ? <CheckSquare size={14} style={{ color: GOLD }} />
                      : <Square size={14} />}
                  </button>
                </th>
                <th className="px-2 py-2 text-left">Tarih</th>
                <th className="px-2 py-2 text-left">Fatura No</th>
                <th className="px-2 py-2 text-left">{tip === 'SATIS' ? 'Alıcı' : 'Satıcı'}</th>
                <th className="px-2 py-2 text-right">Matrah</th>
                <th className="px-2 py-2 text-right">KDV</th>
                <th className="px-2 py-2 text-right">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: '#fafaf9' }}>
                  <td className="px-2 py-2">
                    <button onClick={() => toggleSelect(r.id)}>
                      {selected.has(r.id)
                        ? <CheckSquare size={14} style={{ color: GOLD }} />
                        : <Square size={14} />}
                    </button>
                  </td>
                  <td className="px-2 py-2">{new Date(r.faturaTarihi).toLocaleDateString('tr-TR')}</td>
                  <td className="px-2 py-2 font-mono text-[11.5px]">{r.faturaNo}</td>
                  <td className="px-2 py-2">{tip === 'SATIS' ? r.alici : r.satici}</td>
                  <td className="px-2 py-2 text-right">{fmtTRY(r.matrah)}</td>
                  <td className="px-2 py-2 text-right">{fmtTRY(r.kdvTutari)}</td>
                  <td className="px-2 py-2 text-right" style={{ color: GOLD }}>{fmtTRY(r.toplamTutar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Mükellef picker modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setPickerOpen(false)}>
          <div className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg" style={{ background: '#1a1a18', border: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
            <div className="p-3 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <input
                autoFocus
                placeholder="Mükellef ara…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                className="flex-1 px-3 py-2 rounded-md text-sm"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
              />
              <button onClick={() => setPickerOpen(false)} className="p-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <X size={16} style={{ color: 'rgba(250,250,249,0.6)' }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredTp.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTaxpayerId(t.id); setPickerOpen(false); setPickerSearch(''); setSelected(new Set()); }}
                  className="w-full text-left px-3 py-2.5 text-sm flex items-center justify-between hover:bg-white/5"
                  style={{ color: '#fafaf9', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <span>{taxpayerName(t)}</span>
                  <span style={{ color: 'rgba(250,250,249,0.4)', fontSize: 11 }}>{t.taxNumber}</span>
                </button>
              ))}
              {filteredTp.length === 0 && (
                <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>Sonuç yok</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
