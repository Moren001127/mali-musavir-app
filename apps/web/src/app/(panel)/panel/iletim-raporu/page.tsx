'use client';
import './iletim-raporu-white.css';
import { portalStyle } from '@/lib/portal-theme';


// =====================================================================
// İLETİM RAPORU — Ofis > İletim Raporu
// Hattat "İletim Raporları" mantığı (Muzaffer Bey 2026-09-14: "Hattat iletim
// raporlarını ne kadar güzel yapmış"): belge bazında, tarih sıralı DÜZ GÜNLÜK.
//   - Üstte süzgeç çubuğu: Mükellef · Tür · Belge Türü · Gönderim Şekli · Dönem
//     → [Filtrele] [Excel İndir]. Süzgeçler Filtrele'ye basınca uygulanır.
//   - Altta tablo: kayıt sayısı (20/50/100) + Ara; sütunlar Tarih · Mükellef ·
//     Belge Türü · Belge Adı · Durum. Durum = kanal rozeti (WhatsApp yeşil / Mail
//     mavi), iletilemeyende kırmızı "Hata" (+ üzerine gelince sebep), testte gri.
//   - Tarihe göre sıralanır (en yeni üstte); sayfalama Önceki/Sonraki.
//   - Matris YOK, "son durum" cümlesi YOK, hap sayaç YOK; altın yalnız başlıkta.
// Mantık/API: @/lib/iletim-raporu.ts · Sunucu: GET /akilli-bildirim/iletim-gunlugu
// =====================================================================

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, Filter, Loader2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { ayAdi, ayKaydir, buAy, dosyaIndir } from '@/lib/aylik-odeme';
import TaxpayerSelect, { type TaxpayerLite } from '@/components/ui/TaxpayerSelect';
import {
  BELGE_TURLERI, KANALLAR, SAYFA_BOYUTLARI, TURLER, VARSAYILAN_TABLO, durumIpucu, excelDosyaAdi, iletimGunluguApi, ozetCumlesi, sayfaBilgisi,
  sonSayfa, suzgecBos, tarihSaatSaniye,
  type BelgeTuru, type GunlukSatiri, type GunlukYaniti, type KanalSuzgeci, type Suzgec, type TabloDurumu, type Tur,
} from '@/lib/iletim-raporu';
import { GOLD, GOLD_SOFT, GRUP_ZEMIN, GriDugme, HUCRE, HUCRE_BASLIK, IKINCIL, KART, KENAR_NOTR, KENAR_YUMUSAK, METIN, SONUK } from '../aylik-odeme/_components/ortak';

/** Hattat'taki kanal rozet renkleri — Muzaffer Bey beğendi; yalnız bu iki rozet (ve hata) renkli */
const WHATSAPP_YESIL = '#25a55a';
const MAIL_MAVI = '#2f7ed8';
const HATA_KIRMIZI = '#d64545';

const GIRDI: CSSProperties = { background: 'rgba(255,255,255,0.035)', border: `1px solid ${KENAR_YUMUSAK}`, color: METIN, borderRadius: 10, outline: 'none', colorScheme: 'dark' };

async function hataMesaji(e: any, varsayilan: string): Promise<string> {
  const d = e?.response?.data;
  if (d instanceof Blob) {
    try {
      return JSON.parse(await d.text())?.message || varsayilan;
    } catch {
      return varsayilan;
    }
  }
  return d?.message || e?.message || varsayilan;
}

