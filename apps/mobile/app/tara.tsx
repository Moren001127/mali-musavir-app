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
import { useFonts, KaushanScript_400Regular } from '@expo-google-fonts/kaushan-script';
import DocumentScanner, { ResponseType } from 'react-native-document-scanner-plugin';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getStoredItem, setStoredItem, deleteStoredItem } from '../lib/secure-storage';

/**
 * BENİ HATIRLA (2026-09-24, Muzaffer Bey: "bir kere girince kayıt etmiyor").
 * Sunucu yenileme belirtecini YALNIZ httpOnly çerezde dönüyor (auth.controller: refreshToken
 * gövdeden çıkarılıp setRefreshCookie'ye veriliyor); mobilde çerez yok → erişim belirteci dolunca
 * oturum düşüyor ve şifre yeniden soruluyordu. Portal uygulamasının kanıtlanmış yolu: e-posta+şifre
 * telefonun güvenli kasasında (SecureStore) saklanır, oturum düşünce SESSİZCE yeniden giriş yapılır.
 */
const CREDS_KEY = 'moren.tara.creds';

/** Portal beyaz teması — apps/mobile/assets/app.html :root ile birebir. */
const C = {
  bg: '#f5f7fb', surface: '#ffffff', border: '#e6ebf2', line: '#f0f3f8',
  primary: '#4263eb', primary2: '#5c7cfa', ink2: '#3b5bdb', pline: '#dbe4ff',
  text: '#1e293b', ink: '#0f172a', text2: '#475569', muted: '#64748b', faint: '#94a3b8',
  green: '#237032', greenBg: '#ebfbee', greenLine: '#b2f2bb',
  rose: '#e03131', roseBg: '#fff6f6', roseLine: '#ffd3d3',
  sky: '#1864ab', skyBg: '#e7f5ff', skyLine: '#a5d8ff',
  n1: '#0e2a58', n2: '#123a74', n3: '#0d7d73',
  white: '#ffffff', black: '#000000',
};
const KS = 'KaushanScript_400Regular';

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

/**
 * Yüklemeden önce küçült. Fiş fotoğrafları 3-5 MB geliyor; 1600 px genişlik OCR için fazlasıyla
 * yeterli, kalite 0.7 ile dosya ~%80 küçülüyor. Küçültme olmazsa ORİJİNAL gönderilir —
 * belge kaybetmektense büyük göndermek yeğdir.
 */
