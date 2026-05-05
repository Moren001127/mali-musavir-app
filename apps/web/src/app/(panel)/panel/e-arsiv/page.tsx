'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { earsivApi, fmtTRY, type EarsivTip, type BelgeKaynak, type EarsivFatura } from '@/lib/earsiv';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Download, Search, Users, Calendar, Sparkles, Loader2, FileText,
  Package, X, CheckSquare, Square, Eye, Printer, AlertCircle, XCircle,
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

export default function EarsivPage() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  // Modül artık SADECE Gelen E-Arşiv (ALIS + EARSIV) — satış ve e-fatura kaldırıldı
  const tip: EarsivTip = 'ALIS';
  const belgeKaynak: BelgeKaynak = 'EARSIV';
  const [tumMukellefler, setTumMukellefler] = useState<boolean>(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [lucaStatus, setLucaStatus] = useState('');
  const [lucaLogLines, setLucaLogLines] = useState<string[]>([]);
  const [printingBulk, setPrintingBulk] = useState(false);
  // Sayfa içi fatura önizleme (yeni sekme yerine lightbox)
  const [previewFatura, setPreviewFatura] = useState<EarsivFatura | null>(null);
  const [previewAutoPrint, setPreviewAutoPrint] = useState(false);

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

  // Luca'dan Çek — sadece Gelen E-Arşiv (ALIS+EARSIV). Tek mükellef ya da tümü.
  const lucaMut = useMutation({
    mutationFn: async () => {
      const hedefMukellefler = tumMukellefler
        ? taxpayers
        : (selectedTp ? [selectedTp] : []);
      if (hedefMukellefler.length === 0) {
        throw new Error('Mükellef seçmedin — ya bir mükellef seç ya da "Tüm Mükellefler"i işaretle');
      }
      const jobIds: string[] = [];
      for (const mk of hedefMukellefler) {
        try {
          const r = await earsivApi.fetchFromLuca({
            mukellefId: mk.id,
            donem,
            tip,         // 'ALIS'
            belgeKaynak, // 'EARSIV'
          });
          jobIds.push(r.jobId);
        } catch (e) {
          // tek tek başarısızlıkları görmezden gel
        }
      }
      return { jobIds, mukellefSayisi: hedefMukellefler.length };
    },
    onSuccess: (d) => {
      if (d.jobIds.length === 0) {
        toast.error('Hiç job oluşturulamadı');
        return;
      }
      if (d.jobIds.length === 1) {
        setLucaJobId(d.jobIds[0]);
        setLucaStatus('Luca sekmesini açık tut — moren-agent 15 sn içinde alacak…');
        toast.info('Luca job oluşturuldu');
      } else {
        setLucaJobId(d.jobIds[0]);
        setLucaStatus(`Toplam ${d.jobIds.length} mükellef kuyruğa alındı`);
        toast.success(`${d.jobIds.length} job kuyruğa alındı`);
      }
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

  // (Eski yeni-sekme akışı kaldırıldı — artık sayfa içi EarsivPreviewModal ile gösteriliyor)

  // Toplu yazdır — seçili faturaların hepsini tek HTML'e topla, yeni sekmede aç + print tetikle
  const topluYazdirMut = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) throw new Error('En az bir fatura seç');
      // Backend POST endpoint: /earsiv/print-bulk { ids: [...] } → text/html
      // Çok sayıda ID için fetch ile alıp blob URL ile aç
      const res = await fetch('/api/earsiv/print-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      return URL.createObjectURL(blob);
    },
    onSuccess: (blobUrl) => {
      const w = window.open(blobUrl, '_blank');
      if (!w) {
        toast.error('Popup engelli — tarayıcının popup engelleyiciyi kapat');
        return;
      }
      // Yeni sekmede DOM yüklendiğinde print() çağrılsın diye HTML'in içine zaten gömüyoruz.
      toast.success(`${selected.size} fatura yazdırma için açıldı`);
      // 60sn sonra blob URL'i temizle
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    },
    onError: (e: any) => toast.error(e?.message || 'Toplu yazdırma başarısız'),
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
          Gelen E-Arşiv Sorgulama
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Luca'dan mükellefin gelen (alış) e-arşiv faturalarını çek, listele, aç ve yazdır.
        </p>
      </div>

      {/* Tüm mükellefler toggle — toplu çekim için */}
      <div className="flex items-center gap-3">
        <label
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium cursor-pointer"
          style={{
            background: tumMukellefler ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${tumMukellefler ? 'rgba(184,160,111,0.35)' : 'rgba(255,255,255,0.08)'}`,
            color: tumMukellefler ? GOLD : 'rgba(250,250,249,0.7)',
          }}
        >
          <input
            type="checkbox"
            checked={tumMukellefler}
            onChange={(e) => setTumMukellefler(e.target.checked)}
            style={{ accentColor: '#d4b876' }}
          />
          Tüm Mükellefler ({taxpayers.length})
        </label>
        {tumMukellefler && (
          <span className="text-[11px] italic" style={{ color: 'rgba(250,250,249,0.55)' }}>
            · Tek "Luca'dan Çek" tıklaması ile {taxpayers.length} mükellefin gelen e-arşivi çekilecek
          </span>
        )}
      </div>

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
            {[
              'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
              'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık',
            ].map((adi, i) => (
              <option key={i + 1} value={i + 1} style={{ background: '#1a1a1a', color: '#fafaf9' }}>
                {adi}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Aksiyonlar */}
      <div className="flex gap-3 flex-wrap items-center">
        <button
          disabled={(!tumMukellefler && !taxpayerId) || lucaMut.isPending || !!lucaJobId}
          onClick={() => lucaMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: GOLD, color: '#1a1a18', border: 0 }}
        >
          {lucaMut.isPending || lucaJobId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {lucaJobId ? 'Çekiliyor…' : "Luca'dan Çek"}
        </button>

        <button
          disabled={selected.size === 0 || topluYazdirMut.isPending}
          onClick={() => topluYazdirMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'rgba(184,160,111,0.15)', color: GOLD, border: '1px solid rgba(184,160,111,0.3)' }}
        >
          {topluYazdirMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
          Toplu Yazdır {selected.size > 0 ? `(${selected.size})` : ''}
        </button>

        <input
          placeholder="Fatura no, satıcı, vergi no ara…"
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
                <th className="px-2 py-2 text-left">Satıcı</th>
                <th className="px-2 py-2 text-right">Matrah</th>
                <th className="px-2 py-2 text-right">KDV</th>
                <th className="px-2 py-2 text-right">Toplam</th>
                <th className="px-2 py-2 text-center w-[140px]">İşlem</th>
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
                  <td className="px-2 py-2">{r.satici}</td>
                  <td className="px-2 py-2 text-right">{fmtTRY(r.matrah)}</td>
                  <td className="px-2 py-2 text-right">{fmtTRY(r.kdvTutari)}</td>
                  <td className="px-2 py-2 text-right" style={{ color: GOLD }}>{fmtTRY(r.toplamTutar)}</td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex gap-1.5 justify-center">
                      <button
                        onClick={() => { setPreviewFatura(r); setPreviewAutoPrint(false); }}
                        className="px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 hover:opacity-80"
                        style={{ background: 'rgba(184,160,111,0.12)', color: GOLD, border: '1px solid rgba(184,160,111,0.25)' }}
                        title="Faturayı önizle"
                      >
                        <Eye size={11} /> Aç
                      </button>
                      <button
                        onClick={() => { setPreviewFatura(r); setPreviewAutoPrint(true); }}
                        className="px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 hover:opacity-80"
                        style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}
                        title="Faturayı önizle ve yazıcıya gönder"
                      >
                        <Printer size={11} /> Yazdır
                      </button>
                    </div>
                  </td>
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

      {/* Sayfa içi fatura önizleme modalı (lightbox) */}
      {previewFatura && (
        <EarsivPreviewModal
          fatura={previewFatura}
          autoPrint={previewAutoPrint}
          onClose={() => { setPreviewFatura(null); setPreviewAutoPrint(false); }}
        />
      )}
    </div>
  );
}

/** E-Arşiv fatura sayfa-içi önizleme modalı — backend HTML'i auth'lu fetch ile alır,
 *  iframe srcDoc içine basar. Yazdır butonu iframe.contentWindow.print() tetikler.
 */
function EarsivPreviewModal({
  fatura,
  autoPrint,
  onClose,
}: {
  fatura: EarsivFatura;
  autoPrint: boolean;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // ESC + body scroll kilit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  // HTML'i auth'lu fetch et (api interceptor Authorization header'ı koyar)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/earsiv/${fatura.id}/html`, { responseType: 'text' });
        if (cancel) return;
        setHtml(typeof res.data === 'string' ? res.data : String(res.data));
      } catch (e: any) {
        if (cancel) return;
        setError(e?.response?.data?.message || e?.message || 'Fatura HTML alınamadı');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [fatura.id]);

  // İçerik yüklendiğinde autoPrint ise yazdırma tetikle
  useEffect(() => {
    if (!html || !autoPrint || !iframeRef.current) return;
    const tid = setTimeout(() => {
      try { iframeRef.current?.contentWindow?.print(); } catch {}
    }, 500);
    return () => clearTimeout(tid);
  }, [html, autoPrint]);

  const triggerPrint = () => {
    try { iframeRef.current?.contentWindow?.print(); }
    catch { toast.error('Yazdırma başlatılamadı'); }
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const tarihStr = new Date(fatura.faturaTarihi).toLocaleDateString('tr-TR');

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.85)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] w-full h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Üst bar */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-t-xl"
          style={{ background: 'rgba(15,13,11,.95)', color: '#fff' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
              style={{ background: 'rgba(59,130,246,.2)', color: '#60a5fa' }}
            >
              ALIŞ · E-ARŞİV
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{fatura.satici || '—'}</div>
              <div className="text-xs opacity-70">
                #{fatura.faturaNo} · {tarihStr} · ₺
                {Number(fatura.toplamTutar || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerPrint}
              disabled={!html || loading}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
            >
              <Printer size={12} /> Yazdır
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
              title="Kapat (ESC)"
            >
              <XCircle size={18} />
            </button>
          </div>
        </div>
        {/* İçerik */}
        <div
          className="flex-1 rounded-b-xl overflow-hidden"
          style={{ background: 'rgba(15,13,11,.85)' }}
        >
          {loading && (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={32} className="animate-spin" style={{ color: '#fff' }} />
            </div>
          )}
          {error && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center p-8" style={{ color: '#fca5a5' }}>
                <AlertCircle size={32} className="mx-auto mb-2" />
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}
          {html && !loading && !error && (
            <iframe
              ref={iframeRef}
              srcDoc={html}
              className="w-full h-full bg-white"
              title={fatura.faturaNo}
              sandbox="allow-same-origin allow-scripts allow-modals allow-popups allow-forms"
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