export default function IletimRaporuPage() {
  const qc = useQueryClient();
  const bugunAy = buAy();
  const [taslak, setTaslak] = useState<Suzgec>({ month: bugunAy, taxpayerId: '', tur: 'tumu', belgeTuru: '', kanal: '' });
  const [uygulanan, setUygulanan] = useState<Suzgec>(taslak);
  const [tablo, setTablo] = useState<TabloDurumu>(VARSAYILAN_TABLO);
  const [aramaMetni, setAramaMetni] = useState('');
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [deneniyor, setDeneniyor] = useState(false);

  // Ara kutusu: 300 ms bekleyip sorguya gider; her aramada 1. sayfa
  useEffect(() => {
    const z = setTimeout(() => setTablo((t) => (t.q === aramaMetni ? t : { ...t, q: aramaMetni, page: 1 })), 300);
    return () => clearTimeout(z);
  }, [aramaMetni]);

  const mukelleflerQ = useQuery<TaxpayerLite[]>({
    queryKey: ['taxpayers', 'iletim-raporu-secici'],
    queryFn: () => api.get('/taxpayers', { params: { status: 'all' } }).then((r) => (Array.isArray(r.data) ? r.data : r.data?.data || [])),
    staleTime: 5 * 60_000,
  });

  const gunlukQ = useQuery<GunlukYaniti>({
    queryKey: ['iletim-raporu', 'gunluk', uygulanan, tablo],
    queryFn: () => iletimGunluguApi.liste(uygulanan, tablo),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const yanit = gunlukQ.data;
  const satirlar = yanit?.satirlar || [];
  const degisiklikVar = useMemo(() => JSON.stringify(taslak) !== JSON.stringify(uygulanan), [taslak, uygulanan]);

  const filtrele = (s: Suzgec = taslak) => {
    setTaslak(s);
    setUygulanan(s);
    setTablo((t) => ({ ...t, page: 1 }));
  };
  const temizle = () => filtrele({ month: bugunAy, taxpayerId: '', tur: 'tumu', belgeTuru: '', kanal: '' });
  const ayDegistir = (m: string) => setTaslak((s) => ({ ...s, month: m }));

  const excelIndir = async () => {
    setIndiriliyor(true);
    try {
      const blob = await iletimGunluguApi.excel(uygulanan, tablo);
      dosyaIndir(blob, excelDosyaAdi(uygulanan.month));
    } catch (e: any) {
      toast.error(await hataMesaji(e, 'Excel indirilemedi'));
    } finally {
      setIndiriliyor(false);
    }
  };

  /** Başarısızları yeniden dene — sunucu force GÖNDERMEZ; iletilmiş belge tekrar gitmez. */
  const yenidenDene = async () => {
    setDeneniyor(true);
    try {
      const d = await iletimGunluguApi.yenidenDene(uygulanan.month);
      const denenen = d.denenen ?? d.retried ?? 0;
      const atlanan = d.atlanan ?? 0;
      toast.success(`${denenen} mükellef için yeniden denendi${atlanan ? ` · ${atlanan} tanesi atlandı` : ''}`);
      if (d.not) toast.info(d.not, { duration: 9000 });
      qc.invalidateQueries({ queryKey: ['iletim-raporu'] });
    } catch (e: any) {
      toast.error(await hataMesaji(e, 'Yeniden gönderilemedi'));
    } finally {
      setDeneniyor(false);
    }
  };

  const sirayiCevir = () => setTablo((t) => ({ ...t, sira: t.sira === 'desc' ? 'asc' : 'desc', page: 1 }));
  const sayfaya = (n: number) => setTablo((t) => ({ ...t, page: Math.min(Math.max(1, n), sonSayfa(yanit)) }));
  const yenidenDenenecek = yanit?.ozet.yenidenDenenecek ?? 0;
  const son = sonSayfa(yanit);

  return (
    <div data-ir-root className="mx-auto max-w-6xl space-y-3 pb-12">
      {/* Başlık — koyu temada (A) küçük kahraman kart; beyaz temada (D) iletim-raporu-white.css sade sayfa başlığına çevirir */}
      <header data-ir-head
        className="relative overflow-hidden rounded-[18px] border px-5 py-3.5"
        style={portalStyle({
          background: 'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
        })}
      >
        <div data-ir-bar className="absolute inset-x-0 top-0 h-1" style={portalStyle({ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' })} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span data-ir-icon className="grid shrink-0 place-items-center rounded-xl" style={portalStyle({ width: 40, height: 40, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, boxShadow: '0 8px 22px rgba(212,184,118,0.30)' })}>
              <ClipboardList size={21} style={portalStyle({ color: '#1a1410' })} />
            </span>
            <div className="min-w-0">
              <div data-ir-eyebrow className="mb-0.5 flex items-center gap-2">
                <span className="h-px w-[18px]" style={portalStyle({ background: GOLD })} />
                <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={portalStyle({ color: GOLD_SOFT })}>Ofis</span>
              </div>
              <h1 style={portalStyle({ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 600, color: METIN, letterSpacing: '-.03em', lineHeight: 1.05 })}>
                İletim Raporu
              </h1>
            </div>
          </div>
          <p data-ir-aciklama className="max-w-[460px] text-[12.5px] leading-5" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
            Mükellefe gönderilen her belgenin günlüğü — tarih sıralı, belge belge. Beyanname, SGK, e-Tebligat, Ödeme Listesi, Cari Kasa ve portal mesajları.
          </p>
        </div>
      </header>

      {/* Süzgeç çubuğu — Filtrele'ye basınca uygulanır */}
      <section data-ir-card className="p-3" style={portalStyle(KART)} data-testid="suzgec-cubugu">
        <form
          className="flex flex-wrap items-end gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            filtrele();
          }}
        >
          <Alan etiket="Mükellef" className="min-w-[220px] flex-[2]">
            <TaxpayerSelect
              taxpayers={mukelleflerQ.data || []}
              value={taslak.taxpayerId || '__ALL__'}
              onChange={(id) => setTaslak((s) => ({ ...s, taxpayerId: id === '__ALL__' ? '' : id }))}
              allLabel="Tüm mükellefler"
              allValue="__ALL__"
              placeholder="Tüm mükellefler"
              style={portalStyle({ height: 36, padding: '0 12px', borderRadius: 10, fontSize: 12.5, border: `1px solid ${KENAR_YUMUSAK}`, background: 'rgba(255,255,255,0.035)' })}
            />
          </Alan>
          <Alan etiket="Tür" className="min-w-[150px] flex-1">
            <Secim ariaLabel="Tür" value={taslak.tur} onChange={(v) => setTaslak((s) => ({ ...s, tur: v as Tur }))}>
              {TURLER.map((t) => <option key={t.key} value={t.key}>{t.ad}</option>)}
            </Secim>
          </Alan>
          <Alan etiket="Belge Türü" className="min-w-[140px] flex-1">
            <Secim ariaLabel="Belge Türü" value={taslak.belgeTuru} onChange={(v) => setTaslak((s) => ({ ...s, belgeTuru: v as BelgeTuru | '' }))}>
              <option value="">Tümü</option>
              {BELGE_TURLERI.map((b) => <option key={b} value={b}>{b}</option>)}
            </Secim>
          </Alan>
          <Alan etiket="Gönderim Şekli" className="min-w-[120px] flex-1">
            <Secim ariaLabel="Gönderim Şekli" value={taslak.kanal} onChange={(v) => setTaslak((s) => ({ ...s, kanal: v as KanalSuzgeci }))}>
              {KANALLAR.map((k) => <option key={k.key || 'tumu'} value={k.key}>{k.ad}</option>)}
            </Secim>
          </Alan>
          <Alan etiket="Dönem">
            <div className="inline-flex h-9 items-center rounded-[10px]" style={portalStyle({ border: `1px solid ${KENAR_YUMUSAK}`, background: 'rgba(255,255,255,0.035)' })} role="group" aria-label="Dönem">
              <button type="button" onClick={() => ayDegistir(ayKaydir(taslak.month, -1))} title="Önceki ay" aria-label="Önceki ay" className="flex h-full w-8 items-center justify-center rounded-l-[10px] transition hover:bg-white/[0.06]" style={portalStyle({ color: IKINCIL })}>
                <ChevronLeft size={15} />
              </button>
              <input
                type="month"
                value={taslak.month}
                aria-label="Ay"
                onChange={(e) => e.target.value && ayDegistir(e.target.value)}
                onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* tarayıcı desteklemiyorsa elle yazılır */ } }}
                className="h-full cursor-pointer bg-transparent px-1 text-center text-[12.5px] font-semibold outline-none [&::-webkit-calendar-picker-indicator]:hidden"
                style={portalStyle({ color: METIN, colorScheme: 'dark', width: 108 })}
                title={ayAdi(taslak.month)}
              />
              <button type="button" onClick={() => ayDegistir(ayKaydir(taslak.month, 1))} title="Sonraki ay" aria-label="Sonraki ay" className="flex h-full w-8 items-center justify-center rounded-r-[10px] transition hover:bg-white/[0.06]" style={portalStyle({ color: IKINCIL })}>
                <ChevronRight size={15} />
              </button>
            </div>
          </Alan>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              data-ir-btn="primary"
              data-degisiklik={degisiklikVar || undefined}
              title={degisiklikVar ? 'Seçilen süzgeçleri uygula' : 'Süzgeçler uygulanmış durumda'}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 text-[12.5px] font-bold transition-[transform,background-color] hover:-translate-y-px"
              style={portalStyle(degisiklikVar
                ? { background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.28)', color: METIN }
                : { background: 'rgba(255,255,255,0.07)', border: `1px solid ${KENAR_NOTR}`, color: METIN })}
            >
              <Filter size={13} /> Filtrele
            </button>
            <GriDugme onClick={excelIndir} yukleniyor={indiriliyor} disabled={gunlukQ.isLoading} title="Uygulanan süzgeçlerle tüm kayıtları Excel olarak indir (sayfalama yok)">
              <FileSpreadsheet size={13} /> Excel İndir
            </GriDugme>
            {!suzgecBos(uygulanan, bugunAy) && (
              <button type="button" onClick={temizle} className="text-[11.5px] font-semibold underline decoration-dotted underline-offset-4 hover:opacity-80" style={portalStyle({ color: IKINCIL })} title="Süzgeçleri sıfırla (bu ay, tüm mükellefler)">
                Temizle
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Tek satır özet + yeniden dene */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[12.5px] font-semibold" style={portalStyle({ color: IKINCIL })} data-testid="ozet-satiri">
          {gunlukQ.isLoading ? (
            <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> {ayAdi(uygulanan.month)} yükleniyor…</span>
          ) : (
            ozetCumlesi(uygulanan.month, yanit)
          )}
        </p>
        <GriDugme
          kucuk
          onClick={yenidenDene}
          yukleniyor={deneniyor}
          disabled={yenidenDenenecek === 0 || gunlukQ.isLoading}
          title={yenidenDenenecek
            ? 'Yalnızca BAŞARISIZ gönderimleri (Vergi / SGK / e-Tebligat) yeniden dener. Daha önce iletilmiş belge tekrar gönderilmez; kapalı kategori gönderilmez. Ödeme Listesi hataları Aylık Ödeme Listesi ekranından gönderilir.'
            : 'Bu ay yeniden denenecek başarısız gönderim yok (Ödeme Listesi hataları Aylık Ödeme Listesi ekranından gönderilir).'}
        >
          Başarısızları yeniden dene ({yenidenDenenecek})
        </GriDugme>
      </div>

      {/* Tablo kartı */}
      <section data-ir-card className="p-3" style={portalStyle(KART)}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 data-ir-tablo-baslik className="text-[11px] font-bold uppercase tracking-[.14em]" style={portalStyle({ color: 'rgba(250,250,249,0.62)' })}>İletim Raporları</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11.5px]" style={portalStyle({ color: IKINCIL })}>
              Kayıt
              <select
                aria-label="Sayfa başına kayıt"
                value={tablo.pageSize}
                onChange={(e) => setTablo((t) => ({ ...t, pageSize: Number(e.target.value), page: 1 }))}
                className="h-8 px-2 text-[12px] font-semibold"
                style={portalStyle(GIRDI)}
              >
                {SAYFA_BOYUTLARI.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="relative w-full sm:w-[240px]">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={portalStyle({ color: IKINCIL })} />
              <input
                type="search"
                value={aramaMetni}
                onChange={(e) => setAramaMetni(e.target.value)}
                placeholder="Ara — mükellef ya da belge"
                aria-label="Ara"
                className="h-8 w-full text-[12px] outline-none [&::-webkit-search-cancel-button]:hidden"
                style={portalStyle({ ...GIRDI, paddingLeft: 30, paddingRight: aramaMetni ? 28 : 12, WebkitAppearance: 'none', appearance: 'none' })}
              />
              {aramaMetni && (
                <button type="button" onClick={() => setAramaMetni('')} title="Aramayı temizle" aria-label="Aramayı temizle" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-white/[0.06]" style={portalStyle({ color: IKINCIL })}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div data-ir-tablo-kabugu className="overflow-x-auto rounded-xl" style={portalStyle({ border: `1px solid ${KENAR_NOTR}`, background: 'rgba(255,255,255,0.02)', opacity: gunlukQ.isFetching && !gunlukQ.isLoading ? 0.7 : 1, transition: 'opacity .15s' })}>
          <table className="w-full" style={portalStyle({ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 880 })} data-testid="iletim-tablosu">
            <colgroup>
              <col style={portalStyle({ width: 168 })} />
              <col />
              <col style={portalStyle({ width: 122 })} />
              <col />
              <col style={portalStyle({ width: 168 })} />
            </colgroup>
            <thead>
              <tr style={portalStyle({ background: GRUP_ZEMIN })}>
                <th style={portalStyle({ ...HUCRE_BASLIK, padding: 0 })}>
                  <button
                    type="button"
                    onClick={sirayiCevir}
                    aria-sort={tablo.sira === 'desc' ? 'descending' : 'ascending'}
                    title={tablo.sira === 'desc' ? 'En yeni üstte — eskiden yeniye sırala' : 'En eski üstte — yeniden eskiye sırala'}
                    className="inline-flex h-full w-full items-center gap-1 px-2.5 py-[7px] text-left uppercase tracking-[.08em] transition hover:bg-white/[0.04]"
                    style={portalStyle({ color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit' })}
                  >
                    Tarih {tablo.sira === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
                  </button>
                </th>
                <th style={portalStyle(HUCRE_BASLIK)}>Mükellef</th>
                <th style={portalStyle(HUCRE_BASLIK)}>Belge Türü</th>
                <th style={portalStyle(HUCRE_BASLIK)}>Belge Adı</th>
                <th style={portalStyle(HUCRE_BASLIK)}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {gunlukQ.isLoading ? (
                <tr>
                  <td colSpan={5} style={portalStyle(HUCRE)}>
                    <div className="flex items-center gap-2 px-1 py-5 text-[12.5px]" style={portalStyle({ color: IKINCIL })}>
                      <Loader2 size={14} className="animate-spin" /> Yükleniyor…
                    </div>
                  </td>
                </tr>
              ) : gunlukQ.isError ? (
                <tr>
                  <td colSpan={5} style={portalStyle(HUCRE)}>
                    <div className="px-1 py-5 text-[12.5px]" style={portalStyle({ color: HATA_KIRMIZI })}>Günlük alınamadı. Sayfayı yenileyip tekrar deneyin.</div>
                  </td>
                </tr>
              ) : satirlar.length === 0 ? (
                <tr>
                  <td colSpan={5} style={portalStyle(HUCRE)}>
                    <div className="px-1 py-5 text-[12.5px]" style={portalStyle({ color: IKINCIL })}>
                      {suzgecBos(uygulanan, bugunAy) && !tablo.q
                        ? 'Bu ay gönderim kaydı yok.'
                        : 'Bu süzgeçlere uyan gönderim yok.'}
                    </div>
                  </td>
                </tr>
              ) : (
                satirlar.map((s) => (
                  <tr key={s.id} data-durum={s.durum} data-kanal={s.kanal} data-ir-satir className="transition-colors hover:bg-white/[0.03]">
                    <td style={portalStyle({ ...HUCRE, whiteSpace: 'nowrap' })}>
                      <span className="text-[12.5px] tabular-nums" style={portalStyle({ color: METIN })}>{tarihSaatSaniye(s.tarih)}</span>
                    </td>
                    <td style={portalStyle({ ...HUCRE, minWidth: 0 })}>
                      <span className="block truncate text-[13px] font-medium leading-5" style={portalStyle({ color: METIN })} title={s.unvan}>{s.unvan}</span>
                    </td>
                    <td style={portalStyle(HUCRE)}>
                      <span className="text-[12.5px]" style={portalStyle({ color: IKINCIL })}>{s.belgeTuru}</span>
                    </td>
                    <td style={portalStyle({ ...HUCRE, minWidth: 0 })}>
                      <span className="block truncate text-[12.5px] leading-5" style={portalStyle({ color: METIN })} title={s.belgeAdi}>{s.belgeAdi}</span>
                    </td>
                    <td style={portalStyle(HUCRE)}>
                      <DurumHucresi s={s} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Sayfalama */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-[11.5px] tabular-nums" style={portalStyle({ color: SONUK })} data-testid="sayfa-bilgisi">{sayfaBilgisi(yanit)}</span>
          <div className="inline-flex items-center gap-1.5">
            <GriDugme kucuk onClick={() => sayfaya(tablo.page - 1)} disabled={!yanit || yanit.sayfa <= 1} title="Önceki sayfa">
              <ChevronLeft size={13} /> Önceki
            </GriDugme>
            <span className="px-1 text-[11.5px] tabular-nums" style={portalStyle({ color: IKINCIL })}>Sayfa {yanit?.sayfa ?? 1} / {son}</span>
            <GriDugme kucuk onClick={() => sayfaya(tablo.page + 1)} disabled={!yanit || yanit.sayfa >= son} title="Sonraki sayfa">
              Sonraki <ChevronRight size={13} />
            </GriDugme>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── küçük parçalar ─────────────────────────────────────────────────────────

/** Süzgeç alanı: küçük başlık + denetim (label DEĞİL: Dönem alanında üç denetim var, başlığa tıklayınca ilki tetiklenmesin) */
function Alan({ etiket, children, className = '' }: { etiket: string; children: ReactNode; className?: string }) {
  return (
    <div data-ir-alan className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[.08em]" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>{etiket}</span>
      {children}
    </div>
  );
}

/** Koyu temalı yerli seçim kutusu */
function Secim({ value, onChange, children, ariaLabel }: { value: string; onChange: (v: string) => void; children: ReactNode; ariaLabel: string }) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full px-2.5 text-[12.5px] font-medium" style={portalStyle(GIRDI)}>
      {children}
    </select>
  );
}

/** Dolu, küçük rozet — yalnız kanal (yeşil/mavi), hata (kırmızı) ve test/bekliyor (gri) */
function Rozet({ children, renk, title, kanca }: { children: ReactNode; renk: string; title?: string; kanca: string }) {
  return (
    <span title={title} data-ir-rozet={kanca} className="inline-flex items-center whitespace-nowrap rounded-md px-2 py-[2px] text-[10.5px] font-bold leading-4" style={portalStyle({ background: renk, color: '#fff' })}>
      {children}
    </span>
  );
}

function DurumHucresi({ s }: { s: GunlukSatiri }) {
  const ipucu = durumIpucu(s);
  return (
    <div className="flex flex-wrap items-center gap-1" title={ipucu}>
      <Rozet kanca={s.kanal === 'Mail' ? 'mail' : 'whatsapp'} renk={s.kanal === 'Mail' ? MAIL_MAVI : WHATSAPP_YESIL}>{s.kanal}</Rozet>
      {s.durum === 'İletilemedi' && <Rozet kanca="hata" renk={HATA_KIRMIZI} title={ipucu}>Hata</Rozet>}
      {s.durum === 'Test' && <Rozet kanca="notr" renk="rgba(255,255,255,0.16)" title={ipucu}>Test</Rozet>}
      {s.durum === 'Bekliyor' && <Rozet kanca="notr" renk="rgba(255,255,255,0.16)" title={ipucu}>Bekliyor</Rozet>}
    </div>
  );
}
