/**
 * BELGE TARAYICI — fiş/fatura tarayıp Fatura İşleme Merkezi'ne gönderen sade uygulama.
 * (2026-09-23, Muzaffer Bey: "portalın asıl mobil uygulaması çıkana kadar evrak yükleme aracı".)
 *
 * AKIŞ: Giriş → Mükellef seç → Gider/Gelir → Tara (kenar bulan kamera) / Dosya Ekle → seç → Gönder.
 *
 * TASARIM (onaylandı 2026-09-23): portalın BEYAZ teması.
 *   Renkler assets/app.html :root değişkenlerinden; marka, owned-theme.css'teki wordmark
 *   (Kaushan Script + lacivert→turkuaz gradyan). Marka bir PNG DEĞİL — yazıyla kuruluyor.
 *   Giriş ekranında gradyan TAM GENİŞLİK sahnedir (kutu değil); uygulama içinde marka yalnız yazıdır.
 *
 * GERÇEK VERİ: mükellefler /taxpayers'tan gelir; belge POST /fatura-muhasebelestirme/documents/upload
 *   ile taxpayerId + invoiceKind (ALIS|SATIS) olarak gider → FM'de ilgili mükellefin Alış/Satış
 *   kuyruğuna düşer, OCR kendiliğinden başlar. Belge TÜRÜNÜ OCR kendisi belirler (Z raporu / fatura /
 *   ÖKC fişi); "ÖKC Fişi" yalnız geçici etikettir ve okuma sonrası düzeltilir.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useFonts, KaushanScript_400Regular } from '@expo-google-fonts/kaushan-script';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getStoredItem, setStoredItem, deleteStoredItem } from '../lib/secure-storage';
import * as Application from 'expo-application';

/**
 * BENİ HATIRLA (2026-09-24, Muzaffer Bey: "bir kere girince kayıt etmiyor").
 * Sunucu yenileme belirtecini YALNIZ httpOnly çerezde dönüyor (auth.controller: refreshToken
 * gövdeden çıkarılıp setRefreshCookie'ye veriliyor); mobilde çerez yok → erişim belirteci dolunca
 * oturum düşüyor ve şifre yeniden soruluyordu. Portal uygulamasının kanıtlanmış yolu: e-posta+şifre
 * telefonun güvenli kasasında (SecureStore) saklanır, oturum düşünce SESSİZCE yeniden giriş yapılır.
 */
const CREDS_KEY = 'moren.tara.creds';

/** Belge tarayıcı eklentisi NATIVE — web'de yüklenirken çöker. Yalnız telefonda, ilk kullanımda yüklenir. */
function belgeTarayici(): any {
  if (Platform.OS === 'web') return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-document-scanner-plugin');
}

/** Portal beyaz teması — apps/mobile/assets/app.html :root ile birebir. */
const C = {
  bg: '#f5f7fb', surface: '#ffffff', border: '#e6ebf2', line: '#f0f3f8',
  primary: '#4263eb', primary2: '#5c7cfa', ink2: '#3b5bdb', pline: '#dbe4ff',
  text: '#1e293b', ink: '#0f172a', text2: '#475569', muted: '#64748b', faint: '#94a3b8',
  green: '#237032', greenBg: '#ebfbee', greenLine: '#b2f2bb',
  rose: '#e03131', roseBg: '#fff6f6', roseLine: '#ffd3d3',
  sky: '#1864ab', skyBg: '#e7f5ff', skyLine: '#a5d8ff',
  n1: '#0e2a58', n2: '#123a74', n3: '#0d7d73',
  teal: '#0d7d73', tealBg: '#e6fcf5', tealLine: '#96f2d7',
  white: '#ffffff', black: '#000000',
};
const KS = 'KaushanScript_400Regular';

/** Kurulu yapının sürümü — giriş ekranının altında yazar (hangi APK kurulu, bakınca anlaşılsın). */
const SURUM = `${Application.nativeApplicationVersion || '?'} (${Application.nativeBuildVersion || '?'})`;

type Mukellef = { id: string; ad: string; vkn: string; defter: string; bas: string; renk: [string, string] };
type Yon = 'ALIS' | 'SATIS';
type Belge = { anahtar: string; uri: string; ad: string; oncekiBayt: number; sonraBayt: number; secili: boolean };

const MB = 1024 * 1024;
const mb = (b: number) => `${(b / MB).toFixed(2)} MB`;

/** Avatar gradyanları — ada göre sabit seçilir (aynı mükellef hep aynı renk). */
const RENKLER: [string, string][] = [
  ['#748ffc', '#3b5bdb'], ['#4dabf7', '#1864ab'], ['#51cf66', '#237032'],
  ['#9775fa', '#6741d9'], ['#ffa94d', '#d9480f'], ['#38d9a9', '#0b7285'],
];

function buAy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function basHarfleri(ad: string) {
  const p = ad.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toLocaleUpperCase('tr-TR') || '?';
}

