'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
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
const TABLE_SURFACE = '#0f0e0c';
const TABLE_SURFACE_ALT = '#12110f';
const TABLE_HEADER_BG = '#1c1913';
const TABLE_SECTION_BG = '#17140f';
const GRID_LINE = 'rgba(245,240,230,0.20)';
const GRID_LINE_STRONG = 'rgba(212,184,118,0.34)';
const REPORT_TEXT = 'rgba(250,250,249,0.95)';
const REPORT_MUTED = 'rgba(231,229,228,0.74)';
const REPORT_DIM = 'rgba(214,211,209,0.54)';
const AMOUNT_TEXT = '#f3eee6';
const AMOUNT_ACCENT = '#ead18a';
const PROFIT_TEXT = AMOUNT_TEXT;
const LOSS_TEXT = '#fca5a5';
const RATIO_TEXT = '#f1d98b';
const MANUAL_TEXT = '#ead18a';
const MANUAL_BORDER = 'rgba(212,184,118,0.62)';
const MANUAL_ROW_BG = TABLE_SURFACE;
const TOTAL_ROW_BG = TABLE_SECTION_BG;
const REPORT_TABLE_STYLE: React.CSSProperties = {
  tableLayout: 'fixed',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
};

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

  const inputColor = value ? AMOUNT_TEXT : REPORT_DIM;
  const inputWeight = value ? 650 : 600;

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
      className="num-input w-full px-2.5 py-1 text-center text-[15px] font-mono tabular-nums transition-all focus:outline-none"
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: focused ? `1px solid ${GRID_LINE_STRONG}` : '1px solid transparent',
        // Boş değer (0) çok soluk; dolu değer net görünür
        // v1.36.33: locked (kesin kayıt) rakam altın renkte net görünür, silikleşmesin
        color: inputColor,
        fontVariantNumeric: 'tabular-nums',
        colorScheme: 'dark',
        fontWeight: inputWeight,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !focused) (e.currentTarget as HTMLInputElement).style.borderBottom = `1px solid ${GRID_LINE}`;
      }}
      onMouseLeave={(e) => {
        if (!disabled && !focused) (e.currentTarget as HTMLInputElement).style.borderBottom = '1px solid transparent';
      }}
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
    staleTime: 10 * 60 * 1000, // 10 dk cache — taxpayer listesi nadiren değişir
  });

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: yilData, isLoading } = useQuery<IhoYil>({
    queryKey: ['iho-yil', taxpayerId, yil],
    queryFn: () => isletmeHesapOzetiApi.getYil(taxpayerId, yil),
    enabled: !!taxpayerId && !!yil,
    // v1.36.58: Firma değiştirme hızlandırması
    staleTime: 5 * 60 * 1000, // 5 dk: aynı firma+yıl tekrar açılırsa anında gelir
    placeholderData: (prev: any) => prev, // yeni firma yüklenirken eski veri ekranda kalır → blank screen yok
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

  const cancelLucaJobsMut = useMutation({
    mutationFn: async () => {
      const jobs = Object.values(lucaJobs).filter(Boolean) as Array<{ jobId: string }>;
      await Promise.allSettled(jobs.map((job) => isletmeHesapOzetiApi.cancelLucaJob(job.jobId)));
    },
    onSuccess: () => {
      toast.info('Luca çekimi iptal edildi');
      setLucaJobs({});
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Luca işlemi iptal edilemedi'),
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
  const activeLucaJobIds = Object.values(lucaJobs).filter(Boolean).map((job: any) => job.jobId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" style={{ color: GOLD }} />
          <h1 className="text-xl font-semibold">İşletme Hesap Özeti</h1>
          <span className="text-xs text-stone-500">
            (Luca'dan otomatik çekim · sadece Satılan Malın Maliyeti ve Geçmiş Yıl Zararı manuel girilir)
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

      <LucaInlineCaptchaPanel
        jobIds={activeLucaJobIds}
        color={GOLD}
        onCancel={() => cancelLucaJobsMut.mutate()}
      />

      <div
        className="rounded-xl border border-white/10 p-4"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
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
              <div
                className="absolute top-full left-0 z-10 mt-1 max-h-72 w-full overflow-auto rounded-md shadow-lg"
                style={{
                  background: '#12100c',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div
                  className="sticky top-0 border-b border-white/5 p-2"
                  style={{ background: '#12100c' }}
                >
                  <div className="relative">
                    <Search className="absolute left-2 top-2 h-4 w-4 text-stone-500" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Ad / VKN ara…"
                      className="w-full rounded py-1.5 pl-8 pr-2 text-sm text-stone-100 outline-none placeholder:text-stone-500"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
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
        <div
          className="rounded-xl border border-white/10 p-12 text-center text-sm text-stone-500"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          Görüntülemek için mükellef seçin.
        </div>
      ) : isLoading ? (
        <div
          className="rounded-xl border border-white/10 p-12 text-center"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-stone-500" />
        </div>
      ) : hicKayitYok ? (
        <div
          className="rounded-xl border border-white/10 p-12 text-center text-sm text-stone-500"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
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
                `Güvenlik kodu gerekirse portal içindeki Luca Oturum Yöneticisi'nde gösterilecek.\n\n` +
                `Başlatılsın mı?`,
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
    return `%${pct.toFixed(1).replace('.', ',')}`;
  };

  const COL_WIDTH = `${76 / tersDonemler.length}%`;

  // Gelir tablosuyla aynı altın renk
  const GOLD = '#d4b876';

  // Dönem aralık metinleri
  const DONEM_RANGE: Record<number, string> = {
    1: 'Ocak – Mart',
    2: 'Nisan – Haziran',
    3: 'Temmuz – Eylül',
    4: 'Ekim – Aralık',
  };

  return (
    <div className="space-y-3">
      {/* v1.36.26: Dönem Aksiyonları + KAR/ZARAR ÖZETİ tek bağlı blok — boşluk yok */}
      <div className="space-y-0">
      {/* Üst dönem barı — tablonun sütun genişlikleriyle birebir hizalı */}
      <div
        className="rounded-t-xl overflow-hidden"
        style={{
          background: TABLE_HEADER_BG,
          borderTop: `1px solid ${GRID_LINE_STRONG}`,
          borderLeft: `1px solid ${GRID_LINE_STRONG}`,
          borderRight: `1px solid ${GRID_LINE_STRONG}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div
          className="grid"
          style={{
            // Tablo colgroup ile aynı: 34% boş + 4 dönem × COL_WIDTH
            gridTemplateColumns: `24% repeat(${tersDonemler.length}, ${COL_WIDTH})`,
          }}
        >
          {/* Sol AÇIKLAMA placeholder — tablonun ilk kolonuyla aynı genişlik */}
          <div
            className="px-3 py-3 flex items-center"
            style={{ borderRight: `1px solid ${GRID_LINE_STRONG}` }}
          >
            <span
              className="text-[10px] uppercase font-bold tracking-[.18em]"
              style={{ color: 'rgba(250,250,249,0.4)' }}
            >
              Dönem Aksiyonları
            </span>
          </div>
          {tersDonemler.map((d, idx) => {
            const c = yilData?.ceyrekler?.[d - 1];
            const locked = !!c?.locked;
            const job = lucaJobs[d];
            const fetching = job?.status === 'pending' || job?.status === 'running';
            const isLast = idx === tersDonemler.length - 1;
            return (
              <div
                key={d}
                className="px-3 py-3 text-center"
                style={{
                  background: locked ? 'rgba(212,184,118,0.10)' : 'transparent',
                  borderRight: !isLast ? `1px solid ${GRID_LINE_STRONG}` : 'none',
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
                    style={{ background: 'rgba(212,184,118,0.16)', color: AMOUNT_ACCENT, border: `1px solid ${GRID_LINE}` }}
                  >
                    <Lock size={9} /> KESİN
                  </span>
                )}

                {/* Aksiyon butonları — v1.36.22 tutarlı boyut + ortalı */}
                <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
                  {!locked && (
                    <button
                      onClick={() => onLucaCek(d)}
                      disabled={fetching}
                      title="Luca'dan İşletme Defteri Excel'i çek"
                      className="inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded disabled:opacity-50"
                      style={{
                        background: 'rgba(184,160,111,0.12)',
                        color: GOLD,
                        border: '1px solid rgba(184,160,111,0.3)',
                        height: 28,
                        padding: '0 10px',
                        minWidth: 100,
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
                        className="inline-flex items-center justify-center text-[11px] font-semibold rounded"
                        style={{
                          background: 'rgba(184,160,111,0.12)',
                          color: GOLD,
                          border: '1px solid rgba(184,160,111,0.3)',
                          height: 28,
                          padding: '0 10px',
                          minWidth: 88,
                        }}
                      >
                        Kesin Kayıt
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        title="İçerikleri temizle (kayıt kalır)"
                        className="inline-flex items-center justify-center rounded"
                        style={{
                          background: 'rgba(244,63,94,0.1)',
                          color: '#f43f5e',
                          border: '1px solid rgba(244,63,94,0.25)',
                          height: 28,
                          width: 28,
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
                      className="inline-flex items-center justify-center text-[11px] font-semibold rounded"
                      style={{
                        background: 'rgba(244,63,94,0.12)',
                        color: '#f43f5e',
                        border: '1px solid rgba(244,63,94,0.3)',
                        height: 28,
                        padding: '0 10px',
                        minWidth: 80,
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
        attached
      >
        <table className="w-full text-sm" style={REPORT_TABLE_STYLE}>
          <colgroup>
            <col style={{ width: '24%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          {/* v1.36.25: thead kaldirildi - boş yeşil çizgi yapıyordu, başlık direkt tablo */}
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
              manuel
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
                  <span
                    key={d}
                    style={{
                      color: lc.donemKar < 0 ? LOSS_TEXT : lc.donemKar > 0 ? PROFIT_TEXT : AMOUNT_TEXT,
                      display: 'inline-block',
                      fontSize: 14,
                      fontWeight: 650,
                      minWidth: 92,
                    }}
                  >
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
      </div>{/* /space-y-0 — Dönem Aksiyonları + KAR/ZARAR ÖZETİ tek bağlı blok bitti */}

      {/* ═══════════════════════════════════════════
          BLOK 2 — STOK HAREKETİ
      ═══════════════════════════════════════════ */}
      <BlockCard
        title="STOK HAREKETİ"
        icon={<Package className="h-4 w-4" />}
        accent="amber"
      >
        <table className="w-full text-sm" style={REPORT_TABLE_STYLE}>
          <colgroup>
            <col style={{ width: '24%' }} />
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
        <table className="w-full text-sm" style={REPORT_TABLE_STYLE}>
          <colgroup>
            <col style={{ width: '24%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <tbody>
            <Row
              label="DÖNEM KARI"
              cols={tersDonemler.map((d) => {
                const v = liveCalc(d).donemKar;
                return (
                  <span
                    key={d}
                    style={{
                      color: v < 0 ? LOSS_TEXT : v > 0 ? PROFIT_TEXT : AMOUNT_TEXT,
                      display: 'inline-block',
                      fontSize: 14,
                      fontWeight: 650,
                      minWidth: 92,
                    }}
                  >
                    {formatTR(v)}
                  </span>
                );
              })}
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
              manuel
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
                <span key={d} className="text-base font-bold" style={{ color: AMOUNT_ACCENT }}>
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

      {/* v1.36.70: DÖNEM AKSİYONLARI — üst tablonun sütun genişlikleriyle BİREBİR aynı grid.
          Her buton kendi sütunu içinde kalır, yan sütuna taşmaz. */}
      <div
        className="grid rounded-xl py-3 mt-3 items-center"
        style={{
          // Üst tablo ile aynı: 24% etiket + N × COL_WIDTH (her dönem 19%)
          gridTemplateColumns: `24% repeat(${tersDonemler.length}, ${COL_WIDTH})`,
          background: 'linear-gradient(135deg, rgba(212,184,118,0.08), rgba(212,184,118,0.02))',
          border: '1px solid rgba(212,184,118,0.25)',
        }}
      >
        <div
          className="flex items-center px-3 text-[11px] font-bold uppercase tracking-[.08em]"
          style={{ color: 'rgba(212,184,118,0.85)' }}
        >
          DÖNEM AKSİYONLARI
        </div>
        {tersDonemler.map((d) => {
          const c = yilData?.ceyrekler?.[d - 1];
          // Her butonu kendi sütun hücresine sar — px-2 hücre içi soluk + buton sütun sınırını geçmez.
          if (!c) {
            return <div key={d} className="px-2" />;
          }
          if (c.locked) {
            return (
              <div key={d} className="px-2 flex items-center justify-center">
                <div
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11.5px] font-semibold whitespace-nowrap w-full"
                  style={{
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.06))',
                    color: '#fbbf24',
                    border: '1px solid rgba(245,158,11,0.35)',
                  }}
                  title={`${DONEM_ROMAN[d]}. Dönem kesin kayıtla kilitlendi`}
                >
                  <Lock className="h-3 w-3 shrink-0" />
                  <span className="truncate">{DONEM_ROMAN[d]}. Kilitli</span>
                </div>
              </div>
            );
          }
          return (
            <div key={d} className="px-2 flex items-center justify-center">
              <button
                onClick={() => saveDraft(d)}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[12.5px] font-medium transition-all whitespace-nowrap w-full"
                style={{
                  background: 'rgba(244,63,94,0.06)',
                  color: '#fafaf9',
                  border: '1px solid rgba(244,63,94,0.20)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(244,63,94,0.12)';
                  e.currentTarget.style.borderColor = 'rgba(244,63,94,0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(244,63,94,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(244,63,94,0.20)';
                }}
                title={`${DONEM_ROMAN[d]}. Dönem manuel düzeltmelerini kaydet`}
              >
                <Save className="h-4 w-4 shrink-0" style={{ color: 'rgba(250,250,249,0.85)' }} />
                <span className="truncate">{DONEM_ROMAN[d]}. Dönemi Kaydet</span>
              </button>
            </div>
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
  attached,
}: {
  title: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'amber' | 'indigo';
  children: React.ReactNode;
  attached?: boolean; // v1.36.26: üstteki kutuya bitişikse top-rounded ve top-border kaldır
}) {
  const accentColors: Record<string, { headerBg: string; border: string; text: string; iconBg: string; iconText: string }> = {
    emerald: {
      headerBg: TABLE_HEADER_BG,
      border: GRID_LINE_STRONG,
      text: AMOUNT_ACCENT,
      iconBg: 'rgba(212,184,118,0.16)',
      iconText: AMOUNT_ACCENT,
    },
    amber: {
      headerBg: TABLE_HEADER_BG,
      border: GRID_LINE_STRONG,
      text: AMOUNT_ACCENT,
      iconBg: 'rgba(212,184,118,0.16)',
      iconText: AMOUNT_ACCENT,
    },
    indigo: {
      headerBg: TABLE_HEADER_BG,
      border: GRID_LINE_STRONG,
      text: AMOUNT_ACCENT,
      iconBg: 'rgba(212,184,118,0.16)',
      iconText: AMOUNT_ACCENT,
    },
  };
  const c = accentColors[accent];
  return (
    <div
      className={`overflow-hidden ${attached ? 'rounded-b-xl' : 'rounded-xl'}`}
      style={{
        background: TABLE_SURFACE,
        borderLeft: `1px solid ${c.border}`,
        borderRight: `1px solid ${c.border}`,
        borderBottom: `1px solid ${c.border}`,
        borderTop: attached ? 'none' : `1px solid ${c.border}`,
        boxShadow: '0 14px 34px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{
          // v1.36.26: attached durumda yeşil tint kaldırıldı, sadece çizgi kalır
          background: attached ? TABLE_SECTION_BG : c.headerBg,
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded"
          style={{ background: c.iconBg, color: c.iconText, border: `1px solid ${GRID_LINE}` }}
        >
          {icon}
        </span>
        <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: c.text }}>
          {title}
        </h2>
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
  manuel,
}: {
  label: string;
  cols: React.ReactNode[];
  ratios?: string[];
  bold?: boolean;
  hl?: string;
  hint?: string;
  calc?: boolean;
  raw?: boolean;
  manuel?: boolean; // v1.36.30: manuel giriş satırı — altın tint vurgu
}) {
  // v1.36.23: Oran sade renk — sadece text rengi değişir, rozet/border yok
  const ratioColor = (r: string): string => {
    if (!r || r === '—') return 'rgba(168,162,158,0.55)';
    const isNeg = r.includes('-');
    const num = parseFloat(r.replace(/[%,\s]/g, '').replace(',', '.')) || 0;
    if (isNeg) return LOSS_TEXT;
    if (num === 0) return 'rgba(168,162,158,0.55)';
    return RATIO_TEXT;
  };

  // v1.36.24: Gelir Tablosu stilinde kompakt — px-3 py-2 + küçük fontlar + tek satır rakam
  const rowBg = manuel ? MANUAL_ROW_BG : hl || calc ? TOTAL_ROW_BG : 'transparent';

  return (
    <tr style={{ background: rowBg }}>
      <td
        className={`px-4 py-2 ${
          bold ? 'text-[12.5px] font-bold tracking-wide' : 'text-[12px] font-semibold'
        }`}
        style={{
          letterSpacing: bold ? '0.025em' : '0.01em',
          color: manuel ? MANUAL_TEXT : bold ? REPORT_TEXT : REPORT_MUTED,
          borderTop: `1px solid ${GRID_LINE}`,
          borderRight: `1px solid ${GRID_LINE}`,
          borderLeft: manuel ? `4px solid ${MANUAL_BORDER}` : `1px solid transparent`,
          background: rowBg,
          lineHeight: 1.22,
        }}
      >
        {label}
        {hint && <span className="ml-2 text-[10px] font-normal" style={{ color: REPORT_DIM }}>{hint}</span>}
        {manuel && (
          <span
            className="ml-2 inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
            style={{
              background: 'rgba(212,184,118,0.12)',
              border: '1px solid rgba(212,184,118,0.28)',
              color: MANUAL_TEXT,
            }}
          >
            manuel
          </span>
        )}
      </td>
      {cols.map((c, i) => {
        const rColor = ratios && ratios[i] ? ratioColor(ratios[i]) : null;
        const cStr = typeof c === 'string' ? c : '';
        const isEmpty = cStr === '0,00' || cStr === '0';
        const showRatio = rColor && ratios![i] && ratios![i] !== '—' && !isEmpty;
        return (
          <td
            key={i}
            className={`px-4 py-2 text-center font-mono tabular-nums ${
              bold ? 'text-[15px] font-semibold' : 'text-[15px] font-semibold'
            }`}
            style={{
              borderTop: `1px solid ${GRID_LINE}`,
              borderLeft: `1px solid ${GRID_LINE}`,
              fontVariantNumeric: 'tabular-nums',
              color: isEmpty ? REPORT_DIM : AMOUNT_TEXT,
              lineHeight: 1.2,
              background: rowBg,
            }}
          >
            {showRatio ? (
              // v1.36.27: rakam ortalı, oran hücrenin sağ kenarına absolute
              <div className="flex flex-col items-center justify-center gap-0.5">
                <span className="tabular-nums">{c}</span>
                <span
                  className="text-[12px] not-italic font-mono tabular-nums"
                  style={{
                    color: rColor!,
                    fontWeight: 650,
                    letterSpacing: 0,
                  }}
                >
                  {ratios![i]}
                </span>
              </div>
            ) : (
              <span className="tabular-nums">{c}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
