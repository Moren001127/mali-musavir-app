'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X as IconX } from 'lucide-react';
import {
  beyannameTakipApi,
  eDefterDonemCipleri,
  type DonemTuru,
  type DvdSorguIsi,
  type EDefterAy,
  type EDefterBelge,
  type EDefterDonem,
  type EDefterMukellef,
} from '@/lib/beyanname-takip';
import './edefter-detay.css';

/**
 * E-Defter Detayı penceresi (2026-09-22) — Hattat düzeni: üstte bilgi notu + iki bağlantı, Verilmemiş / Verilmiş
 * sekmeleri, her mükellef bir blok (ünvan + rozetler · Dönem · Son Yükleme · Verildi/Verilmedi) ve altında kenarlıklı
 * tablo (Belge · Dönem · İşlem Numarası · GİB Yükleme Zamanı · Durum). "Sorgula" Dijital Vergi Dairesi e-Defter
 * sorgusunu başlatır, 5 sn'de bir koşu durumunu izler, bitince veriyi yeniler. Beyaz tema; renk yalnız anlam taşır
 * (çivit vurgu, yeşil yalnız "Verildi", kırmızı yalnız hata).
 */

export type EDefterSekme = 'verilmemis' | 'verilmis';

const AYLAR_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** "2026-09" → "Eylül 2026" */
function ayEtiketi(donem: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(donem);
  return m ? `${AYLAR_TR[parseInt(m[2], 10) - 1] || m[2]} ${m[1]}` : donem;
}

