'use client';
import React, { useState, useEffect } from 'react';
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

// Roman numeral dönemler (geçici vergi terminolojisi)
const DONEM_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
const DONEM_FULL: Record<number, string> = {
  1: '1. Dönem (Oca-Mar)',
  2: '2. Dönem (Nis-Haz)',
  3: '3. Dönem (Tem-Eyl)',
  4: '4. Dönem (Eki-Ara)',
};

type ManuelField = keyof IhoManuelPayload;
const MANUEL_FIELDS: ManuelField[] = [
  'satisHasilati',
  'digerGelir',
  'malAlisi',
  'donemBasiStok',
  'kalanStok',
  'donemIciGiderler',
  'gecmisYilZarari',
  'oncekiOdenenGecVergi',
];

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

  // 4. Dönem → 1. Dönem ters sıra
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
            className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-50"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
        )}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Mükellef seçici */}
          <div className="relative min-w-[300px]">
            <label className="mb-1 block text-xs text-stone-600">Mükellef</label>
            <button
              onClick={() => setTpDropdownOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            >
              <span className="flex items-center gap-2 truncate">
                <Users className="h-4 w-4 text-stone-400" />
                <span className={selectedTp ? 'text-stone-900' : 'text-stone-400'}>
                  {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-stone-400" />
            </button>
            {tpDropdownOpen && (
              <div className="absolute top-full left-0 z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-stone-200 bg-white shadow-lg">
                <div className="sticky top-0 border-b border-stone-100 bg-white p-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2 h-4 w-4 text-stone-400" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Ad / VKN ara…"
                      className="w-full rounded border border-stone-200 bg-white py-1.5 pl-8 pr-2 text-sm text-stone-900 outline-none placeholder:text-stone-400"
                    />
                  </div>
                </div>
                {filteredTp.length === 0 && (
                  <div className="p-4 text-center text-sm text-stone-400">Sonuç yok</div>
                )}
                {filteredTp.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTaxpayerId(t.id);
                      setTpDropdownOpen(false);
                      setSearch('');
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-50"
                  >
                    <div className="font-medium text-stone-900">{taxpayerName(t)}</div>
                    {t.taxNumber && (
                      <div className="text-xs text-stone-500">VKN/TCKN: {t.taxNumber}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Yıl */}
          <div>
            <label className="mb-1 block text-xs text-stone-600">Yıl</label>
            <select
              value={yil}
              onChange={(e) => setYil(Number(e.target.value))}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
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
              className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100 disabled:opacity-50"
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
        <div className="rounded-xl border border-stone-200 bg-white p-12 text-center text-sm text-stone-500">
          Görüntülemek için mükellef seçin.
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-stone-200 bg-white p-12 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-stone-400" />
        </div>
      ) : hicKayitYok ? (
        <div className="rounded-xl border border-stone-200 bg-white p-12 text-center text-sm text-stone-500">
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
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   KARŞILAŞTIRMA TABLOSU — kullanıcı Excel formatına göre
─────────────────────────────────────────────── */
function KarsilastirmaTablosu({
  yilData,
  tersDonemler,
  onUpdate,
  onLock,
  onUnlock,
  onDelete,
}: {
  yilData: IhoYil;
  tersDonemler: number[];
  onUpdate: (id: string, payload: IhoManuelPayload) => void;
  onLock: (id: string) => void;
  onUnlock: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const yil = yilData?.yil;

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
          donemIciGiderler: Number(c.donemIciGiderler || 0),
          gecmisYilZarari: Number(c.gecmisYilZarari || 0),
          oncekiOdenenGecVergi: Number(c.oncekiOdenenGecVergi || 0),
        };
      }
    }
    setDrafts(next);
  }, [yilData]);

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

  const valOf = (donem: number, key: keyof IsletmeHesapOzeti) => {
    const c = yilData?.ceyrekler?.[donem - 1];
    if (!c) return 0;
    return Number((c as any)[key] || 0);
  };

  const numInput = (donem: number, field: ManuelField) => {
    const c = yilData?.ceyrekler?.[donem - 1];
    const locked = !!c?.locked;
    return (
      <input
        type="number"
        step="0.01"
        disabled={locked || !c}
        value={drafts[donem]?.[field] ?? 0}
        onChange={(e) =>
          setDrafts((prev) => ({
            ...prev,
            [donem]: { ...(prev[donem] || {}), [field]: Number(e.target.value) },
          }))
        }
        className="w-full rounded border border-stone-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-stone-900 focus:border-amber-400 focus:outline-none disabled:bg-stone-50 disabled:text-stone-400"
      />
    );
  };

  const calcCell = (donem: number, key: keyof IsletmeHesapOzeti) => fmtTRY(valOf(donem, key));

  const COL_WIDTH = `${66 / tersDonemler.length}%`;

  return (
    <div className="rounded-xl border border-stone-200 bg-white">
      {/* Üst aksiyon barı */}
      <div className="flex items-center justify-end gap-2 border-b border-stone-100 px-3 py-2">
        {tersDonemler.map((d) => {
          const c = yilData?.ceyrekler?.[d - 1];
          if (!c) return null;
          return (
            <div key={d} className="flex items-center gap-1">
              <span className="text-xs text-stone-500">{DONEM_FULL[d]}:</span>
              {c.locked ? (
                <button
                  onClick={() => onUnlock(c.id)}
                  title="Kilidi aç (ADMIN)"
                  className="rounded p-1 hover:bg-stone-100"
                >
                  <Lock className="h-3.5 w-3.5 text-amber-600" />
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onLock(c.id)}
                    title="Kesin kayda al"
                    className="rounded p-1 hover:bg-stone-100"
                  >
                    <Unlock className="h-3.5 w-3.5 text-stone-400" />
                  </button>
                  <button
                    onClick={() => onDelete(c.id)}
                    title="Sil"
                    className="rounded p-1 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '34%' }} />
            {tersDonemler.map((d) => (
              <col key={d} style={{ width: COL_WIDTH }} />
            ))}
          </colgroup>
          <thead className="bg-stone-50">
            <tr>
              <th className="border-b border-stone-200 px-3 py-2 text-left text-xs font-semibold text-stone-700">
                AÇIKLAMA
              </th>
              {tersDonemler.map((d) => (
                <th
                  key={d}
                  className="border-b border-stone-200 px-3 py-2 text-right text-xs font-semibold text-stone-700"
                >
                  {DONEM_ROMAN[d]}. Dönem
                  <div className="text-[10px] font-normal text-stone-400">{yil}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* ═══════════════════════════════════════════
               BLOK 1 — KAR/ZARAR ÖZETİ (kullanıcı Excel sırası)
            ═══════════════════════════════════════════ */}
            <Row
              label="DÖNEM İÇİ SATIŞLAR"
              bold
              cols={tersDonemler.map((d) => numInput(d, 'satisHasilati'))}
              raw
            />
            <Row
              label="SATILAN MALIN MALİYETİ (-)"
              bold
              cols={tersDonemler.map((d) => calcCell(d, 'satilanMalMaliyeti'))}
              calc
            />
            <Row
              label="NET SATIŞLAR"
              bold
              hl="bg-emerald-50"
              cols={tersDonemler.map((d) => calcCell(d, 'netSatislar'))}
              calc
            />
            <Row
              label="DÖNEM İÇİ GİDERLER (-)"
              bold
              cols={tersDonemler.map((d) => numInput(d, 'donemIciGiderler'))}
              raw
            />
            <Row
              label="DÖNEM KARI"
              bold
              hl="bg-amber-50"
              cols={tersDonemler.map((d) => {
                const v = valOf(d, 'donemKari');
                return (
                  <span key={d} className={v < 0 ? 'text-red-600' : 'text-emerald-700'}>
                    {fmtTRY(v)}
                  </span>
                );
              })}
              raw
            />

            <SpacerRow cols={tersDonemler.length} />

            {/* ═══════════════════════════════════════════
               BLOK 2 — STOK HAREKETİ DETAYI
            ═══════════════════════════════════════════ */}
            <Row
              label="SATIN ALINAN MAL BEDELİ"
              bold
              cols={tersDonemler.map((d) => numInput(d, 'malAlisi'))}
              raw
            />
            <Row
              label="DÖNEM BAŞI STOK"
              hint="(2-4. dönem önceki dönemin kalan stoğundan otomatik)"
              bold
              cols={tersDonemler.map((d) => numInput(d, 'donemBasiStok'))}
              raw
            />
            <Row
              label="TOPLAM STOK"
              bold
              cols={tersDonemler.map((d) => calcCell(d, 'toplamStok'))}
              calc
            />
            <Row
              label="SATILAN MALIN MALİYETİ"
              bold
              cols={tersDonemler.map((d) => calcCell(d, 'satilanMalMaliyeti'))}
              calc
            />
            <Row
              label="KALAN STOK (sayım)"
              bold
              cols={tersDonemler.map((d) => numInput(d, 'kalanStok'))}
              raw
            />

            <SpacerRow cols={tersDonemler.length} />

            {/* ═══════════════════════════════════════════
               BLOK 3 — GEÇİCİ VERGİ
            ═══════════════════════════════════════════ */}
            <Row
              label="DÖNEM KARI"
              bold
              cols={tersDonemler.map((d) => calcCell(d, 'donemKari'))}
              calc
            />
            <Row
              label="GEÇMİŞ YIL ZARARI (-)"
              bold
              cols={tersDonemler.map((d) => numInput(d, 'gecmisYilZarari'))}
              raw
            />
            <Row
              label="GEÇİCİ VERGİ MATRAHI"
              bold
              cols={tersDonemler.map((d) => calcCell(d, 'gecVergiMatrahi'))}
              calc
            />
            <Row
              label="HESAPLANAN GEÇİCİ VERGİ %15"
              bold
              cols={tersDonemler.map((d) => calcCell(d, 'hesaplananGecVergi'))}
              calc
            />
            <Row
              label="ÖNCEKİ DÖNEM ÖDENEN GEÇİCİ VERGİ (-)"
              bold
              cols={tersDonemler.map((d) => numInput(d, 'oncekiOdenenGecVergi'))}
              raw
            />
            <Row
              label="ÖDENECEK GEÇİCİ VERGİ"
              bold
              hl="bg-indigo-100"
              cols={tersDonemler.map((d) => (
                <span key={d} className="font-bold text-indigo-900">
                  {fmtTRY(valOf(d, 'odenecekGecVergi'))}
                </span>
              ))}
              raw
            />
          </tbody>
        </table>
      </div>

      {/* Kaydet barı */}
      <div className="flex items-center justify-end gap-2 border-t border-stone-100 px-3 py-3">
        {tersDonemler.map((d) => {
          const c = yilData?.ceyrekler?.[d - 1];
          if (!c) return null;
          if (c.locked) {
            return (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-700 ring-1 ring-amber-200"
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
              className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-50"
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

/* ─────────────────────────────────────────────
   YARDIMCI KOMPONENTLER
─────────────────────────────────────────────── */
function SpacerRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols + 1} className="h-4 border-b border-stone-100 bg-stone-50/30">&nbsp;</td>
    </tr>
  );
}

function Row({
  label,
  cols,
  bold,
  hl,
  hint,
  calc,
  raw,
}: {
  label: string;
  cols: React.ReactNode[];
  bold?: boolean;
  hl?: string;
  hint?: string;
  calc?: boolean; // hesaplanan alan — gri zemin
  raw?: boolean;  // input/element — bg uygulanmaz
}) {
  return (
    <tr className={hl || ''}>
      <td
        className={`border-b border-stone-100 px-3 py-1.5 text-xs ${
          bold ? 'font-semibold text-stone-900' : 'text-stone-700'
        }`}
      >
        {label}
        {hint && <span className="ml-2 text-[10px] font-normal text-stone-400">{hint}</span>}
      </td>
      {cols.map((c, i) => (
        <td
          key={i}
          className={`border-b border-stone-100 px-3 py-1.5 text-right tabular-nums text-stone-900 ${
            bold ? 'font-semibold' : ''
          } ${calc && !raw ? 'bg-stone-50/60' : ''}`}
        >
          {c}
        </td>
      ))}
    </tr>
  );
}