async function hazirla(uri: string, sira: number): Promise<Belge> {
  const oncekiBayt = boyut(uri);
  let sonUri = uri;
  try {
    const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
      compress: 0.7, format: ImageManipulator.SaveFormat.JPEG,
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
function Marka({ buyuk = false, hazir }: { buyuk?: boolean; hazir: boolean }) {
  // Yazı tipi yüklenmediyse sistem yazısına düş (uygulama fontsuz açılmasın).
  const aile = hazir ? { fontFamily: KS } : { fontWeight: '700' as const, fontStyle: 'italic' as const };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[aile, buyuk ? mk.adBuyuk : mk.ad]}>Moren</Text>
      <Text style={[aile, buyuk ? mk.altBuyuk : mk.alt]}>Mali Müşavirlik</Text>
    </View>
  );
}
const mk = StyleSheet.create({
  ad: { fontSize: 24, lineHeight: 28, color: C.n2 },
  alt: { fontSize: 9, lineHeight: 12, color: C.n3, marginTop: 1 },
  adBuyuk: { fontSize: 56, lineHeight: 66, color: C.white },
  altBuyuk: { fontSize: 18, lineHeight: 24, color: '#cfe9e6', marginTop: 4 },
});

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
      const { scannedImages } = await DocumentScanner.scanDocument({
        maxNumDocuments: 25,
        croppedImageQuality: 100, // küçültmeyi BİZ yapıyoruz — iki kez kalite kaybı olmasın
        responseType: ResponseType.ImageFilePath,
      });
      await ekle(scannedImages || []);
    } catch (e: any) { Alert.alert('Tarama açılamadı', String(e?.message || e)); }
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

  /* ─────────────── 0) GİRİŞ ─────────────── */
  if (!girisli) {
    return (
      <View style={s.kok}>
        <LinearGradient
          colors={[C.n1, C.n2, C.n3]}
          start={{ x: 0.1, y: 0 }} end={{ x: 0.95, y: 1 }}
          style={s.hero}
        >
          <SafeAreaView style={s.heroIn}>
            <Marka buyuk hazir={fontHazir} />
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
        </ScrollView>
      </View>
    );
  }

  /* ─────────────── 1) MÜKELLEF ─────────────── */
  if (!secili) {
    return (
      <SafeAreaView style={s.kok}>
        <View style={s.top}>
          <Marka hazir={fontHazir} />
          <Pressable style={s.iq} onPress={cikisYap} hitSlop={8}>
            <Text style={s.iqT}>⇥</Text>
          </Pressable>
        </View>
        <View style={s.sep} />

        <View style={s.pad}>
          <Text style={s.h1}>Belge Tarayıcı</Text>
          <Text style={s.h2}>Fiş ve faturaları tarayıp ofise gönderin</Text>
        </View>

        <View style={s.srch}>
          <View style={s.mag} />
          <TextInput
            style={s.srchI} value={arama} onChangeText={setArama}
            placeholder="Mükellef ara (ad veya VKN)" placeholderTextColor={C.faint} autoCorrect={false}
          />
        </View>

        {yukleniyor ? (
          <View style={s.orta}><ActivityIndicator color={C.primary} /><Text style={s.bilgi}>Mükellefler yükleniyor…</Text></View>
        ) : hata ? (
          <View style={s.orta}>
            <Text style={s.hataY}>{hata}</Text>
            <Pressable style={s.b2} onPress={mukellefleriYukle}><Text style={s.b2T}>Tekrar dene</Text></Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.liste} keyboardShouldPersistTaps="handled">
            {suzulmus.map((m) => (
              <Pressable key={m.id} style={s.row} onPress={() => setSecili(m)}>
                <LinearGradient colors={m.renk} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.av}>
                  <Text style={s.avT}>{m.bas}</Text>
                </LinearGradient>
                <View style={s.rowM}>
                  <Text style={s.rn} numberOfLines={1}>{m.ad}</Text>
                  <Text style={s.rv}>{m.vkn}{m.defter ? ` · ${m.defter}` : ''}</Text>
                </View>
                <Text style={s.chev}>›</Text>
              </Pressable>
            ))}
            {!suzulmus.length && <Text style={s.bilgi}>Eşleşen mükellef yok.</Text>}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  /* Mükellef kartı — yanlış mükellefe gönderim en pahalı hata, hep üstte durur. */
  const kart = (
    <View style={s.card}>
      <View style={s.cardGlow} />
      <Pressable onPress={() => { setSecili(null); setYon(null); setBelgeler([]); setSonuc(''); }} hitSlop={10}>
        <Text style={s.bk}>‹</Text>
      </Pressable>
      <LinearGradient colors={[C.n2, C.n3]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.cav}>
        <Text style={s.cavT}>{secili.bas}</Text>
      </LinearGradient>
      <View style={s.cardM}>
        <Text style={s.ce}>MÜKELLEF</Text>
        <Text style={s.cn} numberOfLines={1}>{secili.ad}</Text>
        <Text style={s.cs}>{secili.vkn}{secili.defter ? ` · ${secili.defter}` : ''}</Text>
      </View>
    </View>
  );

  /* ─────────────── 2) YÖN ─────────────── */
  if (!yon) {
    return (
      <SafeAreaView style={s.kok}>
        {kart}
        <Text style={s.q}>Belge hangi tarafa işlenecek?</Text>
        <View style={s.dirs}>
          <Pressable style={s.dir} onPress={() => setYon('ALIS')}>
            <LinearGradient colors={['#4dabf7', C.sky]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.dIco}>
              <Text style={s.dIcoT}>↓</Text>
            </LinearGradient>
            <View><Text style={[s.dirT, { color: C.sky }]}>Gider</Text><Text style={s.dirS}>Alış faturası / fiş</Text></View>
          </Pressable>
          <Pressable style={s.dir} onPress={() => setYon('SATIS')}>
            <LinearGradient colors={['#51cf66', C.green]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.dIco}>
              <Text style={s.dIcoT}>↑</Text>
            </LinearGradient>
            <View><Text style={[s.dirT, { color: C.green }]}>Gelir</Text><Text style={s.dirS}>Satış faturası / fiş</Text></View>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /* ─────────────── 3) BELGELER ─────────────── */
  const yonRenk = yon === 'ALIS' ? C.sky : C.green;
  const yonBg = yon === 'ALIS' ? C.skyBg : C.greenBg;
  const yonLine = yon === 'ALIS' ? C.skyLine : C.greenLine;

  return (
    <SafeAreaView style={s.kok}>
      {kart}

      <View style={s.strip}>
        <View style={[s.pill, { backgroundColor: yonBg, borderColor: yonLine }]}>
          <Text style={[s.pillT, { color: yonRenk }]}>{yon === 'ALIS' ? 'Gider · Alış' : 'Gelir · Satış'}</Text>
        </View>
        <Pressable onPress={() => { setYon(null); setSonuc(''); }} hitSlop={8}>
          <Text style={s.chg}>değiştir</Text>
        </Pressable>
      </View>

      {belgeler.length > 0 && (
        <>
          <Pressable style={s.delBar} onPress={seciliSil} disabled={!seciliSayi}>
            <Text style={[s.delT, !seciliSayi && s.pasifY]}>Seçilenleri Sil</Text>
          </Pressable>
          <View style={s.cnt}>
            <View style={s.cntB}><Text style={s.cntT}>{seciliSayi} / {belgeler.length}</Text></View>
            <Pressable style={s.all} onPress={tumunuDegistir} hitSlop={8}>
              {hepsiSecili
                ? <LinearGradient colors={[C.primary2, C.ink2]} style={s.cbOn}><Text style={s.cbT}>✓</Text></LinearGradient>
                : <View style={s.cb} />}
              <Text style={s.allT}>{hepsiSecili ? 'Tüm seçilenleri kaldır' : 'Tümünü seç'}</Text>
            </Pressable>
          </View>
        </>
      )}

      <ScrollView contentContainerStyle={[s.docList, { paddingBottom: 130 + insets.bottom }]}>
        {belgeler.map((b) => (
          <Pressable key={b.anahtar} style={[s.doc, b.secili && s.docOn]} onPress={() => seciliDegistir(b.anahtar)}>
            {b.secili
              ? <LinearGradient colors={[C.primary2, C.ink2]} style={s.cbOn}><Text style={s.cbT}>✓</Text></LinearGradient>
              : <View style={s.cb} />}
            <Image source={{ uri: b.uri }} style={s.thumb} resizeMode="cover" />
            <View style={s.docM}>
              <Text style={s.dn} numberOfLines={1}>{b.ad}</Text>
              <Text style={s.ds}>
                {b.oncekiBayt ? <Text style={s.dsEski}>{mb(b.oncekiBayt)}</Text> : null}
                {b.oncekiBayt ? '  →  ' : ''}
                <Text style={s.dsYeni}>{mb(b.sonraBayt)}</Text>
              </Text>
            </View>
          </Pressable>
        ))}

        {!belgeler.length && !hazirlaniyor && (
          <Text style={s.bosluk}>
            Henüz belge yok.{'\n'}“Belge Tara” ile kamerayı fişe tutun — kenarları kendisi bulur.
          </Text>
        )}
        {hazirlaniyor && (
          <View style={s.orta}><ActivityIndicator color={C.primary} /><Text style={s.bilgi}>Belgeler hazırlanıyor…</Text></View>
        )}
        {!!sonuc && <Text style={s.basari}>{sonuc}</Text>}
      </ScrollView>

      <View style={[s.bar, { paddingBottom: 17 + insets.bottom }]}>
        <Pressable style={s.b2} onPress={dosyaEkle} disabled={hazirlaniyor}><Text style={s.b2T}>Dosya Ekle</Text></Pressable>
        <Pressable style={s.b2} onPress={tara} disabled={hazirlaniyor}><Text style={s.b2T}>Belge Tara</Text></Pressable>
        <Pressable style={[s.b1w, (!seciliSayi || hazirlaniyor) && s.pasif]} onPress={gonder} disabled={!seciliSayi || hazirlaniyor}>
          <LinearGradient colors={[C.primary2, C.ink2]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.b1}>
            <Text style={s.b1T}>{seciliSayi ? `Gönder (${seciliSayi})` : 'Gönder'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <Modal visible={gonderiliyor} transparent animationType="fade">
        <View style={s.veil}>
          <View style={s.vk}>
            <ActivityIndicator color={C.primary} size="large" />
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: C.bg },

  /* giriş */
  hero: { height: 330, justifyContent: 'center', alignItems: 'center' },
  heroIn: { alignItems: 'center', justifyContent: 'center', paddingBottom: 46 },
  tag: { marginTop: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 6 },
  tagT: { fontSize: 10, fontWeight: '800', letterSpacing: 2.2, color: 'rgba(255,255,255,0.68)' },
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
  btnP: { marginTop: 20, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink2 },
  btnPT: { color: C.white, fontSize: 14.5, fontWeight: '700' },
  gN: { fontSize: 10.5, color: C.faint, marginTop: 14, textAlign: 'center', lineHeight: 15 },
  hatirlaSatir: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16, paddingVertical: 4 },
  kutucuk: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  kutucukOn: { backgroundColor: C.primary, borderColor: C.primary },
  kutucukT: { color: C.white, fontSize: 12, fontWeight: '900', lineHeight: 14 },
  hatirlaT: { flex: 1, fontSize: 12.5, color: C.text2 },

  /* üst şerit — marka ORTALI, çıkış sağda sabit */
  top: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12 },
  iq: {
    position: 'absolute', right: 18, top: 6, width: 32, height: 32, borderRadius: 11,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  iqT: { color: C.muted, fontSize: 13 },
  sep: { height: 1, backgroundColor: C.border, marginHorizontal: 18, marginBottom: 14, opacity: 0.7 },

  pad: { paddingHorizontal: 18 },
  h1: { fontSize: 21, fontWeight: '800', color: C.ink, letterSpacing: -0.5 },
  h2: { fontSize: 12.5, color: C.muted, marginTop: 3 },

  srch: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, marginVertical: 13,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14,
  },
  srchI: { flex: 1, fontSize: 13, color: C.text, paddingVertical: Platform.OS === 'ios' ? 12 : 9 },
  mag: { width: 13, height: 13, borderWidth: 1.8, borderColor: C.faint, borderRadius: 7 },

  liste: { paddingHorizontal: 18, paddingBottom: 30, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 11 },
  av: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avT: { color: C.white, fontSize: 12, fontWeight: '800' },
  rowM: { flex: 1, minWidth: 0 },
  rn: { fontSize: 13.5, fontWeight: '600', color: C.text },
  rv: { fontSize: 11, color: C.muted, marginTop: 2 },
  chev: { color: '#cbd5e1', fontSize: 16 },

  /* mükellef kartı */
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 6, marginBottom: 14,
    padding: 14, borderRadius: 19, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  cardGlow: { position: 'absolute', right: -40, top: -46, width: 126, height: 126, borderRadius: 63, backgroundColor: 'rgba(18,58,116,0.06)' },
  bk: { fontSize: 21, color: C.n2 },
  cav: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cavT: { color: C.white, fontSize: 14, fontWeight: '800' },
  cardM: { flex: 1, minWidth: 0 },
  ce: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: C.faint },
  cn: { fontSize: 15, fontWeight: '700', color: C.ink, marginTop: 2, letterSpacing: -0.2 },
  cs: { fontSize: 11, color: C.muted, marginTop: 2 },

  /* yön */
  q: { fontSize: 12.5, color: C.muted, paddingHorizontal: 20 },
  dirs: { padding: 16, gap: 14 },
  dir: {
    flexDirection: 'row', alignItems: 'center', gap: 15, borderRadius: 20, padding: 20,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border,
  },
  dIco: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dIcoT: { color: C.white, fontSize: 22, fontWeight: '700' },
  dirT: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  dirS: { fontSize: 12, color: C.muted, marginTop: 3 },

  /* liste üstü */
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 11 },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  pillT: { fontSize: 11, fontWeight: '700' },
  chg: { fontSize: 11, fontWeight: '600', color: C.ink2 },
  delBar: { marginHorizontal: 18, marginBottom: 10, paddingVertical: 12, borderRadius: 14, alignItems: 'center', backgroundColor: C.roseBg, borderWidth: 1, borderColor: C.roseLine },
  delT: { color: C.rose, fontSize: 13, fontWeight: '700' },
  pasifY: { opacity: 0.4 },
  cnt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 10 },
  cntB: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 6 },
  cntT: { fontSize: 13.5, fontWeight: '800', color: C.ink },
  all: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  allT: { fontSize: 11.5, color: C.muted },
  cb: { width: 21, height: 21, borderRadius: 7, borderWidth: 1.6, borderColor: '#d3dbe6', backgroundColor: C.white },
  cbOn: { width: 21, height: 21, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  cbT: { color: C.white, fontSize: 12, fontWeight: '900' },

  /* belgeler */
  docList: { paddingHorizontal: 18, paddingBottom: 130, gap: 9 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 10 },
  docOn: { borderColor: C.pline, backgroundColor: '#fbfdff' },
  thumb: { width: 42, height: 55, borderRadius: 9, backgroundColor: C.line, borderWidth: 1, borderColor: C.line },
  docM: { flex: 1, minWidth: 0 },
  dn: { fontSize: 12, fontWeight: '600', color: C.text },
  ds: { fontSize: 10.5, color: C.muted, marginTop: 3 },
  dsEski: { color: C.faint, textDecorationLine: 'line-through' },
  dsYeni: { color: C.green, fontWeight: '700' },

  /* alt bar */
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 9,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 17, backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.border,
  },
  b2: { flex: 1, borderWidth: 1, borderColor: '#dde4ee', borderRadius: 14, paddingVertical: 13, alignItems: 'center', backgroundColor: C.white },
  b2T: { color: C.text, fontSize: 12, fontWeight: '600' },
  b1w: { flex: 1.3, borderRadius: 14, overflow: 'hidden' },
  b1: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  b1T: { color: C.white, fontSize: 12, fontWeight: '700' },
  pasif: { opacity: 0.45 },

  /* yükleme */
  veil: { flex: 1, backgroundColor: 'rgba(9,17,31,0.52)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  vk: { width: '100%', borderRadius: 24, backgroundColor: C.white, padding: 28, alignItems: 'center' },
  vT: { fontSize: 15.5, fontWeight: '700', color: C.ink, marginTop: 14 },
  vP: { fontSize: 27, fontWeight: '800', color: C.ink2, marginTop: 8, letterSpacing: -0.8 },
  vAdet: { fontSize: 11.5, color: C.faint, marginTop: 2 },
  vS: { flexDirection: 'row', gap: 9, marginTop: 14 },
  vChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 6 },
  vChipT: { fontSize: 11.5, fontWeight: '700' },

  /* ortak */
  orta: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  bilgi: { color: C.muted, fontSize: 14, textAlign: 'center' },
  bosluk: { color: C.muted, fontSize: 13.5, textAlign: 'center', lineHeight: 21, paddingTop: 40 },
  hataY: { color: C.rose, fontSize: 14, textAlign: 'center' },
  basari: { color: C.green, fontSize: 13.5, fontWeight: '600', marginTop: 10, textAlign: 'center' },
});
