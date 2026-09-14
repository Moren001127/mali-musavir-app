'use client';

// =====================================================================
// İLETİM RAPORU — Ofis > İletim Raporu
// Akıllı Bildirim (Vergi / SGK / e-Tebligat) ve Aylık Ödeme Listesi
// gönderimlerinin ay bazında dökümü: kim aldı, kim almadı, kime hiç
// gönderilmedi.
//
// YENİDEN TASARIM (2026-09-14, Muzaffer Bey: "değişik değişik şekiller var,
// ne gönderildi ne gönderilmedi hiçbir şey anlamıyorum"):
//   - İkon/sembol/rozet YOK. Her hücre DÜZ YAZI, iki satır: üstte durum
//     ("İletildi · 12.09 14:20"), altta ayrıntı ("WhatsApp ve e-posta ile").
//   - Sayaç kutuları YOK; tek satır özet (hap; tıklayınca süzer).
//   - Tekrar eden sebep ("kategori kapalı") satırlarda değil, tablonun
//     üstünde TEK uyarı satırında.
//   - Sakin palet: koyu zemin, nötr griler; altın yalnız başlıkta; yumuşak
//     yeşil yalnız "iletildi", yumuşak kırmızı yalnız hata — ikisi de yazı
//     rengi, dolgu değil.
// Mantık (hücre/satır durumu, cümleler, süzgeç): @/lib/iletim-raporu.ts
// Sunucu: GET /akilli-bildirim/report?month= · POST /resend-failed {month}
//         · POST /run {kategori, taxpayerId, sinceHours} (satır bazlı deneme;
//           sunucudaki resendFailed ile aynı pencere ve aynı korumalar)
// =====================================================================

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Loader2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { ayAdi, ayKaydir, buAy } from '@/lib/aylik-odeme';
import {
  KATEGORILER, ayBasindanSaat, kapaliUyarisi, ozetCikar, satirlariHazirla, sebepMetni, testUyarisi,
  type HucreGorunumu, type Rapor, type SatirGorunumu, type Suzgec,
} from '@/lib/iletim-raporu';
import {
  AMBER, AMBER_KENAR, AMBER_ZEMIN, Cip, GOLD, GOLD_SOFT, GRUP_ZEMIN, GriDugme, HUCRE, HUCRE_BASLIK, IKINCIL, KART, KENAR_NOTR, KIRMIZI_YUMUSAK, METIN, SONUK,
} from '../aylik-odeme/_components/ortak';

/** Yumuşak yeşil — YALNIZ "iletildi" yazısı (dolgu değil) */
const YESIL_YUMUSAK = '#8fd7bd';

const SUZGEC_ANA: Array<{ key: Suzgec; ad: string }> = [
  { key: 'tumu', ad: 'Tümü' },
  { key: 'sorunlu', ad: 'Yalnız sorunlu' },
  { key: 'iletilen', ad: 'Yalnız iletilen' },
];

