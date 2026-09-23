'use client';

/**
 * BELGE TARAYICI (web) — telefon tarayıcısından fiş/fatura gönderme (2026-09-23, Muzaffer Bey).
 *
 * NEDEN: Android'de APK var (com.moren.tarayici); iPhone'a APK kurulamıyor (Apple Developer hesabı
 *   henüz yok). Personelin iPhone'u Safari → Paylaş → "Ana Ekrana Ekle" ile bu sayfayı uygulama gibi
 *   kullanır. Aynı sayfa Android'de de yedek yoldur.
 *
 * AKIŞ (APK ile birebir): Giriş → Mükellef → Gider/Gelir → Fotoğraf çek / Galeriden seç → Gönder.
 * GERÇEK VERİ: mükellefler /taxpayers; belge POST /fatura-muhasebelestirme/documents/upload
 *   (taxpayerId + invoiceKind) → FM'de ilgili mükellefin Alış/Satış kuyruğuna düşer, OCR başlar.
 *
 * FARK: telefon kamerası doğrudan kullanılır (kenar bulup otomatik kırpma YOK — o yalnız APK'da).
 *   Küçültme burada da yapılır: 1600 px / kalite 0,7 (fiş fotoğrafı 4 MB → ~400 KB).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, refreshAccessToken } from '@/lib/api';
import { authApi } from '@/lib/auth';

/* ───────── portal beyaz teması (apps/mobile/app/tara.tsx ile aynı değerler) ───────── */
const C = {
  bg: '#f5f7fb', surface: '#ffffff', border: '#e6ebf2', line: '#f0f3f8',
  primary: '#4263eb', ink2: '#3b5bdb', pline: '#dbe4ff',
  text: '#1e293b', ink: '#0f172a', text2: '#475569', muted: '#64748b', faint: '#94a3b8',
  green: '#237032', greenBg: '#ebfbee', greenLine: '#b2f2bb',
  rose: '#e03131', roseBg: '#fff6f6', roseLine: '#ffd3d3',
  sky: '#1864ab', skyBg: '#e7f5ff', skyLine: '#a5d8ff',
  n1: '#0e2a58', n2: '#123a74', n3: '#0d7d73',
};

const RENKLER: [string, string][] = [
  ['#748ffc', '#3b5bdb'], ['#4dabf7', '#1864ab'], ['#51cf66', '#237032'],
  ['#9775fa', '#6741d9'], ['#ffa94d', '#d9480f'], ['#38d9a9', '#0b7285'],
];
const SON_MUKELLEF_ANAHTARI = 'moren-tara-son-mukellefler';
const MB = 1024 * 1024;

type Mukellef = { id: string; ad: string; vkn: string; defter: string; bas: string; renk: [string, string] };
type Yon = 'ALIS' | 'SATIS';
type Belge = { anahtar: string; dosya: File; onizleme: string; ad: string; oncekiBayt: number; sonraBayt: number; secili: boolean };

const mbYaz = (b: number) => `${(b / MB).toFixed(2)} MB`;
const buAy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function basHarfleri(ad: string) {
  const p = ad.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toLocaleUpperCase('tr-TR') || '?';
}
/** Türkçe duyarlı arama: "ışık" yazınca "IŞIK" bulunsun. */
function sadelestir(s: string) {
  return String(s || '').toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}
function defterAdi(t: any) {
  const dt = String(t?.defterTuru || (t?.mihsapDefterTuru === 'DEFTER_BEYAN' ? 'ISLETME' : t?.mihsapDefterTuru) || '');
  if (/BILANCO/i.test(dt)) return 'Bilanço';
  if (/ISLETME|BASIT/i.test(dt)) return 'İşletme';
  return '';
}

/**
 * Yüklemeden önce küçült (tarayıcıda canvas ile). 1600 px genişlik OCR için fazlasıyla yeterli.
 * Küçültme başarısız olursa ORİJİNAL gönderilir — belge kaybetmektense büyük göndermek yeğdir.
 */
