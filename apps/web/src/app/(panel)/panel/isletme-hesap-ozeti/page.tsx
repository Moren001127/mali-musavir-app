'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  isletmeHesapOzetiApi,
  fmtTRY,
  type IhoYil,
  type IsletmeHesapOzeti,
  type IhoManuelPayload,
} from '@/lib/isletme-hesap-ozeti';
import { toast } from 'sonner';
import {
  Search, ChevronDown, Users, Loader2, Sparkles, Download,
  Lock, Unlock, BookOpen, Save, Trash2,
  TrendingUp, Package, Calculator, CloudDownload,
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

const DONEM_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
const DONEM_FULL: Record<number, string> = {
  1: '1. Dönem (Oca-Mar)',
  2: '2. Dönem (Nis-Haz)',
  3: '3. Dönem (Tem-Eyl)',
  4: '4. Dönem (Eki-Ara)',
};

type ManuelField =
  | 'satisHasilati'
  | 'digerGelir'
  | 'malAlisi'
  | 'donemBasiStok'
  | 'kalanStok'
  | 'satilanMalMaliyeti'
  | 'donemIciGiderler'
  | 'gecmisYilZarari'
  | 'oncekiOdenenGecVergi';

const MANUEL_FIELDS: ManuelField[] = [
  'satisHasilati',
  'digerGelir',
  'malAlisi',
  'donemBasiStok',
  'kalanStok',
  'satilanMalMaliyeti',
  'donemIciGiderler',
  'gecmisYilZarari',
  'oncekiOdenenGecVergi',
];

/* ─── TR-locale number formatting ─── */
function formatTR(n: number): string {
  if (!isFinite(n)) return '0,00';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseTR(s: string): number {
  if (!s) return 0;
  // TR: "1.234.567,89" → 1234567.89
  const cleaned = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

/* ─── Smart number input — TR locale formatting ─── */
function NumInput({
  value,
  onChange,
  disabled,
  placeholder = '0,00',
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string>(value ? formatTR(value) : '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value ? formatTR(value) : '');
  }, [value, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        // Edit modunda raw göster
        setText(value ? String(value).replace('.', ',') : '');
        e.target.select();
      }}
      onBlur={() => {
        setFocused(false);
        const n = parseTR(text);
        onChange(n);
        setText(formatTR(n));
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-right text-sm tabular-nums text-stone-100 transition-colors focus:border-amber-400 focus:bg-amber-500/10 focus:outline-none focus:ring-1 focus:ring-amber-400/40 disabled:bg-white/[0.02] disabled:text-stone-500"
    />
  );
}

export default function IsletmeHesapOzetiPage() {
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [yil, setYil] = useState<number>(currentYear);
  const [search, setSearch] = useState('');
  const [tpDropdownOpen, setTpDropdownOpen] = useState(false);

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: yilData, isLoading } = useQuery<IhoYil>({
    queryKey: ['iho-yil', taxpayerId, yil],
    queryFn: () => isletmeHesapOzetiApi.getYil(taxpayerId, yil),
    enabled: !!taxpayerId && !!yil,
  });

  const olusturYilMutation = useMutation({
    mutationFn: () => isletmeHesapOzetiApi.olusturYil({ taxpayerId, yil }),
    onSuccess: () => {
      toast.success(`${yil} yılı için 4 dönem boş kayıt açıldı`);
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; payload: IhoManuelPayload }) =>
      isletmeHesapOzetiApi.updateManuel(data.id, data.payload),
    onSuccess: () => {
      toast.success('Kaydedildi');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  const lockMutation = useMutation({
    mutationFn: (id: string) => isletmeHesapOzetiApi.lock(id),
    onSuccess: () => {
      toast.success('Kesin kayda alındı');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
  });
  const unlockMutation = useMutation({
    mutationFn: (data: { id: string; reason: string }) =>
      isletmeHesapOzetiApi.unlock(data.id, data.reason),
    onSuccess: () => {
      toast.success('Kilit açıldı');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => isletmeHesapOzetiApi.remove(id),
    onSuccess: () => {
      toast.success('Silindi');
      qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
    },
  });

  // Luca çekim — her dönem için ayrı job state
  const [lucaJobs, setLucaJobs] = useState<Record<number, { jobId: string; status: string; message?: string } | null>>({});

  const lucaCekMutation = useMutation({
    mutationFn: (id: string) => isletmeHesapOzetiApi.lucaCek(id),
    onSuccess: (data, _id) => {
      const donem = data.donem;
      setLucaJobs((prev) => ({ ...prev, [donem]: { jobId: data.jobId, status: 'pending', message: data.message } }));
      toast.info(data.message);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Luca çekim başlatılamadı'),
  });

  // Job polling — her açık job'u 4 saniyede bir sorgula
  useEffect(() => {
    const activeJobs = Object.entries(lucaJobs).filter(([, j]) => j && (j.status === 'pending' || j.status === 'running'));
    if (activeJobs.length === 0) return;

    const interval = setInterval(async () => {
      for (const [donemStr, j] of activeJobs) {
        if (!j) continue;
        try {
          const updated = await isletmeHesapOzetiApi.getLucaJob(j.jobId);
          if (updated.status !== j.status) {
            setLucaJobs((prev) => ({
              ...prev,
              [Number(donemStr)]: { ...j, status: updated.status, message: updated.errorMsg || undefined },
            }));
            if (updated.status === 'done') {
              toast.success(`${donemStr}. dönem Luca'dan çekildi`);
              qc.invalidateQueries({ queryKey: ['iho-yil', taxpayerId, yil] });
              // Job'u listeden 5sn sonra temizle
              setTimeout(() => setLucaJobs((p) => ({ ...p, [Number(donemStr)]: null })), 5000);
            } else if (updated.status === 'failed') {
              toast.error(`${donemStr}. dönem çekim başarısız: ${updated.errorMsg || ''}`);
              setTimeout(() => setLucaJobs((p) => ({ ...p, [Number(donemStr)]: null })), 8000);
            }
          }
        } catch {
          // ignore polling errors
        }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [lucaJobs, qc, taxpayerId, yil]);


  async function indirExcel() {
    if (!taxpayerId) return;
    try {
      const buf = await isletmeHesapOzetiApi.exportYil(taxpayerId, yil);
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `isletme-hesap-ozeti-${yil}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Excel indirilemedi');
    }
  }

  const filteredTp = taxpayers.filter((t) =>
    !search ? true : taxpayerName(t).toLowerCase().includes(search.toLowerCase()) ||
      (t.taxNumber || '').includes(search),
  );

  const tersDonemler = [4, 3, 2, 1];
  const hicKayitYok = !!yilData && yilData.ceyrekler.every((c) => !c);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" style={{ color: GOLD }} />
          <h1 className="text-xl font-semibold">İşletme Hesap Özeti</h1>
          <span className="text-xs text-stone-500">
            (İşletme defteri tutan mükellefler · tüm tutarlar manuel girilir)
          </span>
        </div>
        {taxpayerId && !hicKayitYok && (
          <button
            onClick={indirExcel}
            className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm text-stone-100 hover:bg-white/10"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
        )}
      </div>

      <div className="rounded-xl border border-white/10 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[300px]">
            <label className="mb-1 block text-xs text-stone-500">Mükellef</label>
            <button
              onClick={() => setTpDropdownOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-stone-100"
            >
              <span className="flex items-center gap-2 truncate">
                <Users className="h-4 w-4 text-stone-500" />
                <span className={selectedTp ? 'text-stone-100' : 'text-stone-500'}>
                  {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-stone-500" />
            </button>
            {tpDropdownOpen && (
              <div className="absolute top-full left-0 z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border shadow-lg">
                <div className="sticky top-0 border-b border-white/5 bg-white p-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2 h-4 w-4 text-stone-500" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Ad / VKN ara…"
                      className="w-full rounded border py-1.5 pl-8 pr-2 text-sm text-stone-100 outline-none placeholder:text-stone-500"
                    />
                  </div>
                </div>
                {filteredTp.length === 0 && (
                  <div className="p-4 text-center text-sm text-stone-500">Sonuç yok</div>
                )}
                {filteredTp.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTaxpayerId(t.id);
                      setTpDropdownOpen(false);
                      setSearch('');
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                  >
                    <div className="font-medium text-stone-100">{taxpayerName(t)}</div>
                    {t.taxNumber && (
                      <div className="text-xs text-stone-500">VKN/TCKN: {t.taxNumber}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-stone-500">Yıl</label>
            <select
              value={yil}
              onChange={(e) => setYil(Number(e.target.value))}
              className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-stone-100"
            >
              {Array.from({ length: 6 }).map((_, i) => {
                const y = currentYear - i;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>
          </div>

          {taxpayerId && hicKayitYok && (
            <button
              onClick={() => olusturYilMutation.mutate()}
              disabled={olusturYilMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 ring-1 ring-amber-400/40 hover:bg-amber-500/15 disabled:opacity-50"
            >
              {olusturYilMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {yil} Yılını Başlat (4 Dönem Aç)
            </button>
          )}
        </div>
      </div>

      {!taxpayerId ? (
        <div className="rounded-xl border border-white/10 p-12 text-center text-sm text-stone-500">
          Görüntülemek için mükellef seçin.
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-white/10 p-12 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-stone-500" />
        </div>
      ) : hicKayitYok ? (
        <div className="rounded-xl border border-white/10 p-12 text-center text-sm text-stone-500">
          {yil} yılı için henüz kayıt açılmamış. Yukarıdaki "Yılı Başlat" butonuyla 4 dönem boş kayıtları
          oluşturup tutarları manuel girebilirsin.
        </div>
      ) : (
        <KarsilastirmaTablosu
          yilData={yilData!}
          tersDonemler={tersDonemler}
          onUpdate={(id, payload) => updateMutation.mutate({ id, payload })}
          onLock={(id) => lockMutation.mutate(id)}
          onUnlock={(id) => {
            const reason = window.prompt('Kilidi açma gerekçesi?');
            if (reason) unlockMutation.mutate({ id, reason });
          }}
          onDelete={(id) => {
            if (window.confirm('Bu dönem kaydı silinsin mi?')) deleteMutation.mutate(id);
          }}
          onLucaCek={(donem) => {
            const c = yilData?.ceyrekler?.[donem - 1];
            if (!c) return;
            const onay = window.confirm(
              `Luca'dan ${donem}. dönem İşletme Defteri çekilecek.\n\n` +
                `Devam etmeden önce Luca'da İşletme Defteri ekranını açın ve dönem aralığını seçin (${yil} yılı, ${donem}. çeyrek).\n\n` +
                `Sonra Moren Agent bookmarklet'ini çalıştırın. Hazır mısınız?`,
            );
            if (onay) lucaCekMutation.mutate(c.id);
          }}
          lucaJobs={lucaJobs}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   KARŞILAŞTIRMA TABLOSU
═══════════════════════════════════════════════════════ */
function KarsilastirmaTablosu({
  yilData,
  tersDonemler,
  onUpdate,
  onLock,
  onUnlock,
  onDelete,
  onLucaCek,
  lucaJobs,
}: {
  yilData: IhoYil;
  tersDonemler: number[];
  onUpdate: (id: string, payload: IhoManuelPayload) => void;
  onLock: (id: string) => void;
  onUnlock: (id: string) => void;
  onDelete: (id: string) => void;
  onLucaCek: (donem: number) => void;
  lucaJobs: Record<number, { jobId: string; status: string; message?: string } | null>;
}) {
  const yil = yilData?.yil;

  // Local draft — kullanıcı input'lara yazdıkça burada tutulur
  const [drafts, setDrafts] = useState<Record<number, Partial<Record<ManuelField, number>>>>({});

  useEffect(() => {
    const next: Record<number, Partial<Record<ManuelField, number>>> = {};
    for (let d = 1; d <= 4; d++) {
      const c = yilData?.ceyrekler?.[d - 1];
      if (c) {
        next[d] = {
          satisHasilati: Number(c.satisHasilati || 0),
          digerGelir: Number(c.digerGelir || 0),
          malAlisi: Number(c.malAlisi || 0),
          donemBasiStok: Number(c.donemBasiStok || 0),
          kalanStok: Number(c.kalanStok || 0),
          satilanMalMaliyeti: Number(c.satilanMalMaliyeti || 0),
          donemIciGiderler: Number(c.donemIciGiderler || 0),
          gecmisYilZarari: Number(c.gecmisYilZarari || 0),
          oncekiOdenenGecVergi: Number(c.oncekiOdenenGecVergi || 0),
        };
      }
    }
    setDrafts(next);
  }, [yilData]);

  // SMM ↔ Kalan Stok bağlama: kullanıcı SMM girince Kalan Stok auto, tersi de
  function setField(donem: number, field: ManuelField, val: number) {
    setDrafts((prev) => {
      const cur = { ...(prev[donem] || {}) };
      cur[field] = val;
      // Toplam stok = donemBasiStok + malAlisi
      const dbs = Number(cur.donemBasiStok || 0);
      const ma = Number(cur.malAlisi || 0);
      const toplam = dbs + ma;
      if (field === 'satilanMalMaliyeti') {
        cur.kalanStok = Math.round((toplam - val) * 100) / 100;
      } else if (field === 'kalanStok') {
        cur.satilanMalMaliyeti = Math.round((toplam - val) * 100) / 100;
      } else if (field === 'malAlisi' || field === 'donemBasiStok') {
        // Toplam değişti → mevcut kalanStok'a göre SMM yenilenir
        const kalan = Number(cur.kalanStok || 0);
        cur.satilanMalMaliyeti = Math.round((toplam - kalan) * 100) / 100;
      }
      return { ...prev, [donem]: cur };
    });
  }

  function saveDraft(donem: number) {
    const c = yilData?.ceyrekler?.[donem - 1];
    if (!c) return;
    const d = drafts[donem] || {};
    const payload: IhoManuelPayload = {};
    for (const f of MANUEL_FIELDS) {
      const newV = Number(d[f] || 0);
      const oldV = Number((c as any)[f] || 0);
      if (newV !== oldV) (payload as any)[f] = newV;
    }
    if (Object.keys(payload).length === 0) {
      toast.info('Değişiklik yok');
      return;
    }
    onUpdate(c.id, payload);
  }

  // Bir dönemin draft değerini getir (yoksa DB değerine düş)
  const draftVal = (donem: number, field: ManuelField): number => {
    const d = drafts[donem];
    if (d && field in d) return Number(d[field] || 0);
    const c = yilData?.ceyrekler?.[donem - 1];
    return c ? Number((c as any)[field] || 0) : 0;
  };

  // Toplam stok ve diğer türetilen değerler — draft'tan canlı hesapla
  const liveCalc = (donem: number) => {
    const dbs = draftVal(donem, 'donemBasiStok');
    const ma = draftVal(donem, 'malAlisi');
    const toplam = dbs + ma;
    const smm = draftVal(donem, 'satilanMalMaliyeti');
    const sat = draftVal(donem, 'satisHasilati');
    const dg = draftVal(donem, 'digerGelir');
    const toplamSat = sat + dg;
    const netSat = toplamSat - smm;
    const giderler = draftVal(donem, 'donemIciGiderler');
    const donemKar = netSat - giderler;
    const gyz = draftVal(donem, 'gecmisYilZarari');
    const matrah = Math.max(0, donemKar - gyz);
    const hesGV = matrah * 0.15;
    const oncOd = draftVal(donem, 'oncekiOdenenGecVergi');
    const odenecek = Math.max(0, hesGV - oncOd);
    return { toplam, smm, netSat, donemKar, matrah, hesGV, odenecek, sat, giderler };
  };

  // Yüzde hesaplayıcı (satışa oranla)
  const oran = (v: number, base: number): string => {
    if (!base || base === 0) return '—';
    const pct = (v / base) * 100;
    if (Math.abs(pct) > 9999) return '—';
    return `%${pct.toFixed(1)}`;
  };

  const COL_WIDTH = `${66 / tersDonemler.length}%`;

  // Gelir tablosuyla aynı altın renk
  const GOLD = '#b8a06f';

  // Dönem aralık metinleri
  const DONEM_RANGE: Record<number, string> = {
    1: 'Ocak – Mart',
    2: 'Nisan – Haziran',
    3: 'Temmuz – Eylül',
    4: 'Ekim – Aralık',
  };

  return (
    <div className="space-y-3">
      {/* Üst dönem barı — her dönem kendi bloğunda (gelir-tablosu stili) */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tersDonemler.length}, minmax(0, 1fr))` }}>
          {tersDonemler.map((d, idx) => {
            const c = yilData?.ceyrekler?.[d - 1];
            const locked = !!c?.locked;
            const job = lucaJobs[d];
            const fetching = job?.status === 'pending' || job?.status === 'running';
            return (
              <div
                key={d}
                className="px-3 py-3 text-center"
                style={{
                  background: locked ? 'rgba(34,197,94,0.06)' : 'transparent',
                  borderLeft: idx > 0 ? '1px solid rgba(184,160,111,0.18)' : 'none',
                }}
              >
                {/* Dönem başlığı */}
                <div
                  style={{
                    color: c ? GOLD : 'rgba(250,250,249,0.4)',
                    fontFamily: 'Fraunces, serif',
                    fontWeight: 600,
                    fontSize: 14,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {yil} · {DONEM_ROMAN[d]}. DÖNEM
                </div>
                <div
                  className="mt-0.5"
                  style={{
                    fontSize: 11,
                    color: c ? 'rgba(250,250,249,0.55)' : 'rgba(250,250,249,0.3)',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                  }}
                >
                  {DONEM_RANGE[d]}
                </div>

                {/* Locked rozet */}
                {locked && (
                  <span
                    className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                  >
                    <Lock size={9} /> KESİN
                  </span>
                )}

                {/* Aksiyon butonları */}
                <div className="flex items-center justify-center gap-1.5 mt-2">
                  {!locked && (
                    <button
                      onClick={() => onLucaCek(d)}
                      disabled={fetching}
                      title="Luca'dan İşletme Defteri Excel'i çek"
                      className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded disabled:opacity-50"
                      style={{
                        background: 'rgba(184,160,111,0.1)',
                        color: GOLD,
                        border: '1px solid rgba(184,160,111,0.25)',
                      }}
                    >
                      {fetching ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CloudDownload className="h-3 w-3" />
                      )}
                      {fetching ? 'Çekiliyor…' : "Luca'dan Çek"}
                    </button>
                  )}
                  {c && !locked && (
                    <>
                      <button
                        onClick={() => onLock(c.id)}
                        title="Kesin kayda al"
                        className="text-[10.5px] font-semibold px-2 py-1 rounded"
                        style={{
                          background: 'rgba(184,160,111,0.1)',
                          color: GOLD,
                          border: '1px solid rgba(184,160,111,0.25)',
                        }}
                      >
                        Kesin Kayıt
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        title="Sil"
                        className="p-1 rounded"
                        style={{
                          background: 'rgba(244,63,94,0.08)',
                          color: '#f43f5e',
                          border: '1px solid rgba(244,63,94,0.2)',
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  {locked && (
                    <button
                      onClick={() => onUnlock(c!.id)}
                      title="Kilidi aç (ADMIN)"
                      className="text-[10.5px] font-semibold px-2 py-1 rounded"
                      style={{
                        background: 'rgba(244,63,94,0.1)',
                        color: '#f43f5e',
                        border: '1px solid rgba(244,63,94,0.25)',
                      }}
                    >
                      Kilidi Aç
                    </button>
                  )}
                  {!c && (
                    <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.3)' }}>
                      Veri yok
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          BLOK 1 — KAR/ZARAR ÖZETİ
      ═══════════════════════════════════════════ */}
      <BlockCard
        title="KAR / ZARAR ÖZETİ"
        icon={<TrendingUp className="h-4 w-4" />}
        accent="emerald"
      >
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '34%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="border-b border-white/10 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                Açıklama
              </th>
              {tersDonemler.map((d) => (
                <th key={d} className="border-b border-white/10 px-3 py-2 text-right">
                  <div className="text-sm font-bold text-stone-100">{DONEM_ROMAN[d]}. Dönem</div>
                  <div className="text-[10px] font-normal text-stone-500">{yil}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row
              label="DÖNEM İÇİ SATIŞLAR"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'satisHasilati')}
                  onChange={(n) => setField(d, 'satisHasilati', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
              bold
            />
            <Row
              label="SATILAN MALIN MALİYETİ (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'satilanMalMaliyeti')}
                  onChange={(n) => setField(d, 'satilanMalMaliyeti', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.smm, lc.sat);
              })}
              raw
            />
            <Row
              label="BRÜT SATIŞ KARI"
              hint="(Satışlar − SMM)"
              cols={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return formatTR(lc.netSat);
              })}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.netSat, lc.sat);
              })}
              calc
              bold
              hl="bg-emerald-500/100/10"
            />
            <Row
              label="DÖNEM İÇİ GİDERLER (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'donemIciGiderler')}
                  onChange={(n) => setField(d, 'donemIciGiderler', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.giderler, lc.sat);
              })}
              raw
            />
            <Row
              label="DÖNEM KARI"
              cols={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return (
                  <span key={d} className={lc.donemKar < 0 ? 'text-rose-300' : 'text-emerald-300'}>
                    {formatTR(lc.donemKar)}
                  </span>
                );
              })}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.donemKar, lc.sat);
              })}
              raw
              bold
              hl="bg-amber-500/10"
            />
          </tbody>
        </table>
      </BlockCard>

      {/* ═══════════════════════════════════════════
          BLOK 2 — STOK HAREKETİ
      ═══════════════════════════════════════════ */}
      <BlockCard
        title="STOK HAREKETİ"
        icon={<Package className="h-4 w-4" />}
        accent="amber"
      >
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '34%' }} />            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="border-b border-white/10 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                Açıklama
              </th>
              {tersDonemler.map((d) => (
                <th key={d} className="border-b border-white/10 px-3 py-2 text-right">
                  <div className="text-sm font-bold text-stone-100">{DONEM_ROMAN[d]}. Dönem</div>
                  <div className="text-[10px] font-normal text-stone-500">{yil}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row
              label="DÖNEM İÇİ SATIŞLAR"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'satisHasilati')}
                  onChange={(n) => setField(d, 'satisHasilati', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
              bold
            />
            <Row
              label="SATILAN MALIN MALİYETİ (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'satilanMalMaliyeti')}
                  onChange={(n) => setField(d, 'satilanMalMaliyeti', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.smm, lc.sat);
              })}
              raw
            />
            <Row
              label="BRÜT SATIŞ KARI"
              hint="(Satışlar − SMM)"
              cols={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return formatTR(lc.netSat);
              })}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.netSat, lc.sat);
              })}
              calc
              bold
              hl="bg-emerald-500/100/10"
            />
            <Row
              label="DÖNEM İÇİ GİDERLER (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'donemIciGiderler')}
                  onChange={(n) => setField(d, 'donemIciGiderler', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.giderler, lc.sat);
              })}
              raw
            />
            <Row
              label="DÖNEM KARI"
              cols={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return (
                  <span key={d} className={lc.donemKar < 0 ? 'text-rose-300' : 'text-emerald-300'}>
                    {formatTR(lc.donemKar)}
                  </span>
                );
              })}
              ratios={tersDonemler.map((d) => {
                const lc = liveCalc(d);
                return oran(lc.donemKar, lc.sat);
              })}
              raw
              bold
              hl="bg-amber-500/10"
            />
          </tbody>
        </table>
      </BlockCard>

      <BlockCard
        title="STOK HAREKETİ"
        icon={<Package className="h-4 w-4" />}
        accent="amber"
      >
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '34%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <tbody>
            <Row
              label="SATIN ALINAN MAL BEDELİ"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'malAlisi')}
                  onChange={(n) => setField(d, 'malAlisi', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
            <Row
              label="DÖNEM BAŞI STOK"
              hint="(2-4. dönem önceki kalandan otomatik)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'donemBasiStok')}
                  onChange={(n) => setField(d, 'donemBasiStok', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
            <Row
              label="TOPLAM STOK"
              hint="(= Dönem Başı + Satın Alınan)"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).toplam))}
              calc
              bold
            />
            <Row
              label="SATILAN MALIN MALİYETİ"
              hint="(= Toplam − Kalan)"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).smm))}
              calc
            />
            <Row
              label="KALAN STOK (sayım)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'kalanStok')}
                  onChange={(n) => setField(d, 'kalanStok', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
          </tbody>
        </table>
      </BlockCard>

      <BlockCard
        title="GEÇİCİ VERGİ HESAPLAMASI"
        icon={<Calculator className="h-4 w-4" />}
        accent="indigo"
      >
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '34%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <tbody>
            <Row
              label="DÖNEM KARI"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).donemKar))}
              calc
              bold
            />
            <Row
              label="GEÇMİŞ YIL ZARARI (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'gecmisYilZarari')}
                  onChange={(n) => setField(d, 'gecmisYilZarari', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
            <Row
              label="GEÇİCİ VERGİ MATRAHI"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).matrah))}
              calc
              bold
            />
            <Row
              label="HESAPLANAN GEÇİCİ VERGİ %15"
              cols={tersDonemler.map((d) => formatTR(liveCalc(d).hesGV))}
              calc
            />
            <Row
              label="ÖNCEKİ DÖNEM ÖDENEN GEÇİCİ VERGİ (-)"
              cols={tersDonemler.map((d) => (
                <NumInput
                  key={d}
                  value={draftVal(d, 'oncekiOdenenGecVergi')}
                  onChange={(n) => setField(d, 'oncekiOdenenGecVergi', n)}
                  disabled={!!yilData.ceyrekler[d - 1]?.locked}
                />
              ))}
              raw
            />
            <Row
              label="ÖDENECEK GEÇİCİ VERGİ"
              cols={tersDonemler.map((d) => (
                <span key={d} className="text-base font-bold text-indigo-200">
                  {formatTR(liveCalc(d).odenecek)}
                </span>
              ))}
              raw
              bold
              hl="bg-indigo-500/20"
            />
          </tbody>
        </table>
      </BlockCard>

      <div className="flex items-center justify-end gap-2 rounded-xl border px-3 py-3">
        {tersDonemler.map((d) => {
          const c = yilData?.ceyrekler?.[d - 1];
          if (!c) return null;
          if (c.locked) {
            return (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 ring-1 ring-amber-400/40"
              >
                <Lock className="h-3 w-3" />
                {DONEM_ROMAN[d]}. Dönem kilitli
              </span>
            );
          }
          return (
            <button
              key={d}
              onClick={() => saveDraft(d)}
              className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-stone-900 hover:opacity-90"
            >
              <Save className="h-4 w-4" />
              {DONEM_ROMAN[d]}. Dönemi Kaydet
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BlockCard({
  title,
  icon,
  accent,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'amber' | 'indigo';
  children: React.ReactNode;
}) {
  const accentClasses: Record<string, { bg: string; border: string; text: string; iconBg: string }> = {
    emerald: { bg: 'bg-emerald-500/100/8', border: 'border-emerald-500/30', text: 'text-emerald-200', iconBg: 'bg-emerald-500/20 text-emerald-300' },
    amber:   { bg: 'bg-amber-500/100/8',   border: 'border-amber-500/30',   text: 'text-amber-200',   iconBg: 'bg-amber-500/15 text-amber-300' },
    indigo:  { bg: 'bg-indigo-500/100/8',  border: 'border-indigo-500/30',  text: 'text-indigo-200',  iconBg: 'bg-indigo-500/20 text-indigo-700' },
  };
  const a = accentClasses[accent];
  return (
    <div className={`overflow-hidden rounded-xl border ${a.border} bg-white`}>
      <div className={`flex items-center gap-2 border-b ${a.border} ${a.bg} px-4 py-2`}>
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${a.iconBg}`}>
          {icon}
        </span>
        <h2 className={`text-xs font-bold uppercase tracking-wider ${a.text}`}>{title}</h2>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Row({
  label,
  cols,
  ratios,
  bold,
  hl,
  hint,
  calc,
  raw,
}: {
  label: string;
  cols: React.ReactNode[];
  ratios?: string[];
  bold?: boolean;
  hl?: string;
  hint?: string;
  calc?: boolean;
  raw?: boolean;
}) {
  return (
    <tr className={hl || ''}>
      <td
        className={`border-b border-white/5 px-3 py-2 text-xs ${
          bold ? 'font-semibold text-stone-100' : 'text-stone-200'
        }`}
      >
        {label}
        {hint && <span className="ml-2 text-[10px] font-normal text-stone-500">{hint}</span>}
      </td>
      {cols.map((c, i) => (
        <td
          key={i}
          className={`border-b border-white/5 px-3 py-2 text-right tabular-nums text-stone-100 ${
            bold ? 'font-semibold' : ''
          } ${calc && !raw ? 'italic text-stone-200' : ''}`}
        >
          <div className="flex items-center justify-end gap-2">
            {ratios && ratios[i] && ratios[i] !== '—' && (
              <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium not-italic text-stone-500">
                {ratios[i]}
              </span>
            )}
            <span>{c}</span>
          </div>
        </td>
      ))}
    </tr>
  );
}