/** Türkçe duyarlı arama: "ışık" yazınca "IŞIK" bulunsun. */
function sadelestir(s: string) {
  return String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

function defterAdi(t: any) {
  const dt = String(t?.defterTuru || (t?.mihsapDefterTuru === 'DEFTER_BEYAN' ? 'ISLETME' : t?.mihsapDefterTuru) || '');
  if (/BILANCO/i.test(dt)) return 'Bilanço';
  if (/ISLETME|BASIT/i.test(dt)) return 'İşletme';
  return '';
}

function boyut(uri: string): number {
  try { return Number(new File(uri).size) || 0; } catch { return 0; }
}

/** Ölçü (küçük görüntüyü BÜYÜTMEMEK için) — okunamazsa 0 döner, o zaman yalnız sıkıştırılır. */
async function olcu(uri: string): Promise<number> {
  return new Promise((coz) => {
    try { Image.getSize(uri, (g) => coz(g || 0), () => coz(0)); } catch { coz(0); }
  });
}

/**
 * Yüklemeden önce küçült.
 * 2026-09-24 (Muzaffer Bey: "fiş numarasını okumamış"): eski ayar 1600 px / kalite 0,7 idi;
 * fişin KÜÇÜK yazıları (fiş no, saat, VKN) bu ölçekte ve JPEG bozulmasında kayboluyordu.
 * Yeni ayar 2400 px / 0,9 — dosya ~1,5 MB'a çıkar (yükleme hâlâ hızlı), OCR belirgin kazanır.
 * Görüntü zaten 2400'den darsa BÜYÜTÜLMEZ (büyütmek detay katmaz, boşuna bayt).
 * Küçültme başarısız olursa ORİJİNAL gönderilir — belge kaybetmektense büyük göndermek yeğdir.
 */
const HEDEF_GENISLIK = 2400;
const JPEG_KALITE = 0.9;

async function hazirla(uri: string, sira: number): Promise<Belge> {
  const oncekiBayt = boyut(uri);
  let sonUri = uri;
  try {
    const genislik = await olcu(uri);
    const islemler = genislik > HEDEF_GENISLIK ? [{ resize: { width: HEDEF_GENISLIK } }] : [];
    const r = await ImageManipulator.manipulateAsync(uri, islemler, {
      compress: JPEG_KALITE, format: ImageManipulator.SaveFormat.JPEG,
    });
    if (r?.uri) sonUri = r.uri;
  } catch { /* orijinali gönder */ }
  return {
    anahtar: `${Date.now()}-${sira}-${Math.random().toString(36).slice(2, 7)}`,
    uri: sonUri,
    ad: `tarama-${new Date().toISOString().slice(0, 10)}-${sira}.jpg`,
    oncekiBayt,
    sonraBayt: boyut(sonUri) || oncekiBayt,
    secili: true,
  };
}

/* ───────────────────────── MARKA ───────────────────────── */
/**
 * Marka yazısı — beyazdan turkuaza akan GRADYAN DOLGU (Muzaffer Bey'in seçimi, 2026-09-24).
 * Metne gradyan ancak maske ile verilebilir: yazı maske olur, altındaki gradyan yazının içini
 * doldurur. Aynı yazı ikinci kez görünmez çizilir; yalnız ölçüyü versin diye.
 * Yazı tipi yüklenmediyse sistem yazısına düşer (uygulama fontsuz açılmasın).
 */
function Marka({ olcu = 26, hazir, altYazi = false }: { olcu?: number; hazir: boolean; altYazi?: boolean }) {
  const aile = hazir ? { fontFamily: KS } : { fontWeight: '700' as const, fontStyle: 'italic' as const };
  const yaziStil = [aile, { fontSize: olcu, lineHeight: Math.round(olcu * 1.2), color: C.white }];
  return (
    <View style={{ alignItems: altYazi ? 'center' : 'flex-end' }}>
      <MaskedView maskElement={<Text style={yaziStil}>Moren</Text>}>
        <LinearGradient
          colors={['#ffffff', '#a7f3e6', '#5eead4']} locations={[0.2, 0.62, 1]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.7 }}
        >
          <Text style={[yaziStil, { opacity: 0 }]}>Moren</Text>
        </LinearGradient>
      </MaskedView>
      {altYazi ? (
        <Text style={[aile, { fontSize: Math.round(olcu * 0.32), lineHeight: Math.round(olcu * 0.42), color: '#cfe9e6', marginTop: 2 }]}>
          Mali Müşavirlik
        </Text>
      ) : null}
    </View>
  );
}

/**
 * ÜST ŞERİT (tasarım onayı 2026-09-24) — solda MÜKELLEF, sağda MARKA ve hemen ALTINDA rozet.
 * Önceki düzende marka, uygulama adı ve mükellef adı aynı köşede toplanıp gözü yoruyordu;
 * "BELGE TARAYICI" rozeti tamamen kalktı (uygulamanın adı zaten uygulamanın kendisi).
 * Rozet iş görür: belge ekranında Gider/Gelir'i değiştirir, yön ekranında mükellefe geri döner.
 */
