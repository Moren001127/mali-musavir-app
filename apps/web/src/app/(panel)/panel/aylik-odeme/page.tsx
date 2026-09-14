'use client';

// =====================================================================
// AYLIK ÖDEME LİSTESİ — Vergi & Beyanname > Aylık Ödeme Listesi
// Mükellefin o ay ödeyeceği vergi tahakkukları + SGK primleri tek cetvelde.
// WhatsApp/e-posta ile gönderim Akıllı Bildirim motorundan geçer,
// sonuç İletim Raporu'na işlenir.
//
// Düzen (2026-09-14, Muzaffer Bey'in onayladığı iyileştirmeler):
//   başlık (ay gezinme · İletim Raporu · gönder · menü) → özet hap şeridi → TEST MODU bandı →
//   eksikler paneli → [sol: mükellef listesi] [sağ: cetvel + otomatik gönderim kartı]
// Tasarım dili: Görevler ile aynı sakin palet — altın TEK vurgu, dolu renkli rozet yok, grup bantları altın tonlu.
// =====================================================================

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, FlaskConical, Inbox, ListChecks, MoreHorizontal, RefreshCw, Send, SendHorizontal, Settings2, Wallet,
} from 'lucide-react';
import {
  aylikOdemeApi, ayAdi, ayKaydir, buAy, dosyaIndir, gonderimOzeti, listeyiSuz, sekmeyeBlobYaz, yeniSekmeAc,
  type EksikSatiri, type GonderimModu, type ListeSiralama, type ListeSuzgeci,
} from '@/lib/aylik-odeme';
import { AcilirMenu, MenuAyrac, MenuBaslik, MenuSatiri } from '../gorevler/_components/AcilirMenu';
import { AltinDugme, GriDugme, AMBER, AMBER_KENAR, AMBER_ZEMIN, GOLD, GOLD_SOFT, IKINCIL, KART, KENAR_NOTR, METIN } from './_components/ortak';
import { OzetSeridi } from './_components/OzetSeridi';
import { MukellefListesi } from './_components/MukellefListesi';
import { Cetvel } from './_components/Cetvel';
import { EksiklerPaneli } from './_components/EksiklerPaneli';
import { OtomatikKart } from './_components/OtomatikKart';

/** Blob yanıtlı isteklerde hata gövdesi de Blob gelir; içindeki mesajı çıkarır. */
async function hataMesaji(e: any, varsayilan: string): Promise<string> {
  const d = e?.response?.data;
  if (d instanceof Blob) {
    try {
      const j = JSON.parse(await d.text());
      return j?.message || varsayilan;
    } catch {
      return varsayilan;
    }
  }
  return d?.message || e?.message || varsayilan;
}

/** Dosya adı için güvenli kısaltma: "Öz Ela Gıda San." → "oz-ela-gida-san" */
function dosyaSlug(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'mukellef';
}