/** "2026-09-14" → "14.09.2026" */
function gunBicimle(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** ISO zaman → "14.09.2026 14:42" (yerel saat) */
function zamanBicimle(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const BELGE_SIRASI: Record<string, number> = { KB: 0, YB: 1, Y: 2, K: 3 };
const BELGE_ETIKETLERI: Record<string, string> = { KB: 'Kebir Beratı', YB: 'Yevmiye Beratı', Y: 'Yevmiye Defteri', K: 'Kebir Defteri' };

type TabloSatiri = {
  anahtar: string;
  belge: string;
  ay: string;
  islemOid: string | null;
  alinmaZamani: string | null;
  durum: 'verildi' | 'hatali' | 'verilmedi';
  aciklama: string | null;
};

/** Bir ayın satırları: beklenen KB + YB (yoksa "Verilmedi" satırı) + gelen Y/K paketleri. */
function aySatirlari(ay: EDefterAy): TabloSatiri[] {
  const satirlar: TabloSatiri[] = [];
  const bul = (tur: string) => ay.belgeler.filter((b) => b.belgeTuru === tur);
  const belgeSatiri = (b: EDefterBelge, i: number): TabloSatiri => ({
    anahtar: `${ay.ay}-${b.belgeTuru}-${b.paketId || i}`,
    belge: b.etiket || BELGE_ETIKETLERI[b.belgeTuru] || b.belgeTuru,
    ay: ay.ay,
    islemOid: b.islemOid,
    alinmaZamani: b.alinmaZamani,
    durum: b.durumKodu === 0 ? 'verildi' : b.durumKodu === null || b.durumKodu === undefined ? 'verilmedi' : 'hatali',
    aciklama: b.durumAciklama,
  });
  for (const tur of ['KB', 'YB']) {
    const liste = bul(tur);
    if (liste.length === 0) {
      satirlar.push({ anahtar: `${ay.ay}-${tur}-yok`, belge: BELGE_ETIKETLERI[tur], ay: ay.ay, islemOid: null, alinmaZamani: null, durum: 'verilmedi', aciklama: null });
    } else {
      liste.forEach((b, i) => satirlar.push(belgeSatiri(b, i)));
    }
  }
  const digerleri = ay.belgeler
    .filter((b) => b.belgeTuru !== 'KB' && b.belgeTuru !== 'YB')
    .sort((a, b) => (BELGE_SIRASI[a.belgeTuru] ?? 9) - (BELGE_SIRASI[b.belgeTuru] ?? 9));
  digerleri.forEach((b, i) => satirlar.push(belgeSatiri(b, i)));
  return satirlar;
}

const DURUM_YAZISI: Record<TabloSatiri['durum'], string> = { verildi: 'Verildi', hatali: 'Hatalı', verilmedi: 'Verilmedi' };

const bitmisMi = (j: DvdSorguIsi) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled';
const IZLEME_SINIRI_MS = 20 * 60 * 1000;

type Kosu = {
  isIdleri: string[];
  baslatilan: number;
  atlanan: number;
  atlanmaSebebi: string | null;
  baslangic: number;
  tamamlandi: boolean;
};

export function EDefterDetayPenceresi({
  donem,
  donemTuru,
  sekme: ilkSekme = 'verilmemis',
  onClose,
}: {
  donem: string;
  donemTuru: DonemTuru;
  sekme?: EDefterSekme;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [sekme, setSekme] = useState<EDefterSekme>(ilkSekme);
  const qc = useQueryClient();

  const sorgu = useQuery({
    queryKey: ['edefter-detay', donem, donemTuru],
    queryFn: () => beyannameTakipApi.edefterDetay(donem, donemTuru),
    staleTime: 60 * 1000,
  });
  const veri = sorgu.data;
  const mukellefler = useMemo(() => veri?.mukellefler ?? [], [veri]);
  const verilmemis = useMemo(() => mukellefler.filter((m) => !m.verildi), [mukellefler]);
  const verilmis = useMemo(() => mukellefler.filter((m) => m.verildi), [mukellefler]);
  const liste = sekme === 'verilmemis' ? verilmemis : verilmis;

  // Dönem çipleri (Aylık Mayıs 2026 · 3 Aylık Nis–Haz 2026)
  const donemCipleri = useMemo(() => {
    const anahtarlar = new Set<string>();
    for (const m of mukellefler) for (const d of m.donemler) anahtarlar.add(d.donem);
    return eDefterDonemCipleri(Array.from(anahtarlar));
  }, [mukellefler]);

  // ── Sorgula: DVD e-Defter sorgusu + 5 sn'de bir koşu izleme ──
  const [kosu, setKosu] = useState<Kosu | null>(null);
  const [baslatiliyor, setBaslatiliyor] = useState(false);
  const [sorguHatasi, setSorguHatasi] = useState<string | null>(null);
  const izleniyor = !!kosu && !kosu.tamamlandi;
  const isler = useQuery({
    queryKey: ['dvd-sorgu-isleri'],
    queryFn: () => beyannameTakipApi.dvdSorguIsleri(50),
    enabled: izleniyor,
    refetchInterval: izleniyor ? 5000 : false,
  });

  const ilerleme = useMemo(() => {
    if (!kosu) return null;
    const harita = new Map<string, DvdSorguIsi>();
    for (const j of isler.data || []) harita.set(j.id, j);
    const takip = kosu.isIdleri.map((id) => harita.get(id)).filter((j): j is DvdSorguIsi => !!j);
    const biten = takip.filter(bitmisMi).length;
    const hatali = takip.filter((j) => j.status === 'failed').length;
    const suren = takip.find((j) => j.status === 'running');
    const mesaj = suren?.payload?.progress?.message || null;
    const bitti = kosu.isIdleri.length === 0 || biten >= kosu.isIdleri.length;
    const sureAsimi = !bitti && Date.now() - kosu.baslangic > IZLEME_SINIRI_MS;
    return { toplam: kosu.isIdleri.length, biten, hatali, mesaj, bitti, sureAsimi };
  }, [kosu, isler.data]);

  useEffect(() => {
    if (!kosu || kosu.tamamlandi || !ilerleme) return;
    if (ilerleme.bitti || ilerleme.sureAsimi) {
      setKosu({ ...kosu, tamamlandi: true });
      qc.invalidateQueries({ queryKey: ['edefter-detay'] });
      qc.invalidateQueries({ queryKey: ['beyanname-ozet'] });
      qc.invalidateQueries({ queryKey: ['beyanname-detay'] });
    }
  }, [kosu, ilerleme, qc]);

  // Sorgulanacak aylar: aralık seçildiyse başlangıç–bitiş (en çok 12 ay); yoksa EKRANDAKİ dönemlerin ayları.
  //   (Arka uç ay verilmezse bugüne göre güncel dönemi seçer; Ekim'e alınmış ekranda Haziran sorgulanmıyordu.)
  const [aralik, setAralik] = useState<{ bas: string; bit: string }>({ bas: '', bit: '' });
  const ekranAylari = useMemo(() => {
    const aylar = new Set<string>();
    for (const m of mukellefler) for (const d of m.donemler) for (const a of d.aylar) aylar.add(a.ay);
    return Array.from(aylar).sort();
  }, [mukellefler]);
  const aralikAylari = useMemo(() => ayAraligi(aralik.bas, aralik.bit), [aralik]);
  const aralikHatasi = aralik.bas && aralik.bit && aralikAylari.length === 0 ? 'Bitiş, başlangıçtan önce olamaz' : aralikAylari.length > 12 ? 'En fazla 12 ay' : null;
  const sorgulanacakAylar = aralikAylari.length > 0 && !aralikHatasi ? aralikAylari : ekranAylari;

  // Mükellef seçimi: boş = listedeki tüm e-Defter mükellefleri; seçiliyse yalnız o mükellef sorgulanır.
  const [seciliMukellef, setSeciliMukellef] = useState('');
  const sorgula = async () => {
    const ids = seciliMukellef ? mukellefler.filter((m) => m.taxpayerId === seciliMukellef).map((m) => m.taxpayerId) : mukellefler.map((m) => m.taxpayerId);
    if (ids.length === 0 || baslatiliyor || aralikHatasi) return;
    setBaslatiliyor(true);
    setSorguHatasi(null);
    try {
      const yanit = await beyannameTakipApi.dvdSorguBaslat(ids, sorgulanacakAylar);
      const created = yanit?.created || [];
      const skipped = yanit?.skipped || [];
      const sebepler = Array.from(new Set(skipped.map((s) => s.reason).filter(Boolean)));
      setKosu({
        isIdleri: created.map((c) => c.id),
        baslatilan: created.length,
        atlanan: skipped.length,
        atlanmaSebebi: sebepler.length ? sebepler.join(' · ') : null,
        baslangic: Date.now(),
        tamamlandi: created.length === 0,
      });
    } catch (e: any) {
      setSorguHatasi(e?.response?.data?.message || e?.message || 'Sorgu başlatılamadı.');
    } finally {
      setBaslatiliyor(false);
    }
  };

  // ── Listeyi İndir (CSV; xlsx paketi yok) ──
  const listeyiIndir = () => {
    const hucre = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const baslik = ['Sıra', 'Mükellef', 'VKN/TCKN', 'Vergi Türü', 'Tercih', 'Dönem', 'Son Yükleme Günü', 'Dönem Durumu', 'Belge', 'Belge Dönemi', 'İşlem Numarası', 'GİB Yükleme Zamanı', 'Belge Durumu'];
    const satirlar: unknown[][] = [];
    liste.forEach((m, i) => {
      for (const d of m.donemler) {
        for (const ay of d.aylar) {
          for (const s of aySatirlari(ay)) {
            satirlar.push([
              i + 1, m.ad, m.taxNumber || '', m.tipEtiketi, m.tercihEtiketi, d.etiket, gunBicimle(d.sonGun) + (d.uzatildi ? ' (uzatıldı)' : ''),
              d.verildi ? 'Verildi' : 'Verilmedi', s.belge, s.ay, s.islemOid || '', s.alinmaZamani ? zamanBicimle(s.alinmaZamani) : '',
              DURUM_YAZISI[s.durum] + (s.aciklama ? ` (${s.aciklama})` : ''),
            ]);
          }
        }
      }
    });
    const csv = [baslik, ...satirlar].map((r) => r.map(hucre).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `e-defter-${sekme}-${donem}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    setMounted(true);
    const tus = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', tus);
    return () => window.removeEventListener('keydown', tus);
  }, [onClose]);

  const donemModu = donemTuru === 'VERILME' ? 'Verilme dönemi' : 'Vergi dönemi';
  const ozet = veri?.ozet;

  const pencere = (
    <div className="edd-ortu" onClick={onClose} role="presentation">
      <div className="edd" role="dialog" aria-modal="true" aria-labelledby="edd-baslik" onClick={(e) => e.stopPropagation()}>
        <header className="edd-bas">
          <div className="edd-bas-metin">
            <p className="edd-ustbilgi">E-Defter · {donemModu}: {ayEtiketi(donem)}</p>
            <h2 id="edd-baslik" className="edd-baslik">E-Defter Detayı</h2>
            <p className="edd-altbilgi">
              {donemCipleri.length > 0 ? donemCipleri.join(' · ') : 'Bu ayda takibe düşen dönem yok'}
              {ozet ? ` — ${ozet.mukellef} mükellef · ${ozet.toplam} toplam · ${ozet.verilen} verilen · ${ozet.kalan} kalan` : ''}
            </p>
          </div>
          <div className="edd-eylemler">
            <button type="button" className="edd-dugme edd-dugme--birincil" onClick={sorgula} disabled={baslatiliyor || izleniyor || mukellefler.length === 0 || !!aralikHatasi} title={sorgulanacakAylar.length ? `${seciliMukellef ? (mukellefler.find((m) => m.taxpayerId === seciliMukellef)?.ad || 'Seçili mükellef') : 'Listedeki e-Defter mükellefleri'} için ${sorgulanacakAylar.map(ayEtiketi).join(', ')} beratlarını Dijital Vergi Dairesi'nden sorgula` : 'Sorgulanacak ay yok'}>
              {baslatiliyor ? 'Başlatılıyor…' : izleniyor ? 'Sorgu sürüyor…' : 'Sorgula'}
            </button>
            <button type="button" className="edd-dugme" onClick={listeyiIndir} disabled={liste.length === 0}>Listeyi İndir</button>
            <button type="button" className="edd-kapat" onClick={onClose} aria-label="Pencereyi kapat" title="Kapat"><IconX size={18} aria-hidden="true" /></button>
          </div>
        </header>

        <div className="edd-not" role="note">
          <p>3 Aylık mükellefler yalnızca çeyrek son yükleme aylarında sorgulanır: Haziran, Eylül, Aralık (4. çeyrek: Şahıs Nisan · Firma Mayıs).</p>
          <p>Gece sorgusu güncel dönemi kontrol eder. <b>Sorgula</b> ekrandaki dönemi ({ekranAylari.length ? ekranAylari.map(ayEtiketi).join(', ') : '—'}) sorgular; başka dönem için başlangıç–bitiş ayı seçin (en fazla 12 ay).</p>
          <div className="edd-aralik">
            <label>Mükellef
              <select value={seciliMukellef} onChange={(e) => setSeciliMukellef(e.target.value)} aria-label="Sorgulanacak mükellef">
                <option value="">Listedeki tüm mükellefler ({mukellefler.length})</option>
                {[...mukellefler].sort((a, b) => a.ad.localeCompare(b.ad, 'tr-TR')).map((m) => (
                  <option key={m.taxpayerId} value={m.taxpayerId}>{m.ad}</option>
                ))}
              </select>
            </label>
            <label>Başlangıç <input type="month" value={aralik.bas} onChange={(e) => setAralik({ ...aralik, bas: e.target.value })} aria-label="Başlangıç dönemi" /></label>
            <label>Bitiş <input type="month" value={aralik.bit} onChange={(e) => setAralik({ ...aralik, bit: e.target.value })} aria-label="Bitiş dönemi" /></label>
            {aralikHatasi ? <span className="edd-hata">{aralikHatasi}</span> : aralikAylari.length > 0 ? <span className="edd-aralik-not">{aralikAylari.length} ay sorgulanacak</span> : null}
            {(aralik.bas || aralik.bit) && <button type="button" className="edd-dugme edd-dugme--kucuk" onClick={() => setAralik({ bas: '', bit: '' })}>Temizle</button>}
          </div>
          <div className="edd-not-baglantilar">
            <Link href="/panel/mukellefler" className="edd-dugme edd-dugme--kucuk" title="Mükellef kartı › Mükellefiyet Bilgileri › E-Defter dönemi ve başlangıç ayı">Dönem Ayarları</Link>
          </div>
        </div>

        {(kosu || sorguHatasi) && (
          <div className="edd-kosu" data-durum={sorguHatasi ? 'hata' : kosu?.tamamlandi ? 'bitti' : 'suruyor'} role="status" aria-live="polite">
            {sorguHatasi ? (
              <span>Sorgu başlatılamadı: {sorguHatasi}</span>
            ) : kosu && (
              <>
                <span>
                  <b>{kosu.baslatilan} mükellef için sorgu başlatıldı</b>
                  {kosu.atlanan > 0 && ` · ${kosu.atlanan} mükellef atlandı${kosu.atlanmaSebebi ? ` (${kosu.atlanmaSebebi})` : ''}`}
                </span>
                {ilerleme && kosu.baslatilan > 0 && (
                  <span>
                    {kosu.tamamlandi
                      ? ilerleme.sureAsimi
                        ? `İzleme durdu (${ilerleme.biten}/${ilerleme.toplam} bitti) — durumu Genel Sorgulamalar'dan kontrol edin.`
                        : `Bitti: ${ilerleme.biten - ilerleme.hatali} başarılı${ilerleme.hatali ? ` · ${ilerleme.hatali} hatalı` : ''} — liste yenilendi.`
                      : `Sürüyor: ${ilerleme.biten}/${ilerleme.toplam} bitti${ilerleme.mesaj ? ` · ${ilerleme.mesaj}` : ''}`}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        <div className="edd-sekmeler" role="tablist" aria-label="Verilme durumu">
          <button type="button" role="tab" aria-selected={sekme === 'verilmemis'} data-active={sekme === 'verilmemis' ? 'true' : undefined} onClick={() => setSekme('verilmemis')}>
            Verilmemiş <span className="edd-sayac">{verilmemis.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={sekme === 'verilmis'} data-active={sekme === 'verilmis' ? 'true' : undefined} onClick={() => setSekme('verilmis')}>
            Verilmiş <span className="edd-sayac">{verilmis.length}</span>
          </button>
        </div>

        <div className="edd-govde">
          {sorgu.isLoading && <div className="edd-bos">Yükleniyor…</div>}
          {sorgu.isError && <div className="edd-bos" role="alert">E-Defter verisi alınamadı.</div>}
          {!sorgu.isLoading && !sorgu.isError && mukellefler.length === 0 && (
            <div className="edd-bos">
              <b>Bu dönem için takibe düşen e-Defter mükellefi yok.</b>
              <span>Mükellef kartındaki E-Defter dönemi (Aylık / 3 Aylık) ve başlangıç ayı kontrol edilmeli.</span>
            </div>
          )}
          {!sorgu.isLoading && !sorgu.isError && mukellefler.length > 0 && liste.length === 0 && (
            <div className="edd-bos">{sekme === 'verilmemis' ? 'Verilmemiş e-Defter kalmadı.' : 'Bu grupta verilmiş e-Defter yok.'}</div>
          )}
          {liste.map((m) => <MukellefBlogu key={m.taxpayerId} m={m} />)}
        </div>

        <footer className="edd-alt">
          <span><b>{liste.length}</b> mükellef listeleniyor{ozet ? ` · ${ozet.mukellef} e-Defter mükellefi` : ''}</span>
          <button type="button" className="edd-dugme edd-dugme--kucuk" onClick={onClose}>Kapat</button>
        </footer>
      </div>
    </div>
  );

  return mounted ? createPortal(pencere, document.body) : null;
}

function MukellefBlogu({ m }: { m: EDefterMukellef }) {
  return (
    <article className="edd-blok" data-verildi={m.verildi ? 'true' : 'false'} aria-label={`${m.ad} e-Defter durumu`}>
      <header className="edd-blok-bas">
        <div className="edd-blok-unvan">
          <Link href={`/panel/mukellefler/${m.taxpayerId}`} className="edd-unvan" title="Mükellef kartını aç">{m.ad}</Link>
          <span className="edd-rozet edd-rozet--civit">{m.tipEtiketi}</span>
          <span className="edd-rozet">{m.tercihEtiketi}</span>
          {m.taxNumber && <span className="edd-vkn">{m.taxNumber}</span>}
        </div>
        <div className="edd-blok-donemler">
          {m.donemler.map((d) => <DonemOzeti key={d.donem} d={d} />)}
        </div>
      </header>
      <div className="edd-tablo-sarmal">
        <table className="edd-tablo">
          <thead>
            <tr>
              <th scope="col">Belge</th>
              <th scope="col">Dönem</th>
              <th scope="col">İşlem Numarası</th>
              <th scope="col">GİB Yükleme Zamanı</th>
              <th scope="col">Durum</th>
            </tr>
          </thead>
          <tbody>
            {m.donemler.flatMap((d) => d.aylar.flatMap((ay) => aySatirlari(ay))).map((s) => (
              <tr key={s.anahtar} data-durum={s.durum}>
                <td>{s.belge}</td>
                <td className="edd-num">{s.ay}</td>
                <td className="edd-num">{s.islemOid || '—'}</td>
                <td className="edd-num">{zamanBicimle(s.alinmaZamani)}</td>
                <td><span className="edd-durum" data-durum={s.durum}>{DURUM_YAZISI[s.durum]}</span>{s.aciklama && s.durum === 'hatali' && <small className="edd-aciklama"> {s.aciklama}</small>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="edd-blok-alt">
        {m.sonSorgu
          ? <>Son sorgu: {zamanBicimle(m.sonSorgu.sorguTarihi)}{m.sonSorgu.hata ? <span className="edd-hata"> · Hata: {m.sonSorgu.hata}</span> : ` · ${m.sonSorgu.paketSayisi} paket`}</>
          : 'Henüz sorgulanmadı.'}
        {m.baslangic && <span className="edd-baslangic"> · Başlangıç: {ayEtiketi(m.baslangic)}</span>}
      </p>
    </article>
  );
}

function DonemOzeti({ d }: { d: EDefterDonem }) {
  return (
    <span className="edd-donem-ozet">
      <span>Dönem: <b>{d.etiket}</b></span>
      <span>Son Yükleme: <b>{gunBicimle(d.sonGun)}</b>{d.uzatildi && <em title={d.uzatmaKaynagi || 'Sirküler uzatması'}> (uzatıldı)</em>}</span>
      <span className="edd-durum" data-durum={d.verildi ? 'verildi' : 'verilmedi'}>{d.verildi ? 'Verildi' : 'Verilmedi'}{d.elleIsaretli && <small className="edd-aciklama"> (elle işaretli)</small>}</span>
    </span>
  );
}

export default EDefterDetayPenceresi;

/** "2026-04".."2026-06" → ["2026-04","2026-05","2026-06"]; biri boşsa []; bitiş küçükse []. */
function ayAraligi(bas: string, bit: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(bas) || !/^\d{4}-\d{2}$/.test(bit)) return [];
  const [by, bm] = bas.split('-').map(Number);
  const [ey, em] = bit.split('-').map(Number);
  const basIdx = by * 12 + (bm - 1);
  const bitIdx = ey * 12 + (em - 1);
  if (bitIdx < basIdx) return [];
  const out: string[] = [];
  for (let i = basIdx; i <= bitIdx && out.length <= 13; i++) out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  return out;
}