function Serit({
  bas, ad, alt, hazir, rozet, nokta, rozetBas, avatarBas,
}: {
  bas: string; ad: string; alt: string; hazir: boolean;
  rozet: string; nokta?: string; rozetBas: () => void; avatarBas: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[C.n1, C.n2, C.n3]} start={{ x: 0.05, y: 0 }} end={{ x: 0.95, y: 1 }}
      style={[s.serit, { paddingTop: insets.top + 12 }]}
    >
      <View style={s.seritIsik} />
      <View style={s.seritIc}>
        <Pressable style={s.sav} onPress={avatarBas} hitSlop={6}>
          <Text style={s.savT}>{bas}</Text>
        </Pressable>
        <Pressable style={s.kim} onPress={avatarBas} hitSlop={6}>
          <Text style={s.kimAd} numberOfLines={1}>{ad}</Text>
          {!!alt && <Text style={s.kimAlt} numberOfLines={1}>{alt}</Text>}
        </Pressable>
        <View style={s.sagBlok}>
          <Marka olcu={25} hazir={hazir} />
          <Pressable style={s.rozet} onPress={rozetBas} hitSlop={8}>
            {nokta ? <View style={[s.nokta, { backgroundColor: nokta }]} /> : null}
            <Text style={s.rozetT}>{rozet}</Text>
          </Pressable>
        </View>
      </View>
    </LinearGradient>
  );
}