export default function AylikOdemePage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(buAy());
  const [selected, setSelected] = useState<string | null>(null);
  const [arama, setArama] = useState('');
  const [suzgec, setSuzgec] = useState<ListeSuzgeci>('tumu');
  const [siralama, setSiralama] = useState<ListeSiralama>('ad');
  const [sending, setSending] = useState<string | null>(null);
  const [ornekGiden, setOrnekGiden] = useState<string | null>(null);
  const [indirme, setIndirme] = useState<string | null>(null);
  const [sgkYokIsleniyor, setSgkYokIsleniyor] = useState<string | null>(null);

  const listeQ = useQuery({ queryKey: ['aylik-odeme', month], queryFn: () => aylikOdemeApi.liste(month) });
  const ozetQ = useQuery({ queryKey: ['aylik-odeme-ozet', month], queryFn: () => aylikOdemeApi.ozet(month) });
  // LİSTEDE NEDEN YOK — mükellef listede görünmüyorsa hata mı, eksik belge mi olduğu; yalnız okur, gönderim yapmaz.
  const eksikQ = useQuery({ queryKey: ['aylik-odeme-eksik', month], queryFn: () => aylikOdemeApi.eksikler(month) });

  const rows = useMemo(() => listeQ.data || [], [listeQ.data]);
  const ozet = ozetQ.data;
  const eksikler: EksikSatiri[] = useMemo(() => eksikQ.data?.eksik || [], [eksikQ.data]);
  const eksikIdler = useMemo(() => new Set(eksikler.map((e) => e.taxpayerId)), [eksikler]);
  const gorunen = useMemo(() => listeyiSuz(rows, { arama, suzgec, siralama, eksikIdler }), [rows, arama, suzgec, siralama, eksikIdler]);
  // Seçili mükellef süzgeç dışında kaldıysa görünen ilk mükellef açılır.
  const active = useMemo(() => gorunen.find((r) => r.taxpayerId === selected) || gorunen[0] || null, [gorunen, selected]);
  const gonderilmemisSayisi = useMemo(
    () => (rows.length > 0 ? rows.filter((r) => gonderimOzeti(r).durum !== 'gonderildi').length : (ozet?.bekleyen || 0) + (ozet?.hatali || 0)),
    [rows, ozet],
  );
  const testMode = !!ozet?.testMode;
  const buAyMi = month === buAy();

  const ayDegistir = (m: string) => {
    setMonth(m);
    setSelected(null);
  };

  const yenile = () => {
    qc.invalidateQueries({ queryKey: ['aylik-odeme', month] });
    qc.invalidateQueries({ queryKey: ['aylik-odeme-ozet', month] });
    qc.invalidateQueries({ queryKey: ['aylik-odeme-eksik', month] });
    qc.invalidateQueries({ queryKey: ['iletim-raporu'] });
  };

  /** Gönderim — tek mükellef ya da toplu (mod: gonderilmemis | hepsi | yeniden) */
  const gonder = async (o: { taxpayerId?: string; mod?: GonderimModu }) => {
    const key = o.taxpayerId || '__TOPLU__';
    setSending(key);
    try {
      const r = await aylikOdemeApi.gonder({ month, ...o });
      const sonuc = r?.results || [];
      const ok = sonuc.filter((x) => x.status === 'SENT').length;
      const fail = sonuc.filter((x) => x.status === 'FAILED').length;
      const parca = [`${ok} gönderim başarılı`];
      if (fail) parca.push(`${fail} hata`);
      if (r?.atlanan) parca.push(`${r.atlanan} atlandı`);
      const mesaj = parca.join(', ') + (r?.testMode ? ' — TEST MODU, test alıcısına gitti' : '');
      if (fail && !ok) toast.error(mesaj);
      else toast.success(mesaj);
      yenile();
    } catch (e: any) {
      toast.error(await hataMesaji(e, 'Gönderilemedi'));
    } finally {
      setSending(null);
    }
  };

  const topluGonder = () => {
    if (gonderilmemisSayisi === 0) {
      toast.info('Gönderilmemiş mükellef yok');
      return;
    }
    if (!testMode && !confirm(`${gonderilmemisSayisi} mükellefe cetvel gönderilecek (WhatsApp/e-posta). Devam edilsin mi?`)) return;
    gonder({ mod: 'gonderilmemis' });
  };

  const hepsineYenidenGonder = () => {
    if (rows.length === 0) return;
    if (!confirm(`${rows.length} mükellefin TAMAMINA cetvel yeniden gönderilecek — daha önce gönderilenler dâhil.${testMode ? ' (TEST MODU: test alıcısına gider)' : ''}\nDevam edilsin mi?`)) return;
    gonder({ mod: 'hepsi' });
  };

  const mukellefeGonder = () => {
    if (!active) return;
    const g = gonderimOzeti(active);
    const yeniden = g.durum === 'gonderildi' || g.kismi || g.durum === 'hata';
    if (yeniden && !testMode && !confirm(`${active.unvan} için cetvel yeniden gönderilsin mi?`)) return;
    gonder({ taxpayerId: active.taxpayerId, mod: yeniden ? 'yeniden' : 'gonderilmemis' });
  };

  /** Örnek: sahibin WhatsApp'ına — mükellefe gitmez */
  const ornekGonder = async (taxpayerId?: string) => {
    const key = taxpayerId || '__GENEL__';
    setOrnekGiden(key);
    try {
      const r = await aylikOdemeApi.ornekGonder(taxpayerId ? { month, taxpayerId } : { month });
      const tel = (r?.telefonlar || []).join(', ');
      const adet = r?.mesajlar?.length;
      toast.success(`Örnek mesaj size gönderildi${tel ? ` (${tel})` : ''}${adet ? ` · ${adet} mesaj` : ''} — mükellefe gitmedi`);
    } catch (e: any) {
      toast.error(await hataMesaji(e, 'Örnek gönderilemedi'));
    } finally {
      setOrnekGiden(null);
    }
  };

  const excelIndir = async () => {
    setIndirme('excel');
    try {
      const blob = await aylikOdemeApi.excel(month);
      dosyaIndir(blob, `aylik-odeme-${month}.xlsx`);
    } catch (e: any) {
      toast.error(await hataMesaji(e, 'Excel indirilemedi'));
    } finally {
      setIndirme(null);
    }
  };

  const pdfIndir = async (taxpayerId?: string) => {
    setIndirme(taxpayerId ? 'pdf' : 'pdf-tum');
    try {
      const blob = await aylikOdemeApi.pdf(month, taxpayerId);
      const ad = taxpayerId ? `aylik-odeme-${month}-${dosyaSlug(active?.unvan || taxpayerId)}.pdf` : `aylik-odeme-${month}-tum-mukellefler.pdf`;
      dosyaIndir(blob, ad);
    } catch (e: any) {
      toast.error(await hataMesaji(e, 'PDF indirilemedi'));
    } finally {
      setIndirme(null);
    }
  };

  /** Yazdır = PDF yeni sekmede (window.print kalktı; sekme tıklama anında açılır, blob gelince adres yazılır) */
  const yazdir = async () => {
    if (!active) return;
    const w = yeniSekmeAc();
    try {
      const blob = await aylikOdemeApi.pdf(month, active.taxpayerId);
      sekmeyeBlobYaz(w, blob);
    } catch (e: any) {
      if (w && !w.closed) w.close();
      toast.error(await hataMesaji(e, 'PDF açılamadı'));
    }
  };

  const sgkYok = async (e: EksikSatiri) => {
    if (!confirm(`${e.unvan} için SGK beklentisi kaldırılsın mı?\nBu mükellef bundan sonra "SGK eksik" olarak listelenmez.`)) return;
    setSgkYokIsleniyor(e.taxpayerId);
    try {
      await aylikOdemeApi.sgkYok(e.taxpayerId);
      toast.success(`${e.unvan}: SGK beklentisi kaldırıldı`);
      qc.invalidateQueries({ queryKey: ['aylik-odeme-eksik', month] });
      qc.invalidateQueries({ queryKey: ['aylik-odeme-ozet', month] });
    } catch (err: any) {
      toast.error(await hataMesaji(err, 'Kaydedilemedi'));
    } finally {
      setSgkYokIsleniyor(null);
    }
  };

  const gonderMetni = `${testMode ? 'Test alıcısına gönder' : 'Gönderilmemişlere gönder'} (${gonderilmemisSayisi})`;

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
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>Vergi & Beyanname</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid shrink-0 place-items-center rounded-xl" style={{ width: 46, height: 46, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, boxShadow: '0 8px 22px rgba(212,184,118,0.30)' }}>
              <Wallet size={24} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 600, color: METIN, letterSpacing: '-.03em', lineHeight: 1.05 }}>
                Aylık Ödeme Listesi
              </h1>
              <p className="mt-2 text-[13px] font-semibold" style={{ color: 'rgba(250,250,249,0.48)' }}>
                Mükellefin bu ay ödeyeceği vergi tahakkukları ve SGK primleri tek cetvelde — WhatsApp/e-posta ile gönderilir, sonuç İletim Raporu&apos;na işlenir.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Ay gezinme: ‹ › + Bu ay + ay seçici */}
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
                style={{ color: buAyMi ? IKINCIL : GOLD, borderLeft: `1px solid ${KENAR_NOTR}` }}
              >
                <CalendarDays size={12} /> Bu ay
              </button>
            </div>

            <Link
              href="/panel/iletim-raporu"
              title="Gönderim sonuçları — İletim Raporu"
              className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[12.5px] font-semibold transition hover:-translate-y-px"
              style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${KENAR_NOTR}`, color: 'rgba(250,250,249,0.78)' }}
            >
              <ListChecks size={13} /> İletim Raporu
            </Link>

            <AltinDugme onClick={topluGonder} yukleniyor={sending === '__TOPLU__'} disabled={sending !== null || listeQ.isLoading} title={testMode ? 'TEST MODU: mesajlar test alıcısına gider' : 'Cetveli henüz gönderilmemiş mükelleflere gönder'}>
              <Send size={14} /> {gonderMetni}
            </AltinDugme>

            {/* Diğer işlemler menüsü */}
            <AcilirMenu
              genislik={250}
              tetik={({ ref, ac, acik }) => (
                <GriDugme refDis={ref} onClick={ac} aktif={acik} ariaExpanded={acik} title="Diğer işlemler" className="px-2.5">
                  <MoreHorizontal size={15} />
                  <ChevronDown size={11} style={{ opacity: 0.7 }} />
                </GriDugme>
              )}
            >
              {(kapat) => (
                <div className="py-1">
                  <MenuBaslik>Gönderim</MenuBaslik>
                  <MenuSatiri ikon={<RefreshCw size={13} />} disabled={rows.length === 0 || sending !== null} onClick={() => { kapat(); hepsineYenidenGonder(); }}>
                    Hepsine yeniden gönder
                  </MenuSatiri>
                  <MenuSatiri ikon={<SendHorizontal size={13} />} disabled={ornekGiden !== null} title="Mükellefe gitmez — örnek mesaj sizin WhatsApp'ınıza gelir" onClick={() => { kapat(); ornekGonder(active?.taxpayerId); }}>
                    Şablonu bana gönder
                  </MenuSatiri>
                  <MenuAyrac />
                  <MenuBaslik>Dışa aktar</MenuBaslik>
                  <MenuSatiri ikon={<FileSpreadsheet size={13} />} disabled={indirme !== null} onClick={() => { kapat(); excelIndir(); }}>
                    Excel ({ayAdi(month)})
                  </MenuSatiri>
                  <MenuSatiri ikon={<FileDown size={13} />} disabled={indirme !== null || rows.length === 0} onClick={() => { kapat(); pdfIndir(); }}>
                    Tüm mükellefler PDF
                  </MenuSatiri>
                  <MenuAyrac />
                  <Link href="/panel/ayarlar/akilli-bildirim" onClick={kapat} className="flex w-full items-center gap-2.5 px-3 py-2 text-[12.5px] font-medium transition hover:bg-white/[0.05]" style={{ color: 'rgba(250,250,249,0.85)' }}>
                    <span className="flex w-4 justify-center" style={{ color: IKINCIL }}><Settings2 size={13} /></span>
                    Akıllı Bildirim ayarları
                  </Link>
                </div>
              )}
            </AcilirMenu>
          </div>
        </div>
      </header>

      {/* Özet hap şeridi — tıklanınca sol listeyi süzer */}
      <OzetSeridi ozet={ozet} aktif={suzgec} onSec={setSuzgec} />

      {/* TEST MODU bandı */}
      {testMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-[12.5px]" style={{ background: AMBER_ZEMIN, border: `1px solid ${AMBER_KENAR}`, color: METIN }} role="status" data-testid="test-bandi">
          <FlaskConical size={14} style={{ color: AMBER }} />
          <span>
            <b style={{ color: AMBER }}>TEST MODU açık</b> — gönderimler mükellefe değil test alıcısına gider
            {ozet?.testPhone || ozet?.testEmail ? ` (${[ozet?.testPhone, ozet?.testEmail].filter(Boolean).join(', ')})` : ''}.
          </span>
          <Link href="/panel/ayarlar/akilli-bildirim" className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold hover:underline" style={{ color: AMBER }}>
            Ayarlar → Akıllı Bildirim <ArrowRight size={12} />
          </Link>
        </div>
      )}

      {/* Listede neden yok */}
      <EksiklerPaneli eksikler={eksikler} onSgkYok={sgkYok} sgkYokIsleniyor={sgkYokIsleniyor} />

      {/* İçerik: sol liste + sağ cetvel */}
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <MukellefListesi
          rows={rows}
          seciliId={active?.taxpayerId || null}
          onSec={setSelected}
          arama={arama}
          onArama={setArama}
          suzgec={suzgec}
          onSuzgec={setSuzgec}
          siralama={siralama}
          onSiralama={setSiralama}
          eksikIdler={eksikIdler}
          kanallar={ozet?.kanallar || null}
          yukleniyor={listeQ.isLoading}
        />
        <div className="min-w-0 space-y-4">
          {listeQ.isLoading ? (
            <div className="p-8 text-[13px]" style={{ ...KART, color: IKINCIL }}>Yükleniyor…</div>
          ) : listeQ.isError ? (
            <div className="p-8 text-[13px]" style={{ ...KART, color: IKINCIL }}>
              Liste alınamadı.{' '}
              <button type="button" onClick={yenile} className="font-semibold hover:underline" style={{ color: GOLD }}>Yeniden dene</button>
            </div>
          ) : active ? (
            <Cetvel
              r={active}
              ozet={ozet}
              gonderiliyor={sending === active.taxpayerId}
              ornekGonderiliyor={ornekGiden === active.taxpayerId}
              pdfIniyor={indirme === 'pdf'}
              onGonder={mukellefeGonder}
              onOrnekGonder={() => ornekGonder(active.taxpayerId)}
              onPdf={() => pdfIndir(active.taxpayerId)}
              onYazdir={yazdir}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-[13px]" style={{ ...KART, color: IKINCIL }}>
              <Inbox size={22} style={{ color: 'rgba(250,250,249,0.3)' }} />
              {rows.length === 0
                ? `${ayAdi(month)} için tahakkuk verisi bulunamadı. Tahakkuklar gece otomasyonuyla çekildikçe burada listelenir.`
                : 'Süzgece uyan mükellef yok.'}
            </div>
          )}
          <OtomatikKart baslangic={ozet?.otomatik || null} />
        </div>
      </div>
    </div>
  );
}