export default function IletimRaporuPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(buAy());
  const [suzgec, setSuzgec] = useState<Suzgec>('tumu');
  const [arama, setArama] = useState('');
  const [topluDeneniyor, setTopluDeneniyor] = useState(false);
  const [satirDeneniyor, setSatirDeneniyor] = useState<string | null>(null);

  const raporQ = useQuery<Rapor>({
    queryKey: ['iletim-raporu', month],
    queryFn: () => api.get('/akilli-bildirim/report', { params: { month } }).then((r) => r.data),
    refetchInterval: 60000,
  });
  const rapor = raporQ.data;
  const tumSatirlar = useMemo(() => satirlariHazirla(rapor?.taxpayers || [], 'tumu', ''), [rapor]);
  const gorunen = useMemo(() => satirlariHazirla(rapor?.taxpayers || [], suzgec, arama), [rapor, suzgec, arama]);
  const ozet = useMemo(() => ozetCikar(tumSatirlar), [tumSatirlar]);
  const kapali = useMemo(() => kapaliUyarisi(rapor, tumSatirlar), [rapor, tumSatirlar]);
  const test = useMemo(() => testUyarisi(rapor), [rapor]);
  const buAyMi = month === buAy();

  const ayDegistir = (m: string) => {
    setMonth(m);
    setSuzgec('tumu');
  };

  const yenile = () => qc.invalidateQueries({ queryKey: ['iletim-raporu', month] });

  /** Başarısızları yeniden dene — sunucu force GÖNDERMEZ; iletilmiş belge tekrar gitmez. */
  const topluYenidenDene = async () => {
    setTopluDeneniyor(true);
    try {
      const d = (await api.post('/akilli-bildirim/resend-failed', { month })).data || {};
      const denenen = d.denenen ?? d.retried ?? 0;
      const atlanan = d.atlanan ?? 0;
      toast.success(`${denenen} mükellef için yeniden denendi${atlanan ? ` · ${atlanan} tanesi atlandı` : ''}`);
      // Ödeme Listesi buradan yeniden gönderilemez (cetvelin tamamı giderdi); sunucu doğru ekranı söyler.
      if (d.not) toast.info(d.not, { duration: 9000 });
      yenile();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Yeniden gönderilemedi');
    } finally {
      setTopluDeneniyor(false);
    }
  };

  /** Tek mükellef: hatalı kategorileri (Vergi/SGK/e-Tebligat) sunucudaki toplu denemeyle aynı pencerede dener. */
  const satirYenidenDene = async (s: SatirGorunumu) => {
    setSatirDeneniyor(s.satir.taxpayerId);
    try {
      const sinceHours = ayBasindanSaat(month);
      let gitti = 0;
      let hatali = 0;
      let bulunamadi = 0;
      const notlar: string[] = [];
      for (const kategori of s.yenidenDenenecek) {
        const ad = KATEGORILER.find((k) => k.key === kategori)?.ad || kategori;
        const r = (await api.post('/akilli-bildirim/run', { kategori, taxpayerId: s.satir.taxpayerId, sinceHours })).data || {};
        if (r.ok === false) {
          notlar.push(`${ad}: ${r.skipped ? 'kategori kapalı (Ayarlar → Akıllı Bildirim)' : r.reason || r.error || 'gönderilemedi'}`);
          continue;
        }
        const sonuclar: any[] = Array.isArray(r.results) ? r.results : [];
        if (!sonuclar.length) bulunamadi++;
        for (const x of sonuclar) {
          if (x.status === 'SENT') gitti++;
          else if (x.status === 'FAILED') {
            hatali++;
            notlar.push(`${ad}: ${sebepMetni(x.error) || 'gönderilemedi'}`);
          }
        }
      }
      const unvan = s.satir.unvan;
      if (gitti && !hatali) toast.success(`${unvan}: ${gitti} gönderim iletildi`);
      else if (gitti) toast.warning(`${unvan}: ${gitti} iletildi, ${hatali} yine iletilemedi — ${notlar.join(' · ')}`, { duration: 9000 });
      else if (hatali || notlar.length) toast.error(`${unvan}: iletilemedi — ${notlar.join(' · ')}`, { duration: 9000 });
      else if (bulunamadi) toast.info(`${unvan}: yeniden gönderilecek belge bulunamadı (daha önce iletilmiş belge tekrar gönderilmez)`);
      yenile();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Yeniden denenemedi');
    } finally {
      setSatirDeneniyor(null);
    }
  };

  const yenidenDeneBasligi = ozet.yenidenDenenecek
    ? 'Yalnızca BAŞARISIZ gönderimleri (Vergi / SGK / e-Tebligat) yeniden dener. Daha önce iletilmiş belge tekrar gönderilmez; kapalı kategori gönderilmez.'
    : ozet.odemeHatali
      ? 'Buradan yeniden denenecek gönderim yok. Ödeme Listesi hataları Aylık Ödeme Listesi ekranından gönderilir.'
      : 'Bu ay yeniden denenecek başarısız gönderim yok.';

  return (
    <div className="mx-auto max-w-6xl space-y-3 pb-12">
      {/* Başlık */}
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-4"
        style={{
          background: 'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }} />
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={{ background: GOLD }} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>Ofis</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid shrink-0 place-items-center rounded-xl" style={{ width: 46, height: 46, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, boxShadow: '0 8px 22px rgba(212,184,118,0.30)' }}>
              <ClipboardList size={24} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 600, color: METIN, letterSpacing: '-.03em', lineHeight: 1.05 }}>
                İletim Raporu
              </h1>
              <p className="mt-2 text-[13px] font-semibold" style={{ color: 'rgba(250,250,249,0.48)' }}>
                Mükellefe gönderilen belgelerin dökümü — kim aldı, kim almadı, kime hiç gönderilmedi.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* Ay gezinme: ‹ › + ay seçici + Bu ay */}
              <div className="inline-flex items-center rounded-[10px]" style={{ border: `1px solid ${KENAR_NOTR}`, background: 'rgba(255,255,255,0.03)' }} role="group" aria-label="Ay seçimi">
                <button type="button" onClick={() => ayDegistir(ayKaydir(month, -1))} title="Önceki ay" aria-label="Önceki ay" className="flex h-9 w-8 items-center justify-center rounded-l-[10px] transition hover:bg-white/[0.06]" style={{ color: IKINCIL }}>
                  <ChevronLeft size={15} />
                </button>
                <input
                  type="month"
                  value={month}
                  aria-label="Ay"
                  onChange={(e) => e.target.value && ayDegistir(e.target.value)}
                  onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* tarayıcı desteklemiyorsa elle yazılır */ } }}
                  className="h-9 cursor-pointer bg-transparent px-1 text-center text-[12.5px] font-semibold outline-none [&::-webkit-calendar-picker-indicator]:hidden"
                  style={{ color: METIN, colorScheme: 'dark', width: 112 }}
                  title={ayAdi(month)}
                />
                <button type="button" onClick={() => ayDegistir(ayKaydir(month, 1))} title="Sonraki ay" aria-label="Sonraki ay" className="flex h-9 w-8 items-center justify-center transition hover:bg-white/[0.06]" style={{ color: IKINCIL }}>
                  <ChevronRight size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => ayDegistir(buAy())}
                  disabled={buAyMi}
                  title={buAyMi ? 'Bu ay görüntüleniyor' : 'Bu aya dön'}
                  className="inline-flex h-9 items-center gap-1 rounded-r-[10px] px-2.5 text-[11.5px] font-semibold transition hover:bg-white/[0.06] disabled:opacity-45"
                  style={{ color: buAyMi ? IKINCIL : METIN, borderLeft: `1px solid ${KENAR_NOTR}` }}
                >
                  <CalendarDays size={12} /> Bu ay
                </button>
              </div>

              <GriDugme onClick={topluYenidenDene} yukleniyor={topluDeneniyor} disabled={ozet.yenidenDenenecek === 0 || raporQ.isLoading} title={yenidenDeneBasligi}>
                Başarısızları yeniden dene ({ozet.yenidenDenenecek})
              </GriDugme>
            </div>
            <p className="max-w-[520px] text-right text-[11px] leading-4" style={{ color: SONUK }}>
              Rapor, Akıllı Bildirim ve Aylık Ödeme Listesi gönderimlerini kapsar; test modu gönderimleri gerçek sayılmaz.
            </p>
          </div>
        </div>
      </header>

      {/* Tek satır özet — hap; tıklayınca süzer */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5 px-1" role="group" aria-label="Ay özeti" data-testid="ozet-satiri">
        <Hap sayi={ozet.mukellef} secili={suzgec === 'tumu'} onClick={() => setSuzgec('tumu')} title="Tüm mükellefleri göster" yukleniyor={raporQ.isLoading}>mükellef</Hap>
        <Nokta />
        <Hap sayi={ozet.iletildi} secili={suzgec === 'iletilen'} onClick={() => setSuzgec(suzgec === 'iletilen' ? 'tumu' : 'iletilen')} title="Belgeleri mükellefe iletilenler" yukleniyor={raporQ.isLoading} renk={YESIL_YUMUSAK}>iletildi</Hap>
        <Nokta />
        <Hap sayi={ozet.hata} secili={suzgec === 'hata'} onClick={() => setSuzgec(suzgec === 'hata' ? 'tumu' : 'hata')} title="Denendi ama iletilemeyenler (tamamen ya da kısmen)" yukleniyor={raporQ.isLoading} renk={KIRMIZI_YUMUSAK}>iletilemedi</Hap>
        <Nokta />
        <Hap sayi={ozet.bekliyor} secili={suzgec === 'bekliyor'} onClick={() => setSuzgec(suzgec === 'bekliyor' ? 'tumu' : 'bekliyor')} title="Belgesi var ama gönderim hiç yapılmayanlar" yukleniyor={raporQ.isLoading}>hiç gönderilmedi</Hap>
        {(raporQ.isLoading || ozet.test > 0) && (
          <>
            <Nokta />
            <Hap sayi={ozet.test} secili={suzgec === 'test'} onClick={() => setSuzgec(suzgec === 'test' ? 'tumu' : 'test')} title="Yalnız test alıcısına gidenler — mükellef almadı" yukleniyor={raporQ.isLoading}>yalnız test</Hap>
          </>
        )}
        {(raporQ.isLoading || ozet.yok > 0) && (
          <>
            <Nokta />
            <Hap sayi={ozet.yok} secili={suzgec === 'yok'} onClick={() => setSuzgec(suzgec === 'yok' ? 'tumu' : 'yok')} title="Bu ay hiçbir kategoride belgesi olmayanlar" yukleniyor={raporQ.isLoading}>belge yok</Hap>
          </>
        )}
        {(raporQ.isLoading || ozet.kapaliKalem > 0) && (
          <>
            <Ayrac />
            <Hap sayi={ozet.kapaliKalem} secili={suzgec === 'kapali'} onClick={() => setSuzgec(suzgec === 'kapali' ? 'tumu' : 'kapali')} title="Kategorisi kapalı olduğu için gönderilmeyen belge (kalem) sayısı" yukleniyor={raporQ.isLoading}>kalem kategori kapalı</Hap>
          </>
        )}
      </div>

      {/* Uyarı: kategori kapalı — tekrar eden sebep satırlarda değil burada */}
      {kapali && (
        <div className="rounded-xl px-4 py-2.5 text-[12.5px] leading-5" style={{ border: `1px solid ${KENAR_NOTR}`, background: 'rgba(255,255,255,0.02)', color: IKINCIL }} data-testid="kapali-uyari">
          <b style={{ color: METIN }}>{kapali.adlar.join(' ve ')} kategorisi</b> Ayarlar → Akıllı Bildirim&apos;de <b style={{ color: METIN }}>KAPALI</b>; bu ay{' '}
          <b style={{ color: METIN }}>{kapali.adet} gönderim</b> bu yüzden yapılmadı. Tabloda bu hücreler &quot;Kategori kapalı&quot; yazar.{' '}
          <Link href="/panel/ayarlar/akilli-bildirim" className="font-semibold underline decoration-dotted underline-offset-4 hover:opacity-80" style={{ color: METIN }}>
            Ayarları aç
          </Link>
        </div>
      )}

      {/* Uyarı: test modu — "iletildi" sanılan gönderimler mükellefe ulaşmıyor */}
      {test && (
        <div className="rounded-xl px-4 py-2.5 text-[12.5px] leading-5" style={{ border: `1px solid ${AMBER_KENAR}`, background: AMBER_ZEMIN, color: AMBER }} data-testid="test-uyari">
          {test.adlar.length ? (
            <>
              <b>Test modu açık</b> ({test.adlar.join(', ')}): gönderimler mükellefe değil test alıcısına gidiyor.{' '}
            </>
          ) : null}
          {test.adet > 0 ? <>Bu ay <b>{test.adet} gönderim</b> test alıcısına gitti; tabloda &quot;Test gönderimi&quot; yazar ve iletildi sayılmaz. </> : null}
          <Link href="/panel/ayarlar/akilli-bildirim" className="font-semibold underline decoration-dotted underline-offset-4 hover:opacity-80">
            Ayarlar
          </Link>
        </div>
      )}

      {/* Tablo kartı */}
      <section className="p-3" style={KART}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1" role="group" aria-label="Süzgeç">
            {SUZGEC_ANA.map((s) => (
              <GriDugme key={s.key} kucuk onClick={() => setSuzgec(s.key)} aktif={suzgec === s.key} title={s.key === 'sorunlu' ? 'İletilemeyen, hiç gönderilmeyen, yalnız test giden ve kategorisi kapalı olanlar' : s.key === 'iletilen' ? 'Belgeleri mükellefe iletilenler' : 'Tüm mükellefler'}>
                {s.ad}
              </GriDugme>
            ))}
          </div>
          <div className="relative w-full sm:w-[260px]">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: IKINCIL }} />
            <input
              type="search"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Mükellef ara"
              aria-label="Mükellef ara"
              className="h-8 w-full text-[12px] outline-none [&::-webkit-search-cancel-button]:hidden"
              style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${KENAR_NOTR}`, color: METIN, borderRadius: 999, paddingLeft: 30, paddingRight: arama ? 28 : 12, WebkitAppearance: 'none', appearance: 'none' }}
            />
            {arama && (
              <button type="button" onClick={() => setArama('')} title="Aramayı temizle" aria-label="Aramayı temizle" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-white/[0.06]" style={{ color: IKINCIL }}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${KENAR_NOTR}`, background: 'rgba(255,255,255,0.02)' }}>
          {/* Mükellef ve Son durum sabit; dört kategori sütunu kalan genişliği eşit paylaşır (dar ekranda kartın içinde yatay kaydırma) */}
          <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 920 }} data-testid="iletim-tablosu">
            <colgroup>
              <col style={{ width: 200 }} />
              {KATEGORILER.map((k) => <col key={k.key} />)}
              <col style={{ width: 216 }} />
            </colgroup>
            <thead>
              <tr style={{ background: GRUP_ZEMIN }}>
                <th style={HUCRE_BASLIK}>Mükellef</th>
                {KATEGORILER.map((k) => <th key={k.key} style={HUCRE_BASLIK}>{k.ad}</th>)}
                <th style={HUCRE_BASLIK}>Son durum</th>
              </tr>
            </thead>
            <tbody>
              {raporQ.isLoading ? (
                <tr>
                  <td colSpan={KATEGORILER.length + 2} style={HUCRE}>
                    <div className="flex items-center gap-2 px-1 py-5 text-[12.5px]" style={{ color: IKINCIL }}>
                      <Loader2 size={14} className="animate-spin" /> Yükleniyor…
                    </div>
                  </td>
                </tr>
              ) : gorunen.length === 0 ? (
                <tr>
                  <td colSpan={KATEGORILER.length + 2} style={HUCRE}>
                    <div className="px-1 py-5 text-[12.5px]" style={{ color: IKINCIL }}>
                      {tumSatirlar.length === 0
                        ? 'Bu ay ne gönderim kaydı ne de gönderilecek belge var. Gönderimler Ayarlar → Akıllı Bildirim\'den yönetilir.'
                        : suzgec === 'sorunlu'
                          ? 'Sorunlu gönderim yok — bu ayki belgelerin tamamı iletilmiş.'
                          : 'Süzgece uyan mükellef yok.'}
                    </div>
                  </td>
                </tr>
              ) : (
                gorunen.map((s) => (
                  <tr key={s.satir.taxpayerId} data-durum={s.durum} className="transition-colors hover:bg-white/[0.03]">
                    <td style={{ ...HUCRE, minWidth: 0 }}>
                      <span className="block truncate text-[13px] font-medium leading-5" style={{ color: METIN }} title={s.satir.unvan}>
                        {s.satir.unvan}
                      </span>
                    </td>
                    {KATEGORILER.map((k) => (
                      <td key={k.key} style={HUCRE}>
                        <HucreYazisi g={s.hucreler[k.key]} />
                      </td>
                    ))}
                    <td style={HUCRE}>
                      <SonDurum s={s} deneniyor={satirDeneniyor === s.satir.taxpayerId} baskaDeneniyor={satirDeneniyor !== null || topluDeneniyor} onDene={() => satirYenidenDene(s)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 px-1 text-[11px]" style={{ color: SONUK }}>
          Sorunlu mükellefler üstte listelenir. Hücrenin üzerine gelince ayrıntı ve kanal kanal sonuç görünür.
        </p>
      </section>
    </div>
  );
}

// ─── küçük parçalar ─────────────────────────────────────────────────────────

/** Hücre: üst satır durum, alt satır ayrıntı — düz yazı, renk yalnız yazıda. */
function HucreYazisi({ g }: { g: HucreGorunumu }) {
  const ustRenk =
    g.durum === 'iletildi' ? YESIL_YUMUSAK
    : g.durum === 'hata' || g.durum === 'kismen' ? KIRMIZI_YUMUSAK
    : g.durum === 'gonderilmedi' || g.durum === 'sirada' ? METIN
    : SONUK;
  const altRenk = g.durum === 'kapali' || g.durum === 'kapsamDisi' || g.durum === 'test' || g.durum === 'yok' ? SONUK : IKINCIL;
  return (
    <div title={g.ipucu} className="flex min-h-[34px] flex-col justify-center" style={{ lineHeight: '17px' }}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
        {/* Dar sütunda kesilmesin, iki satıra sarsın ("İletildi · 12.09 14:20") */}
        <span className="line-clamp-2 break-words text-[12.5px] font-medium" style={{ color: ustRenk }}>{g.ust}</span>
        {g.testEtiketi && <Cip title="Test modu gönderimi — mükellef almadı">test</Cip>}
      </div>
      {g.alt && <div className="line-clamp-2 break-words text-[11px] leading-[15px]" style={{ color: altRenk }}>{g.alt}</div>}
    </div>
  );
}

/** Son durum: tek cümle + gerekiyorsa "Yeniden dene" / Aylık Ödeme Listesi bağlantısı */
function SonDurum({ s, deneniyor, baskaDeneniyor, onDene }: { s: SatirGorunumu; deneniyor: boolean; baskaDeneniyor: boolean; onDene: () => void }) {
  const renk = s.durum === 'hata' ? KIRMIZI_YUMUSAK : s.durum === 'iletildi' ? YESIL_YUMUSAK : s.durum === 'bekliyor' ? METIN : IKINCIL;
  return (
    <div className="flex min-h-[34px] flex-col justify-center gap-0.5">
      <span title={s.cumleTam} className="line-clamp-2 text-[12px] leading-4" style={{ color: renk }}>{s.cumle}</span>
      {(s.yenidenDenenecek.length > 0 || s.odemeHatali) && (
        <span className="flex flex-wrap items-center gap-x-2 text-[11px] leading-4">
          {s.yenidenDenenecek.length > 0 && (
            <button
              type="button"
              onClick={onDene}
              disabled={baskaDeneniyor}
              title="Bu mükellefin başarısız kategorilerini yeniden dener; daha önce iletilmiş belge tekrar gönderilmez"
              className="inline-flex items-center gap-1 font-semibold underline decoration-dotted underline-offset-4 transition hover:opacity-80 disabled:opacity-40"
              style={{ color: METIN }}
            >
              {deneniyor && <Loader2 size={11} className="animate-spin" />}
              Yeniden dene
            </button>
          )}
          {s.odemeHatali && (
            <Link href="/panel/aylik-odeme" title="Ödeme Listesi hataları buradan denenmez; Aylık Ödeme Listesi ekranından gönderilir" className="underline decoration-dotted underline-offset-4 hover:opacity-80" style={{ color: IKINCIL }}>
              Ödeme listesini oradan gönder
            </Link>
          )}
        </span>
      )}
    </div>
  );
}

function Ayrac() {
  return <span className="mx-1 h-4 w-px flex-shrink-0" style={{ background: KENAR_NOTR }} aria-hidden="true" />;
}
function Nokta() {
  return <span aria-hidden="true" className="px-0.5" style={{ color: 'rgba(250,250,249,0.3)' }}>·</span>;
}

/** Tıklanabilir sayaç hapı — seçili: ince altın kenar (dolgu YOK); sayı: nötr / yeşil / kırmızı yazı; 0: soluk. */
function Hap({ children, sayi, secili, onClick, title, yukleniyor, renk }: { children: ReactNode; sayi: number; secili: boolean; onClick: () => void; title: string; yukleniyor: boolean; renk?: string }) {
  const var_ = sayi > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={secili}
      title={title}
      className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px"
      style={
        secili
          ? { background: 'rgba(255,255,255,0.05)', border: `1px solid ${GOLD}88`, color: METIN }
          : { background: 'transparent', border: `1px solid ${KENAR_NOTR}`, color: var_ ? renk || METIN : IKINCIL }
      }
    >
      {yukleniyor ? (
        <span className="inline-block h-3 w-5 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.12)' }} />
      ) : (
        <span className="tabular-nums">{sayi}</span>
      )}
      {children}
    </button>
  );
}