async function kucult(dosya: File, sira: number): Promise<Belge> {
  const oncekiBayt = dosya.size;
  const ad = `tarama-${new Date().toISOString().slice(0, 10)}-${sira}.jpg`;
  const anahtar = `${Date.now()}-${sira}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const bitmap = await createImageBitmap(dosya);
    const olcek = Math.min(1, 1600 / Math.max(bitmap.width, 1));
    const g = Math.max(1, Math.round(bitmap.width * olcek));
    const y = Math.max(1, Math.round(bitmap.height * olcek));
    const tuval = document.createElement('canvas');
    tuval.width = g; tuval.height = y;
    const ctx = tuval.getContext('2d');
    if (!ctx) throw new Error('canvas yok');
    ctx.drawImage(bitmap, 0, 0, g, y);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => tuval.toBlob(res, 'image/jpeg', 0.7));
    if (!blob) throw new Error('blob yok');
    const kucuk = new File([blob], ad, { type: 'image/jpeg' });
    return { anahtar, dosya: kucuk, onizleme: URL.createObjectURL(kucuk), ad, oncekiBayt, sonraBayt: kucuk.size, secili: true };
  } catch {
    return { anahtar, dosya, onizleme: URL.createObjectURL(dosya), ad: dosya.name || ad, oncekiBayt, sonraBayt: oncekiBayt, secili: true };
  }
}

/* ───────────────────────── MARKA ───────────────────────── */
function Marka({ buyuk = false }: { buyuk?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: '"Kaushan Script", cursive', fontSize: buyuk ? 52 : 24, lineHeight: buyuk ? '62px' : '28px', color: buyuk ? '#fff' : C.n2 }}>Moren</div>
      <div style={{ fontFamily: '"Kaushan Script", cursive', fontSize: buyuk ? 17 : 9, lineHeight: buyuk ? '24px' : '12px', color: buyuk ? '#cfe9e6' : C.n3, marginTop: buyuk ? 4 : 1 }}>Mali Müşavirlik</div>
    </div>
  );
}

export default function BelgeTarayici() {
  const [hazir, setHazir] = useState(false);
  const [girisli, setGirisli] = useState(false);

  // giriş
  const [eposta, setEposta] = useState('');
  const [sifre, setSifre] = useState('');
  const [girisHata, setGirisHata] = useState('');
  const [girisBusy, setGirisBusy] = useState(false);

  // veri
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState('');
  const [mukellefler, setMukellefler] = useState<Mukellef[]>([]);
  const [sonIdler, setSonIdler] = useState<string[]>([]);
  const [arama, setArama] = useState('');
  const [secili, setSecili] = useState<Mukellef | null>(null);
  const [yon, setYon] = useState<Yon | null>(null);
  const [belgeler, setBelgeler] = useState<Belge[]>([]);
  const [hazirlaniyor, setHazirlaniyor] = useState(false);
  const [sonuc, setSonuc] = useState('');

  // gönderim
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [ilerleme, setIlerleme] = useState(0);
  const [basarili, setBasarili] = useState(0);
  const [basarisiz, setBasarisiz] = useState(0);

  const kameraRef = useRef<HTMLInputElement>(null);
  const galeriRef = useRef<HTMLInputElement>(null);

  // Açılışta yenileme çerezinden oturumu kur (telefonda her seferinde şifre sorulmasın).
  useEffect(() => {
    let iptal = false;
    (async () => {
      const t = await refreshAccessToken();
      if (!iptal) { setGirisli(!!t); setHazir(true); }
    })();
    try { setSonIdler(JSON.parse(localStorage.getItem(SON_MUKELLEF_ANAHTARI) || '[]')); } catch { /* yok say */ }
    return () => { iptal = true; };
  }, []);

  const mukellefleriYukle = useCallback(async () => {
    setYukleniyor(true); setHata('');
    try {
      const { data } = await api.get('/taxpayers');
      const arr: any[] = Array.isArray(data) ? data : data?.items || data?.data || data?.taxpayers || [];
      const liste = arr
        .map((t) => {
          const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '—').trim();
          let h = 0; for (let i = 0; i < ad.length; i++) h = (h * 31 + ad.charCodeAt(i)) >>> 0;
          return {
            id: String(t.id), ad,
            vkn: String(t.taxNumber || t.vergiKimlikNo || ''),
            defter: defterAdi(t), bas: basHarfleri(ad),
            renk: RENKLER[h % RENKLER.length] as [string, string],
          };
        })
        .filter((t) => t.id && t.ad !== '—')
        .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
      setMukellefler(liste);
      if (!liste.length) setHata('Mükellef listesi boş geldi.');
    } catch (e: any) {
      setHata(`Mükellefler alınamadı: ${e?.message || 'bağlantı hatası'}`);
    } finally { setYukleniyor(false); }
  }, []);

  useEffect(() => { if (girisli) mukellefleriYukle(); }, [girisli, mukellefleriYukle]);

  const suzulmus = useMemo(() => {
    const q = sadelestir(arama);
    const temel = q ? mukellefler.filter((m) => sadelestir(m.ad).includes(q) || m.vkn.includes(arama.trim())) : mukellefler;
    if (q || !sonIdler.length) return temel;
    // Arama yokken son kullanılanlar en üstte (personel aynı mükellefle çalışıyor).
    const son = sonIdler.map((id) => temel.find((m) => m.id === id)).filter(Boolean) as Mukellef[];
    return [...son, ...temel.filter((m) => !sonIdler.includes(m.id))];
  }, [arama, mukellefler, sonIdler]);

  const seciliSayi = belgeler.filter((b) => b.secili).length;
  const hepsiSecili = belgeler.length > 0 && belgeler.every((b) => b.secili);

  async function girisYap(e?: React.FormEvent) {
    e?.preventDefault();
    if (!eposta.trim() || !sifre) { setGirisHata('E-posta ve şifre gerekli.'); return; }
    setGirisBusy(true); setGirisHata('');
    try {
      const d = await authApi.login(eposta.trim(), sifre);
      if (d?.accessToken) { setGirisli(true); setSifre(''); }
      else setGirisHata('Giriş yanıtı beklenmedik. Tekrar deneyin.');
    } catch (e: any) {
      setGirisHata(e?.response?.data?.message || 'Giriş yapılamadı. E-posta veya şifre hatalı.');
    } finally { setGirisBusy(false); }
  }

  function mukellefSec(m: Mukellef) {
    setSecili(m); setArama('');
    const yeni = [m.id, ...sonIdler.filter((x) => x !== m.id)].slice(0, 5);
    setSonIdler(yeni);
    try { localStorage.setItem(SON_MUKELLEF_ANAHTARI, JSON.stringify(yeni)); } catch { /* yok say */ }
  }

  async function dosyaEkle(list: FileList | null) {
    const dosyalar = Array.from(list || []).filter((f) => f.type.startsWith('image/'));
    if (!dosyalar.length) return;
    setHazirlaniyor(true); setSonuc('');
    try {
      const bas = belgeler.length;
      const yeni: Belge[] = [];
      for (let i = 0; i < dosyalar.length; i++) yeni.push(await kucult(dosyalar[i], bas + i + 1));
      setBelgeler((s) => [...s, ...yeni]);
    } finally {
      setHazirlaniyor(false);
      if (kameraRef.current) kameraRef.current.value = '';
      if (galeriRef.current) galeriRef.current.value = '';
    }
  }

  /** TEK TEK gönderim: biri patlarsa diğerleri gider, gitmeyen listede kalır. */
  async function gonder() {
    if (!secili || !yon) return;
    const gidecek = belgeler.filter((b) => b.secili);
    if (!gidecek.length) return;

    setGonderiliyor(true); setIlerleme(0); setBasarili(0); setBasarisiz(0); setSonuc('');
    const giden: string[] = [];
    let ok = 0, hataAdet = 0;

    for (let i = 0; i < gidecek.length; i++) {
      const b = gidecek[i];
      try {
        const fd = new FormData();
        fd.append('files', b.dosya, b.ad);
        fd.append('taxpayerId', secili.id);
        fd.append('invoiceKind', yon);
        fd.append('source', 'mobil-tarayici-web');
        // Belge türünü OCR belirler (Z raporu / fatura / ÖKC fişi); bu yalnız geçici etiket.
        fd.append('documentType', 'OKC_FIS');
        fd.append('period', buAy());
        await api.post('/fatura-muhasebelestirme/documents/upload', fd, { timeout: 120000 });
        ok++; setBasarili(ok); giden.push(b.anahtar);
      } catch {
        hataAdet++; setBasarisiz(hataAdet);
      }
      setIlerleme(((i + 1) / gidecek.length) * 100);
    }

    setBelgeler((s) => s.filter((b) => !giden.includes(b.anahtar)));
    setGonderiliyor(false);
    setSonuc(hataAdet
      ? `${ok} belge gönderildi · ${hataAdet} belge gitmedi (listede kaldı, tekrar deneyin)`
      : `${ok} belge gönderildi · ${secili.ad} · ${yon === 'ALIS' ? 'Gider' : 'Gelir'}`);
  }

  /* ─────────────── açılış ─────────────── */
  if (!hazir) {
    return (
      <div style={{ ...st.kok, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.muted, fontSize: 14 }}>Yükleniyor…</div>
      </div>
    );
  }

  /* ─────────────── 0) GİRİŞ ─────────────── */
  if (!girisli) {
    return (
      <div style={st.kok}>
        <link href="https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap" rel="stylesheet" />
        <div style={st.hero}>
          <Marka buyuk />
          <div style={st.rozet}>BELGE TARAYICI</div>
        </div>
        <form onSubmit={girisYap} style={st.sayfa}>
          <div style={st.baslik}>Hoş geldiniz</div>
          <div style={st.altYazi}>Ofis hesabınızla giriş yapın</div>

          <label style={st.etiket}>E-POSTA</label>
          <input
            style={st.kutu} value={eposta} onChange={(e) => setEposta(e.target.value)}
            placeholder="ad@morenmusavirlik.com" type="email" autoComplete="username"
            autoCapitalize="none" autoCorrect="off" inputMode="email"
          />
          <label style={{ ...st.etiket, marginTop: 14 }}>ŞİFRE</label>
          <input
            style={st.kutu} value={sifre} onChange={(e) => setSifre(e.target.value)}
            placeholder="••••••••" type="password" autoComplete="current-password"
          />
          {!!girisHata && <div style={st.hataKutu}>{girisHata}</div>}
          <button type="submit" disabled={girisBusy} style={{ ...st.anaDugme, marginTop: 18, opacity: girisBusy ? 0.6 : 1 }}>
            {girisBusy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
          <div style={st.ipucu}>
            iPhone: Safari&apos;de <b>Paylaş</b> → <b>Ana Ekrana Ekle</b> derseniz uygulama gibi açılır.
          </div>
        </form>
      </div>
    );
  }

  /* ─────────────── 1) MÜKELLEF ─────────────── */
  if (!secili) {
    return (
      <div style={st.kok}>
        <link href="https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap" rel="stylesheet" />
        <div style={st.ustBar}><Marka /><div style={st.ustRozet}>Belge Tarayıcı</div></div>
        <div style={st.sayfa}>
          <div style={st.baslik}>Mükellef seçin</div>
          <input
            style={{ ...st.kutu, marginTop: 10 }} value={arama} onChange={(e) => setArama(e.target.value)}
            placeholder="Ad veya VKN ara…" autoCapitalize="none" autoCorrect="off"
          />
          {yukleniyor && <div style={st.bilgi}>Mükellefler yükleniyor…</div>}
          {!!hata && <div style={st.hataKutu}>{hata}</div>}
          <div style={{ marginTop: 12 }}>
            {suzulmus.map((m) => (
              <button key={m.id} onClick={() => mukellefSec(m)} style={st.satir}>
                <span style={{ ...st.avatar, background: `linear-gradient(135deg, ${m.renk[0]}, ${m.renk[1]})` }}>{m.bas}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={st.satirAd}>{m.ad}</span>
                  <span style={st.satirAlt}>{[m.vkn, m.defter].filter(Boolean).join(' · ')}</span>
                </span>
                <span style={{ color: C.faint, fontSize: 20, lineHeight: '20px' }}>›</span>
              </button>
            ))}
            {!yukleniyor && !suzulmus.length && !hata && <div style={st.bilgi}>Eşleşen mükellef yok.</div>}
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────── 2) YÖN ─────────────── */
  if (!yon) {
    return (
      <div style={st.kok}>
        <link href="https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap" rel="stylesheet" />
        <div style={st.ustBar}><Marka /><div style={st.ustRozet}>Belge Tarayıcı</div></div>
        <div style={st.sayfa}>
          <button onClick={() => setSecili(null)} style={st.geri}>‹ Mükellefi değiştir</button>
          <div style={st.seciliKart}>
            <span style={{ ...st.avatar, background: `linear-gradient(135deg, ${secili.renk[0]}, ${secili.renk[1]})` }}>{secili.bas}</span>
            <span style={{ minWidth: 0 }}>
              <span style={st.satirAd}>{secili.ad}</span>
              <span style={st.satirAlt}>{[secili.vkn, secili.defter].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
          <div style={{ ...st.baslik, marginTop: 18 }}>Belge türü</div>
          <div style={st.altYazi}>Gönderilen belgeler bu kuyruğa düşer.</div>
          <button onClick={() => setYon('ALIS')} style={{ ...st.turKart, background: C.roseBg, borderColor: C.roseLine }}>
            <span style={{ ...st.turAd, color: C.rose }}>Gider (Alış)</span>
            <span style={st.turAlt}>Aldığımız fatura, fiş, gider belgesi</span>
          </button>
          <button onClick={() => setYon('SATIS')} style={{ ...st.turKart, background: C.greenBg, borderColor: C.greenLine }}>
            <span style={{ ...st.turAd, color: C.green }}>Gelir (Satış)</span>
            <span style={st.turAlt}>Kestiğimiz fatura, Z raporu</span>
          </button>
        </div>
      </div>
    );
  }

  /* ─────────────── 3) BELGELER ─────────────── */
  return (
    <div style={st.kok}>
      <link href="https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap" rel="stylesheet" />
      <div style={st.ustBar}><Marka /><div style={st.ustRozet}>Belge Tarayıcı</div></div>
      <div style={{ ...st.sayfa, paddingBottom: 120 }}>
        <button onClick={() => { setYon(null); setSonuc(''); }} style={st.geri}>‹ Belge türünü değiştir</button>
        <div style={st.seciliKart}>
          <span style={{ ...st.avatar, background: `linear-gradient(135deg, ${secili.renk[0]}, ${secili.renk[1]})` }}>{secili.bas}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={st.satirAd}>{secili.ad}</span>
            <span style={st.satirAlt}>{yon === 'ALIS' ? 'Gider (Alış)' : 'Gelir (Satış)'}</span>
          </span>
        </div>

        <input ref={kameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => dosyaEkle(e.target.files)} />
        <input ref={galeriRef} type="file" accept="image/*" multiple hidden onChange={(e) => dosyaEkle(e.target.files)} />

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={() => kameraRef.current?.click()} disabled={hazirlaniyor} style={{ ...st.anaDugme, flex: 1, margin: 0 }}>
            📷 Fotoğraf Çek
          </button>
          <button onClick={() => galeriRef.current?.click()} disabled={hazirlaniyor} style={{ ...st.ikincilDugme, flex: 1 }}>
            Galeriden Seç
          </button>
        </div>
        {hazirlaniyor && <div style={st.bilgi}>Belgeler hazırlanıyor…</div>}
        {!!sonuc && <div style={{ ...st.bilgi, background: C.greenBg, borderColor: C.greenLine, color: C.green }}>{sonuc}</div>}

        {belgeler.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 20, gap: 10 }}>
              <div style={{ ...st.baslik, fontSize: 16, flex: 1 }}>{belgeler.length} belge</div>
              <button onClick={() => setBelgeler((s) => s.map((b) => ({ ...b, secili: !hepsiSecili })))} style={st.kucukDugme}>
                {hepsiSecili ? 'Seçimi kaldır' : 'Tümünü seç'}
              </button>
              <button
                onClick={() => setBelgeler((s) => s.filter((b) => !b.secili))}
                disabled={!seciliSayi}
                style={{ ...st.kucukDugme, color: C.rose, borderColor: C.roseLine, opacity: seciliSayi ? 1 : 0.5 }}
              >
                Sil
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10, marginTop: 12 }}>
              {belgeler.map((b) => (
                <button
                  key={b.anahtar}
                  onClick={() => setBelgeler((s) => s.map((x) => (x.anahtar === b.anahtar ? { ...x, secili: !x.secili } : x)))}
                  style={{ ...st.kucukResim, borderColor: b.secili ? C.primary : C.border, boxShadow: b.secili ? `0 0 0 2px ${C.pline}` : 'none' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.onizleme} alt={b.ad} style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }} />
                  <span style={st.kucukResimAlt}>
                    {b.secili ? '✓ ' : ''}{mbYaz(b.sonraBayt)}
                    {b.oncekiBayt > b.sonraBayt * 1.2 ? ` (${mbYaz(b.oncekiBayt)})` : ''}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {!belgeler.length && !hazirlaniyor && (
          <div style={{ ...st.bosKutu }}>
            Henüz belge yok.<br />
            <span style={{ color: C.muted, fontSize: 13 }}>Fişi düz bir zemine koyup fotoğrafını çekin.</span>
          </div>
        )}
      </div>

      {belgeler.length > 0 && (
        <div style={st.altSerit}>
          {gonderiliyor ? (
            <div>
              <div style={{ height: 6, background: C.line, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${ilerleme}%`, background: C.primary, transition: 'width .2s' }} />
              </div>
              <div style={{ fontSize: 13, color: C.text2, marginTop: 8, textAlign: 'center' }}>
                Gönderiliyor… {basarili} tamam{basarisiz ? ` · ${basarisiz} hata` : ''}
              </div>
            </div>
          ) : (
            <button onClick={gonder} disabled={!seciliSayi} style={{ ...st.anaDugme, margin: 0, opacity: seciliSayi ? 1 : 0.5 }}>
              {seciliSayi} belgeyi gönder
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── stiller ───────────────────────── */
const st: Record<string, React.CSSProperties> = {
  kok: { minHeight: '100dvh', background: C.bg, display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif', color: C.text },
  hero: { background: `linear-gradient(135deg, ${C.n1}, ${C.n2} 55%, ${C.n3})`, padding: '56px 20px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  rozet: { color: '#fff', fontSize: 11, letterSpacing: 2, fontWeight: 700, border: '1px solid rgba(255,255,255,.35)', borderRadius: 999, padding: '6px 14px' },
  ustBar: { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 5 },
  ustRozet: { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.primary, background: '#eef2ff', border: `1px solid ${C.pline}`, borderRadius: 999, padding: '5px 10px' },
  sayfa: { flex: 1, padding: '18px 16px 28px', maxWidth: 560, width: '100%', margin: '0 auto' },
  baslik: { fontSize: 20, fontWeight: 700, color: C.ink },
  altYazi: { fontSize: 13, color: C.muted, marginTop: 4 },
  etiket: { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.muted, marginTop: 18, marginBottom: 6 },
  kutu: { width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 14px', fontSize: 16, color: C.ink, outline: 'none', boxSizing: 'border-box' },
  anaDugme: { width: '100%', background: C.primary, color: '#fff', border: 'none', borderRadius: 12, padding: '16px 18px', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  ikincilDugme: { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  kucukDugme: { background: C.surface, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 999, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  geri: { background: 'none', border: 'none', color: C.primary, fontSize: 14, fontWeight: 600, padding: '4px 0 12px', cursor: 'pointer' },
  seciliKart: { display: 'flex', alignItems: 'center', gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 12 },
  satir: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, marginBottom: 8, cursor: 'pointer' },
  avatar: { width: 42, height: 42, borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  satirAd: { display: 'block', fontSize: 15, fontWeight: 600, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  satirAlt: { display: 'block', fontSize: 12, color: C.muted, marginTop: 2 },
  turKart: { display: 'block', width: '100%', textAlign: 'left', border: '1px solid', borderRadius: 14, padding: 16, marginTop: 12, cursor: 'pointer' },
  turAd: { display: 'block', fontSize: 17, fontWeight: 700 },
  turAlt: { display: 'block', fontSize: 13, color: C.text2, marginTop: 4 },
  bilgi: { background: C.skyBg, border: `1px solid ${C.skyLine}`, color: C.sky, borderRadius: 12, padding: '12px 14px', fontSize: 13, marginTop: 12 },
  hataKutu: { background: C.roseBg, border: `1px solid ${C.roseLine}`, color: C.rose, borderRadius: 12, padding: '12px 14px', fontSize: 13, marginTop: 12 },
  bosKutu: { border: `1px dashed ${C.border}`, borderRadius: 14, padding: '28px 16px', textAlign: 'center', color: C.text2, fontSize: 14, marginTop: 20, lineHeight: 1.6 },
  kucukResim: { padding: 0, background: C.surface, border: '1px solid', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' },
  kucukResimAlt: { display: 'block', fontSize: 11, color: C.muted, padding: '6px 4px' },
  altSerit: { position: 'sticky', bottom: 0, background: C.surface, borderTop: `1px solid ${C.border}`, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' },
  ipucu: { fontSize: 12, color: C.muted, marginTop: 18, lineHeight: 1.6, textAlign: 'center' },
};