/* ───────────────────────── EKRAN ───────────────────────── */
export default function TaraEkrani() {
  const { status, login, logout } = useAuth();
  const [fontHazir] = useFonts({ KaushanScript_400Regular });
  // Alt bar `position:absolute; bottom:0` — SafeAreaView'in alt dolgusunu ALMAZ; Android gezinme
  //   çubuğu (geri/ana/son) düğmelerin üstünü örtüyordu (2026-09-24, Muzaffer Bey'in ekran görüntüsü).
  //   Boşluk buradan eklenir; çubuksuz (tam ekran hareket) cihazlarda insets.bottom 0 → görünüm aynı.
  const insets = useSafeAreaInsets();

  // giriş
  const [eposta, setEposta] = useState('');
  const [sifre, setSifre] = useState('');
  const [girisHata, setGirisHata] = useState('');
  const [girisBusy, setGirisBusy] = useState(false);
  const [hatirla, setHatirla] = useState(true);
  const otoDenendi = useRef(false);

  // veri
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState('');
  const [mukellefler, setMukellefler] = useState<Mukellef[]>([]);
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
  const [toplamGonderim, setToplamGonderim] = useState(0);

  const girisli = status === 'authenticated';

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
            renk: RENKLER[h % RENKLER.length],
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

  // Oturum düşmüşse kasadaki kimlikle SESSİZCE gir (kullanıcı şifreyi tekrar yazmasın).
  //   Yalnız bir kez denenir; başarısızsa (şifre değişmiş olabilir) normal giriş ekranı kalır.
  useEffect(() => {
    if (status !== 'unauthenticated' || otoDenendi.current) return;
    otoDenendi.current = true;
    (async () => {
      try {
        const ham = await getStoredItem(CREDS_KEY);
        const k = ham ? JSON.parse(ham) : null;
        if (!k?.email || !k?.password) return;
        setGirisBusy(true);
        await login({ email: k.email, password: k.password, audience: 'advisor' });
      } catch {
        try { await deleteStoredItem(CREDS_KEY); } catch { /* yoksa geç */ }
      } finally { setGirisBusy(false); }
    })();
  }, [status, login]);

  const suzulmus = useMemo(() => {
    const q = sadelestir(arama);
    if (!q) return mukellefler;
    return mukellefler.filter((m) => sadelestir(m.ad).includes(q) || m.vkn.includes(arama.trim()));
  }, [arama, mukellefler]);

  const seciliSayi = belgeler.filter((b) => b.secili).length;

  async function girisYap() {
    if (!eposta.trim() || !sifre) { setGirisHata('E-posta ve şifre gerekli.'); return; }
    setGirisBusy(true); setGirisHata('');
    try {
      await login({ email: eposta.trim(), password: sifre, audience: 'advisor' });
      // Beni hatırla: kasaya yaz (kapalıysa temizle). Kasa yazılamazsa giriş yine de sürer.
      try {
        if (hatirla) await setStoredItem(CREDS_KEY, JSON.stringify({ email: eposta.trim(), password: sifre }));
        else await deleteStoredItem(CREDS_KEY);
      } catch { /* kasa yoksa geç */ }
      setSifre('');
    } catch (e: any) {
      setGirisHata(e?.response?.data?.message || 'Giriş yapılamadı. E-posta veya şifre hatalı.');
    } finally { setGirisBusy(false); }
  }

  async function cikisYap() {
    try { await deleteStoredItem(CREDS_KEY); } catch { /* yoksa geç */ }
    otoDenendi.current = true; // çıkıştan sonra kasayla kendiliğinden geri girme
    await logout();
  }

  async function ekle(uriler: string[]) {
    if (!uriler.length) return;
    setHazirlaniyor(true); setSonuc('');
    try {
      const bas = belgeler.length;
      const yeni: Belge[] = [];
      for (let i = 0; i < uriler.length; i++) yeni.push(await hazirla(uriler[i], bas + i + 1));
      setBelgeler((s) => [...s, ...yeni]);
    } finally { setHazirlaniyor(false); }
  }

  async function tara() {
    try {
      const mod = belgeTarayici();
      if (!mod) { Alert.alert('Bu yol yalnız telefonda', 'Belge tarama kamerası tarayıcıda çalışmaz.'); return; }
      const { scannedImages } = await mod.default.scanDocument({
        maxNumDocuments: 25,
        croppedImageQuality: 100, // küçültmeyi BİZ yapıyoruz — iki kez kalite kaybı olmasın
        responseType: mod.ResponseType.ImageFilePath,
      });
      await ekle(scannedImages || []);
    } catch (e: any) { Alert.alert('Tarama açılamadı', String(e?.message || e)); }
  }

  /**
   * HAM KAMERA (2026-09-24, Muzaffer Bey: "tarama çok koyu, fiş numarasını okumamış").
   * "Belge Tara" Android'de ML Kit tarayıcıyı açar; o da belgeyi temizleme filtresinden geçirip
   * kontrastı sonuna kadar açıyor — düz kağıtta iyi, SOLUK TERMAL FİŞTE küçük yazıları kırıyor.
   * Bu yol filtreye hiç girmez: ham renkli fotoğraf → OCR en çok bundan okuyor.
   */
  async function fotografCek() {
    try {
      const izin = await ImagePicker.requestCameraPermissionsAsync();
      if (!izin.granted) { Alert.alert('İzin gerekli', 'Fiş fotoğrafı çekmek için kamera izni verin.'); return; }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false });
      if (!r.canceled) await ekle(r.assets.map((a) => a.uri));
    } catch (e: any) { Alert.alert('Kamera açılamadı', String(e?.message || e)); }
  }

  async function dosyaEkle() {
    try {
      const izin = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!izin.granted) { Alert.alert('İzin gerekli', 'Galeriden belge eklemek için fotoğraf izni verin.'); return; }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 });
      if (!r.canceled) await ekle(r.assets.map((a) => a.uri));
    } catch (e: any) { Alert.alert('Dosya eklenemedi', String(e?.message || e)); }
  }

  const seciliDegistir = (k: string) => setBelgeler((s) => s.map((b) => (b.anahtar === k ? { ...b, secili: !b.secili } : b)));
  const hepsiSecili = belgeler.length > 0 && belgeler.every((b) => b.secili);
  const tumunuDegistir = () => setBelgeler((s) => s.map((b) => ({ ...b, secili: !hepsiSecili })));

  function seciliSil() {
    if (!seciliSayi) return;
    Alert.alert('Seçilenleri sil', `${seciliSayi} belge listeden çıkarılacak.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => setBelgeler((s) => s.filter((b) => !b.secili)) },
    ]);
  }

  /** TEK TEK gönderim: biri patlarsa diğerleri gider, gitmeyen listede kalır. */
  async function gonder() {
    if (!secili || !yon) return;
    const gidecek = belgeler.filter((b) => b.secili);
    if (!gidecek.length) return;

    setGonderiliyor(true); setIlerleme(0); setBasarili(0); setBasarisiz(0);
    setToplamGonderim(gidecek.length); setSonuc('');

    const giden: string[] = [];
    let ok = 0, hataAdet = 0;
    let ilkHata = '';           // ekranda SEBEP yazsın: "gitmedi" tek başına teşhise yaramıyor
    let yenidenGirisDenendi = false;

    for (let i = 0; i < gidecek.length; i++) {
      const b = gidecek[i];
      try {
        const fd = new FormData();
        fd.append('files', { uri: b.uri, name: b.ad, type: 'image/jpeg' } as any);
        fd.append('taxpayerId', secili.id);
        fd.append('invoiceKind', yon);
        fd.append('source', 'mobil-tarayici');
        // Belge türünü OCR belirler (Z raporu / fatura / ÖKC fişi); bu yalnız geçici etiket.
        fd.append('documentType', 'OKC_FIS');
        fd.append('period', buAy());
        await api.post('/fatura-muhasebelestirme/documents/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
        });
        ok++; setBasarili(ok); giden.push(b.anahtar);
      } catch (e: any) {
        const kod = Number(e?.response?.status || 0);
        // OTURUM DÜŞTÜYSE (401) kasadaki kimlikle SESSİZCE yeniden gir ve aynı belgeyi bir kez
        // daha dene. 2026-09-25: uygulama açık kalınca belirteç bayatlıyor, gönderim "4 belge
        // gitmedi" deyip duruyordu; sebep ekranda yazmadığı için de anlaşılmıyordu.
        if ((kod === 401 || kod === 403) && !yenidenGirisDenendi) {
          yenidenGirisDenendi = true;
          const girildi = await kasadanYenidenGir();
          if (girildi) { i--; continue; }
        }
        hataAdet++; setBasarisiz(hataAdet);
        if (!ilkHata) {
          const sunucu = e?.response?.data?.message;
          ilkHata = kod
            ? `${kod}${sunucu ? ` · ${String(Array.isArray(sunucu) ? sunucu[0] : sunucu).slice(0, 80)}` : ''}`
            : String(e?.message || 'bağlantı kurulamadı').slice(0, 80);
        }
      }
      setIlerleme(((i + 1) / gidecek.length) * 100);
    }

    setBelgeler((s) => s.filter((b) => !giden.includes(b.anahtar)));
    setGonderiliyor(false);
    setSonuc(hataAdet
      ? `${ok} belge gönderildi · ${hataAdet} belge gitmedi${ilkHata ? ` (${ilkHata})` : ''} — listede kaldı, tekrar deneyin`
      : `${ok} belge gönderildi · ${secili.ad} · ${yon === 'ALIS' ? 'Gider' : 'Gelir'}`);
  }

  /** Kasadaki kimlikle sessizce yeniden giriş (oturum bayatladığında gönderimi kurtarır). */
  async function kasadanYenidenGir(): Promise<boolean> {
    try {
      const ham = await getStoredItem(CREDS_KEY);
      const k = ham ? JSON.parse(ham) : null;
      if (!k?.email || !k?.password) return false;
      await login({ email: k.email, password: k.password, audience: 'advisor' });
      return true;
    } catch {
      return false;
    }
  }

  /* ─────────────── 0) GİRİŞ ─────────────── */
  if (!girisli) {
    return (
      <View style={s.kok}>
        <LinearGradient
          colors={[C.n1, C.n2, C.n3]}
          start={{ x: 0.1, y: 0 }} end={{ x: 0.95, y: 1 }}
          style={s.hero}
        >
          <View style={s.heroIsik} />
          <SafeAreaView style={s.heroIn}>
            <Marka olcu={50} hazir={fontHazir} altYazi />
            <View style={s.tag}><Text style={s.tagT}>BELGE TARAYICI</Text></View>
          </SafeAreaView>
        </LinearGradient>

        <ScrollView style={s.sheet} contentContainerStyle={s.sheetIn} keyboardShouldPersistTaps="handled">
          <Text style={s.shT}>Hoş geldiniz</Text>
          <Text style={s.shS}>Ofis hesabınızla giriş yapın</Text>

          <Text style={s.fldL}>E-POSTA</Text>
          <TextInput
            style={s.fldB} value={eposta} onChangeText={setEposta}
            placeholder="ad@morenmusavirlik.com" placeholderTextColor={C.faint}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          />

          <Text style={[s.fldL, { marginTop: 14 }]}>ŞİFRE</Text>
          <TextInput
            style={s.fldB} value={sifre} onChangeText={setSifre}
            placeholder="••••••••" placeholderTextColor={C.faint} secureTextEntry
          />

          {!!girisHata && <Text style={s.girisHata}>{girisHata}</Text>}

          {/* Beni hatırla: kimlik telefonun güvenli kasasında saklanır; oturum düşerse sessizce girilir. */}
          <Pressable style={s.hatirlaSatir} onPress={() => setHatirla((h) => !h)} hitSlop={6}>
            <View style={[s.kutucuk, hatirla && s.kutucukOn]}>
              {hatirla ? <Text style={s.kutucukT}>✓</Text> : null}
            </View>
            <Text style={s.hatirlaT}>Beni hatırla — bir daha şifre sorulmasın</Text>
          </Pressable>

          <Pressable style={[s.btnP, girisBusy && s.pasif]} onPress={girisYap} disabled={girisBusy}>
            {girisBusy ? <ActivityIndicator color={C.white} /> : <Text style={s.btnPT}>Giriş Yap</Text>}
          </Pressable>
          <Text style={s.gN}>Şifre yalnız bu telefonun güvenli kasasında tutulur.</Text>
          <Text style={s.surum}>Sürüm {SURUM}</Text>
        </ScrollView>
      </View>
    );
  }

  /* ─────────────── 1) MÜKELLEF ───────────────
     Bölüm ayrımı YOK (Muzaffer Bey, 2026-09-24: "sık kullanılanlar olmasın, direkt bütün liste").
     Arama kutusu şeridin içinde durur — gövdenin tamamı listeye kalır. */
  if (!secili) {
    return (
      <View style={s.kok}>
        <LinearGradient
          colors={[C.n1, C.n2, C.n3]} start={{ x: 0.05, y: 0 }} end={{ x: 0.95, y: 1 }}
          style={[s.mserit, { paddingTop: insets.top + 12 }]}
        >
          <View style={s.seritIsik} />
          <View style={s.mbas}>
            <View style={s.mbasSol}>
              <Text style={s.mbasT}>Mükellef seçin</Text>
              <Text style={s.mbasS}>
                {mukellefler.length ? `${mukellefler.length} mükellef · A–Z sıralı` : 'Belgeler seçtiğiniz mükellefe gider'}
              </Text>
            </View>
            <View style={s.sagBlok}>
              <Marka olcu={23} hazir={fontHazir} />
              <Pressable style={s.rozet} onPress={cikisYap} hitSlop={8}>
                <Text style={s.rozetT}>ÇIKIŞ</Text>
              </Pressable>
            </View>
          </View>
          <View style={s.ara}>
            <View style={s.mag} />
            <TextInput
              style={s.araI} value={arama} onChangeText={setArama}
              placeholder="Ad veya VKN ara…" placeholderTextColor="rgba(255,255,255,0.62)" autoCorrect={false}
            />
          </View>
        </LinearGradient>

        {yukleniyor ? (
          <View style={s.orta}><ActivityIndicator color={C.teal} /><Text style={s.bilgi}>Mükellefler yükleniyor…</Text></View>
        ) : hata ? (
          <View style={s.orta}>
            <Text style={s.hataY}>{hata}</Text>
            <Pressable style={s.b2} onPress={mukellefleriYukle}><Text style={s.b2T}>Tekrar dene</Text></Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[s.mliste, { paddingBottom: 26 + insets.bottom }]} keyboardShouldPersistTaps="handled">
            {suzulmus.map((m) => {
              const bilanco = m.defter === 'Bilanço';
              return (
                <Pressable key={m.id} style={s.bkart} onPress={() => setSecili(m)}>
                  <LinearGradient colors={m.renk} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.mav}>
                    <Text style={s.mavT}>{m.bas}</Text>
                  </LinearGradient>
                  <View style={s.bkartM}>
                    <Text style={s.bkAd} numberOfLines={1}>{m.ad}</Text>
                    <Text style={s.bkVkn}>{m.vkn}</Text>
                  </View>
                  {!!m.defter && (
                    <View style={[s.tur, bilanco ? s.tbil : s.tisl]}>
                      <Text style={[s.turT, bilanco ? s.turTbil : s.turTisl]}>{m.defter.toLocaleUpperCase('tr-TR')}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {!suzulmus.length && <Text style={s.bilgi}>Eşleşen mükellef yok.</Text>}
          </ScrollView>
        )}
      </View>
    );
  }

  const mukellefAlt = `${secili.vkn}${secili.defter ? ` · ${secili.defter}` : ''}`;
  const mukellefeDon = () => { setSecili(null); setYon(null); setBelgeler([]); setSonuc(''); };

  /* ─────────────── 2) YÖN ─────────────── */
  if (!yon) {
    return (
      <View style={s.kok}>
        <Serit
          bas={secili.bas} ad={secili.ad} alt={mukellefAlt} hazir={fontHazir}
          rozet="‹ DEĞİŞTİR" rozetBas={mukellefeDon} avatarBas={mukellefeDon}
        />
        <Text style={s.yonBaslik}>Belge türü</Text>
        <Text style={s.yonAlt}>Gönderilen belgeler bu kuyruğa düşer.</Text>
        <Pressable style={[s.ykart, s.ygider]} onPress={() => setYon('ALIS')}>
          <Text style={[s.ykartT, { color: C.rose }]}>Gider (Alış)</Text>
          <Text style={s.ykartS}>Aldığımız fatura, fiş, gider belgesi</Text>
        </Pressable>
        <Pressable style={[s.ykart, s.ygelir]} onPress={() => setYon('SATIS')}>
          <Text style={[s.ykartT, { color: C.green }]}>Gelir (Satış)</Text>
          <Text style={s.ykartS}>Kestiğimiz fatura, Z raporu</Text>
        </Pressable>
      </View>
    );
  }

  /* ─────────────── 3) BELGELER ─────────────── */
  return (
    <View style={s.kok}>
      <Serit
        bas={secili.bas} ad={secili.ad} alt={mukellefAlt} hazir={fontHazir}
        rozet={yon === 'ALIS' ? 'GİDER' : 'GELİR'}
        nokta={yon === 'ALIS' ? '#ff8787' : '#69db7c'}
        rozetBas={() => { setYon(yon === 'ALIS' ? 'SATIS' : 'ALIS'); setSonuc(''); }}
        avatarBas={mukellefeDon}
      />

      {belgeler.length > 0 && (
        <View style={s.sayacSatir}>
          <Text style={s.sayacT}>
            <Text style={s.sayacKalin}>{belgeler.length} belge</Text> · {seciliSayi} seçili
          </Text>
          <View style={s.sayacEylem}>
            {!!seciliSayi && (
              <Pressable onPress={seciliSil} hitSlop={8}><Text style={s.silT}>Sil</Text></Pressable>
            )}
            <Pressable onPress={tumunuDegistir} hitSlop={8}>
              <Text style={s.tumT}>{hepsiSecili ? 'Seçimi kaldır' : 'Tümünü seç'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={[s.docList, { paddingBottom: 190 + insets.bottom }]}>
        {belgeler.map((b) => (
          <Pressable key={b.anahtar} style={[s.doc, b.secili && s.docOn]} onPress={() => seciliDegistir(b.anahtar)}>
            <Image source={{ uri: b.uri }} style={s.thumb} resizeMode="cover" />
            <View style={s.docM}>
              <Text style={s.dn} numberOfLines={1}>{b.ad}</Text>
              <Text style={s.ds}>{mb(b.sonraBayt)}</Text>
            </View>
            <View style={[s.tik, b.secili && s.tikOn]}>
              {b.secili ? <Text style={s.tikT}>✓</Text> : null}
            </View>
          </Pressable>
        ))}

        {!belgeler.length && !hazirlaniyor && (
          <View style={s.bos}>
            <View style={s.bosIk}><Text style={s.bosIkT}>🧾</Text></View>
            <Text style={s.bosB}>Henüz belge yok</Text>
            <Text style={s.bosS}>
              Fişi düz bir zemine koyun, <Text style={s.bosVurgu}>Belge Tara</Text>'ya basın — kenarları kendisi bulur.
            </Text>
          </View>
        )}
        {hazirlaniyor && (
          <View style={s.orta}><ActivityIndicator color={C.teal} /><Text style={s.bilgi}>Belgeler hazırlanıyor…</Text></View>
        )}
        {!!sonuc && <Text style={s.basari}>{sonuc}</Text>}
      </ScrollView>

      {/* İKİ SATIRLI ALT BAR (2026-09-24): üstte üç ekleme yolu, altta tam genişlik Gönder.
          "Fotoğraf" = ML Kit'e hiç girmeyen ham kamera (filtre yok) — soluk termal fişte en temiz sonuç. */}
      <View style={[s.bar, { paddingBottom: 17 + insets.bottom }]}>
        <View style={s.barUst}>
          <Pressable style={s.b2} onPress={fotografCek} disabled={hazirlaniyor}><Text style={s.b2T}>📷 Fotoğraf</Text></Pressable>
          <Pressable style={s.b2} onPress={tara} disabled={hazirlaniyor}><Text style={s.b2T}>Belge Tara</Text></Pressable>
          <Pressable style={s.b2} onPress={dosyaEkle} disabled={hazirlaniyor}><Text style={s.b2T}>Galeri</Text></Pressable>
        </View>
        <Pressable style={[s.b1w, (!seciliSayi || hazirlaniyor) && s.pasif]} onPress={gonder} disabled={!seciliSayi || hazirlaniyor}>
          <LinearGradient colors={[C.n2, C.n3]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.b1}>
            <Text style={s.b1T}>{seciliSayi ? `Gönder (${seciliSayi})` : 'Gönder'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <Modal visible={gonderiliyor} transparent animationType="fade">
        <View style={s.veil}>
          <View style={s.vk}>
            <ActivityIndicator color={C.teal} size="large" />
            <Text style={s.vT}>Belgeleriniz yükleniyor…</Text>
            <Text style={s.vP}>%{ilerleme.toFixed(2).replace('.', ',')}</Text>
            <Text style={s.vAdet}>{basarili + basarisiz} / {toplamGonderim}</Text>
            <View style={s.vS}>
              <View style={[s.vChip, { backgroundColor: C.greenBg, borderColor: C.greenLine }]}>
                <Text style={[s.vChipT, { color: C.green }]}>Yüklenen: {basarili}</Text>
              </View>
              <View style={[s.vChip, { backgroundColor: C.roseBg, borderColor: C.roseLine }]}>
                <Text style={[s.vChipT, { color: C.rose }]}>Hatalı: {basarisiz}</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: C.bg },

  /* ── giriş ── */
  hero: { height: 330, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  heroIsik: { position: 'absolute', right: -60, top: -70, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(94,234,212,0.16)' },
  heroIn: { alignItems: 'center', justifyContent: 'center', paddingBottom: 46 },
  tag: { marginTop: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 6 },
  tagT: { fontSize: 10, fontWeight: '800', letterSpacing: 2.2, color: 'rgba(255,255,255,0.72)' },
  sheet: { flex: 1, backgroundColor: C.white, borderTopLeftRadius: 30, borderTopRightRadius: 30, marginTop: -34 },
  sheetIn: { padding: 24, paddingBottom: 40 },
  shT: { fontSize: 17, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  shS: { fontSize: 12.5, color: C.muted, marginTop: 4 },
  fldL: { fontSize: 10.5, fontWeight: '700', color: C.text2, letterSpacing: 0.6, marginTop: 16, marginBottom: 6 },
  fldB: {
    backgroundColor: '#fafbfd', borderWidth: 1, borderColor: C.border, borderRadius: 13,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 13.5, color: C.text,
  },
  girisHata: { color: C.rose, fontSize: 12.5, marginTop: 12 },
  btnP: { marginTop: 20, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.n2 },
  btnPT: { color: C.white, fontSize: 14.5, fontWeight: '700' },
  gN: { fontSize: 10.5, color: C.faint, marginTop: 14, textAlign: 'center', lineHeight: 15 },
  surum: { fontSize: 10, color: '#b6c2d2', marginTop: 6, textAlign: 'center' },
  hatirlaSatir: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16, paddingVertical: 4 },
  kutucuk: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  kutucukOn: { backgroundColor: C.teal, borderColor: C.teal },
  kutucukT: { color: C.white, fontSize: 12, fontWeight: '900', lineHeight: 14 },
  hatirlaT: { flex: 1, fontSize: 12.5, color: C.text2 },

  /* ── üst şerit (mükellef + marka + rozet) ── */
  serit: { paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, overflow: 'hidden' },
  seritIsik: { position: 'absolute', right: -40, top: -90, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(94,234,212,0.15)' },
  seritIc: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sav: {
    width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  savT: { color: C.white, fontSize: 13.5, fontWeight: '700' },
  kim: { flex: 1, minWidth: 0 },
  kimAd: { color: C.white, fontSize: 14, fontWeight: '700' },
  kimAlt: { color: 'rgba(255,255,255,0.82)', fontSize: 10.5, marginTop: 2 },
  sagBlok: { alignItems: 'flex-end', gap: 8 },
  rozet: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.26)',
  },
  rozetT: { color: C.white, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  nokta: { width: 6, height: 6, borderRadius: 3 },

  /* ── mükellef ekranı ── */
  mserit: { paddingHorizontal: 16, paddingBottom: 18, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, overflow: 'hidden' },
  mbas: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  mbasSol: { flex: 1, minWidth: 0 },
  mbasT: { color: C.white, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  mbasS: { color: 'rgba(255,255,255,0.82)', fontSize: 11, marginTop: 3 },
  ara: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 13, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', paddingHorizontal: 12,
  },
  mag: { width: 12, height: 12, borderWidth: 1.6, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 6 },
  araI: { flex: 1, color: C.white, fontSize: 12.5, paddingVertical: Platform.OS === 'ios' ? 11 : 8 },
  mliste: { paddingHorizontal: 16, paddingTop: 14, gap: 9 },
  bkart: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.white, borderRadius: 16, padding: 11,
    shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  mav: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mavT: { color: C.white, fontSize: 13, fontWeight: '800' },
  bkartM: { flex: 1, minWidth: 0 },
  bkAd: { fontSize: 12.5, fontWeight: '700', color: C.ink },
  bkVkn: { fontSize: 10.5, color: C.faint, marginTop: 3 },
  tur: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  tisl: { backgroundColor: '#e6fcf5' },
  tbil: { backgroundColor: '#fff4e6' },
  turT: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5 },
  turTisl: { color: '#0b7285' },
  turTbil: { color: '#b35309' },

  /* ── yön ── */
  yonBaslik: { marginTop: 20, marginHorizontal: 16, fontSize: 18, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  yonAlt: { marginHorizontal: 16, fontSize: 12, color: C.muted, marginTop: 3 },
  ykart: { marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 16, borderWidth: 1.5 },
  ygider: { backgroundColor: C.roseBg, borderColor: C.roseLine },
  ygelir: { backgroundColor: C.greenBg, borderColor: C.greenLine },
  ykartT: { fontSize: 15.5, fontWeight: '800' },
  ykartS: { fontSize: 11.5, color: C.text2, marginTop: 4 },

  /* ── belge listesi ── */
  sayacSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 15, paddingBottom: 9 },
  sayacT: { fontSize: 11.5, color: C.text2 },
  sayacKalin: { color: C.ink, fontWeight: '700' },
  sayacEylem: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  silT: { fontSize: 11.5, fontWeight: '700', color: C.rose },
  tumT: { fontSize: 11.5, fontWeight: '700', color: C.teal },
  docList: { paddingHorizontal: 16, gap: 9 },
  doc: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.white, borderRadius: 14, padding: 9,
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  docOn: { borderColor: C.teal },
  thumb: { width: 46, height: 54, borderRadius: 9, backgroundColor: C.line },
  docM: { flex: 1, minWidth: 0 },
  dn: { fontSize: 12, fontWeight: '700', color: C.ink },
  ds: { fontSize: 10.5, color: C.faint, marginTop: 3 },
  tik: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  tikOn: { backgroundColor: C.teal, borderColor: C.teal },
  tikT: { color: C.white, fontSize: 11, fontWeight: '900' },

  /* boş durum */
  bos: { alignItems: 'center', justifyContent: 'center', paddingTop: 70, paddingHorizontal: 34, gap: 11 },
  bosIk: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.white, borderWidth: 1.5, borderColor: '#cbd5e1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  bosIkT: { fontSize: 25 },
  bosB: { fontSize: 14, fontWeight: '700', color: C.ink },
  bosS: { fontSize: 11.5, color: C.faint, textAlign: 'center', lineHeight: 19 },
  bosVurgu: { color: C.n2, fontWeight: '700' },

  /* ── alt bar ── */
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, gap: 9,
    paddingHorizontal: 16, paddingTop: 14, backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.border,
  },
  barUst: { flexDirection: 'row', gap: 9 },
  b2: { flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 13, paddingVertical: 12, alignItems: 'center', backgroundColor: '#f6f8fc' },
  b2T: { color: C.text, fontSize: 11.5, fontWeight: '600' },
  b1w: { borderRadius: 14, overflow: 'hidden' },
  b1: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  b1T: { color: C.white, fontSize: 14, fontWeight: '700' },
  pasif: { opacity: 0.45 },

  /* ── yükleme ── */
  veil: { flex: 1, backgroundColor: 'rgba(9,20,40,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  vk: { width: '100%', borderRadius: 22, backgroundColor: C.white, padding: 26, alignItems: 'center' },
  vT: { fontSize: 14.5, fontWeight: '700', color: C.ink, marginTop: 14 },
  vP: { fontSize: 30, fontWeight: '800', color: C.n2, marginTop: 8, letterSpacing: -1 },
  vAdet: { fontSize: 11, color: C.muted, marginTop: 2 },
  vS: { flexDirection: 'row', gap: 7, marginTop: 13 },
  vChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 5 },
  vChipT: { fontSize: 10.5, fontWeight: '700' },

  /* ── ortak ── */
  orta: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  bilgi: { color: C.muted, fontSize: 13.5, textAlign: 'center' },
  hataY: { color: C.rose, fontSize: 14, textAlign: 'center' },
  basari: { color: C.green, fontSize: 13, fontWeight: '600', marginTop: 12, textAlign: 'center' },
});
