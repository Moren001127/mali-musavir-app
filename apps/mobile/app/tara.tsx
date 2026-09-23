/**
 * BELGE TARAYICI — fiş/fatura tarayıp Fatura İşleme Merkezi'ne gönderen sade akış.
 * (2026-09-23, Muzaffer Bey: "portalın asıl mobil uygulaması çıkana kadar evrak yükleme aracı".)
 *
 * AKIŞ (Mihsap uygulamasının çalışan akışı örnek alındı — kullanıcı ekran görüntüleriyle gösterdi):
 *   Mükellef seç → Gider/Gelir seç → Tara (kenar bulan kamera) / Dosya Ekle → seç-sil → Gönder.
 *
 * Mihsap'tan alınan ve BİLE İSTEYE kopyalanan davranışlar:
 *   • Başlıkta mükellef kartı: ad + Vergi No + Defter Türü (yanlış mükellefe gönderim en pahalı hata).
 *   • Satır başına seçim kutusu + "Seçilenleri Sil" + "x / y" sayacı + tümünü seç/kaldır.
 *   • Boyut küçültme ve bunun GÖSTERİLMESİ ("2.92 MB > 0.90 MB") — fiş fotoğrafları 3-5 MB geliyor,
 *     sahada mobil veriyle yükleniyor; küçültmeden gönderim hem yavaş hem pahalı.
 *   • Yükleme ekranı: yüzde + Yüklenen + Hatalı. Dosyalar TEK TEK gönderilir; biri patlarsa
 *     diğerleri gider, hangisinin gitmediği görünür.
 *
 * Fotoğraf DEĞİL tarama: react-native-document-scanner-plugin kenarları bulur, perspektifi
 * düzeltir, kırpar (Android'de ML Kit Document Scanner, iOS'ta VisionKit).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import DocumentScanner, { ResponseType } from 'react-native-document-scanner-plugin';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

type Mukellef = { id: string; ad: string; vkn: string; defter: string; bas: string };
type Yon = 'ALIS' | 'SATIS';
type Belge = { anahtar: string; uri: string; ad: string; oncekiBayt: number; sonraBayt: number; secili: boolean };

const MB = 1024 * 1024;
const mb = (b: number) => `${(b / MB).toFixed(2)} MB`;

/** "2026-09" — belgeler gönderildiği ayın dönemine düşer. */
function buAy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function basHarfleri(ad: string) {
  const p = ad.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

/** Türkçe duyarlı arama: "İ/ı/ş/ğ" farkı yüzünden mükellef bulunamamasın. */
function sadelestir(s: string) {
  return String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

function defterAdi(t: any) {
  const dt = String(t?.defterTuru || (t?.mihsapDefterTuru === 'DEFTER_BEYAN' ? 'ISLETME' : t?.mihsapDefterTuru) || '');
  if (/BILANCO/i.test(dt)) return 'Bilanço';
  if (/ISLETME|BASIT/i.test(dt)) return 'İşletme';
  return '';
}

/** Dosya boyutu (bayt). Okunamazsa 0 — gösterimde "—" çıkar, akış durmaz. */
function boyut(uri: string): number {
  try {
    return Number(new File(uri).size) || 0;
  } catch {
    return 0;
  }
}

/**
 * Yüklemeden önce küçült. Fiş fotoğrafları 3-5 MB geliyor; 1600 px genişlik OCR için fazlasıyla
 * yeterli, kalite 0.7 ile dosya ~%80 küçülüyor. Küçültme başarısız olursa ORİJİNAL kullanılır
 * (belge kaybetmektense büyük göndermek yeğdir).
 */
async function hazirla(uri: string, sira: number): Promise<Belge> {
  const oncekiBayt = boyut(uri);
  let sonUri = uri;
  try {
    const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (r?.uri) sonUri = r.uri;
  } catch {
    /* küçültme olmadı — orijinali gönder */
  }
  const sonraBayt = boyut(sonUri) || oncekiBayt;
  return {
    anahtar: `${Date.now()}-${sira}-${Math.random().toString(36).slice(2, 7)}`,
    uri: sonUri,
    ad: `tarama-${new Date().toISOString().slice(0, 10)}-${sira}.jpg`,
    oncekiBayt,
    sonraBayt,
    secili: true,
  };
}

export default function TaraEkrani() {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState('');
  const [mukellefler, setMukellefler] = useState<Mukellef[]>([]);
  const [arama, setArama] = useState('');

  const [secili, setSecili] = useState<Mukellef | null>(null);
  const [yon, setYon] = useState<Yon | null>(null);
  const [belgeler, setBelgeler] = useState<Belge[]>([]);
  const [hazirlaniyor, setHazirlaniyor] = useState(false);
  const [sonuc, setSonuc] = useState('');

  // Yükleme ekranı
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [ilerleme, setIlerleme] = useState(0);
  const [basarili, setBasarili] = useState(0);
  const [basarisiz, setBasarisiz] = useState(0);

  const mukellefleriYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata('');
    try {
      const { data } = await api.get('/taxpayers');
      const arr: any[] = Array.isArray(data) ? data : data?.items || data?.data || data?.taxpayers || [];
      const liste = arr
        .map((t) => {
          const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '—').trim();
          return {
            id: String(t.id),
            ad,
            vkn: String(t.taxNumber || t.vergiKimlikNo || ''),
            defter: defterAdi(t),
            bas: basHarfleri(ad),
          };
        })
        .filter((t) => t.id && t.ad !== '—')
        .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
      setMukellefler(liste);
      if (!liste.length) setHata('Mükellef listesi boş geldi.');
    } catch (e: any) {
      setHata(
        e?.response?.status === 401
          ? 'Oturum yok. Önce MOREN uygulamasından giriş yapın.'
          : `Mükellefler alınamadı: ${e?.message || 'bağlantı hatası'}`,
      );
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    mukellefleriYukle();
  }, [mukellefleriYukle]);

  const suzulmus = useMemo(() => {
    const q = sadelestir(arama);
    if (!q) return mukellefler;
    return mukellefler.filter((m) => sadelestir(m.ad).includes(q) || m.vkn.includes(arama.trim()));
  }, [arama, mukellefler]);

  const seciliSayi = belgeler.filter((b) => b.secili).length;

  async function ekle(uriler: string[]) {
    if (!uriler.length) return;
    setHazirlaniyor(true);
    setSonuc('');
    try {
      const baslangic = belgeler.length;
      const yeni: Belge[] = [];
      for (let i = 0; i < uriler.length; i++) yeni.push(await hazirla(uriler[i], baslangic + i + 1));
      setBelgeler((s) => [...s, ...yeni]);
    } finally {
      setHazirlaniyor(false);
    }
  }

  async function tara() {
    try {
      const { scannedImages } = await DocumentScanner.scanDocument({
        maxNumDocuments: 25,
        croppedImageQuality: 100, // küçültmeyi BİZ yapıyoruz (hazirla) — burada kalite kaybetme
        responseType: ResponseType.ImageFilePath,
      });
      await ekle(scannedImages || []);
    } catch (e: any) {
      Alert.alert('Tarama açılamadı', String(e?.message || e));
    }
  }

  async function dosyaEkle() {
    try {
      const izin = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!izin.granted) {
        Alert.alert('İzin gerekli', 'Galeriden belge eklemek için fotoğraf izni verin.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1,
      });
      if (!r.canceled) await ekle(r.assets.map((a) => a.uri));
    } catch (e: any) {
      Alert.alert('Dosya eklenemedi', String(e?.message || e));
    }
  }

  function seciliDegistir(anahtar: string) {
    setBelgeler((s) => s.map((b) => (b.anahtar === anahtar ? { ...b, secili: !b.secili } : b)));
  }

  function tumunuDegistir() {
    const hepsiSecili = belgeler.length > 0 && belgeler.every((b) => b.secili);
    setBelgeler((s) => s.map((b) => ({ ...b, secili: !hepsiSecili })));
  }

  function seciliSil() {
    if (!seciliSayi) return;
    Alert.alert('Seçilenleri sil', `${seciliSayi} belge listeden çıkarılacak.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => setBelgeler((s) => s.filter((b) => !b.secili)) },
    ]);
  }

  /** TEK TEK gönderim: biri patlarsa diğerleri gider, hangisinin gitmediği sayılır. */
  async function gonder() {
    if (!secili || !yon) return;
    const gidecek = belgeler.filter((b) => b.secili);
    if (!gidecek.length) return;

    setGonderiliyor(true);
    setIlerleme(0);
    setBasarili(0);
    setBasarisiz(0);
    setSonuc('');

    const gidenAnahtarlar: string[] = [];
    let ok = 0;
    let hataAdet = 0;

    for (let i = 0; i < gidecek.length; i++) {
      const b = gidecek[i];
      try {
        const fd = new FormData();
        fd.append('files', { uri: b.uri, name: b.ad, type: 'image/jpeg' } as any);
        fd.append('taxpayerId', secili.id);
        fd.append('invoiceKind', yon);
        fd.append('source', 'mobil-tarayici');
        fd.append('documentType', 'OKC_FIS');
        fd.append('period', buAy());
        await api.post('/fatura-muhasebelestirme/documents/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,
        });
        ok++;
        setBasarili(ok);
        gidenAnahtarlar.push(b.anahtar);
      } catch {
        hataAdet++;
        setBasarisiz(hataAdet);
      }
      setIlerleme(((i + 1) / gidecek.length) * 100);
    }

    // Gidenler listeden düşer; GİTMEYENLER kalır → tekrar denenebilir.
    setBelgeler((s) => s.filter((b) => !gidenAnahtarlar.includes(b.anahtar)));
    setGonderiliyor(false);
    setSonuc(
      hataAdet
        ? `${ok} belge gönderildi · ${hataAdet} belge gitmedi (listede kaldı, tekrar deneyin)`
        : `${ok} belge gönderildi · ${secili.ad} · ${yon === 'ALIS' ? 'Gider' : 'Gelir'}`,
    );
  }

  // ───────────────────────── 1) MÜKELLEF SEÇ ─────────────────────────
  if (!secili) {
    return (
      <SafeAreaView style={s.kok}>
        <View style={s.baslikKutu}>
          <Text style={s.baslik}>Belge Tarayıcı</Text>
          <Text style={s.altBaslik}>Fiş ve faturaları tarayıp ofise gönderin</Text>
        </View>
        <View style={s.aramaKutu}>
          <TextInput
            style={s.arama}
            value={arama}
            onChangeText={setArama}
            placeholder="Mükellef ara (ad veya VKN)"
            placeholderTextColor={colors.textSoft}
            autoCorrect={false}
          />
        </View>
        {yukleniyor ? (
          <View style={s.orta}>
            <ActivityIndicator color={colors.gold} />
            <Text style={s.bilgi}>Mükellefler yükleniyor…</Text>
          </View>
        ) : hata ? (
          <View style={s.orta}>
            <Text style={s.hata}>{hata}</Text>
            <Pressable style={s.ikincilDugme} onPress={mukellefleriYukle}>
              <Text style={s.ikincilYazi}>Tekrar dene</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.liste} keyboardShouldPersistTaps="handled">
            {suzulmus.map((m) => (
              <Pressable key={m.id} style={s.satir} onPress={() => setSecili(m)}>
                <View style={s.rozet}>
                  <Text style={s.rozetYazi}>{m.bas}</Text>
                </View>
                <View style={s.satirMetin}>
                  <Text style={s.satirAd} numberOfLines={1}>
                    {m.ad}
                  </Text>
                  <Text style={s.satirVkn}>
                    {m.vkn}
                    {m.defter ? ` · ${m.defter}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
            {!suzulmus.length && <Text style={s.bilgi}>Eşleşen mükellef yok.</Text>}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // Mükellef kartı — her iki alt adımda da üstte durur (yanlış mükellefe gönderim en pahalı hata).
  const mukellefKarti = (
    <View style={s.kart}>
      <Pressable onPress={() => { setSecili(null); setYon(null); setBelgeler([]); setSonuc(''); }} hitSlop={10}>
        <Text style={s.kartGeri}>‹</Text>
      </Pressable>
      <View style={s.kartMetin}>
        <Text style={s.kartAd} numberOfLines={1}>
          {secili.ad}
        </Text>
        <Text style={s.kartAlt}>Vergi No: {secili.vkn || '—'}</Text>
        {!!secili.defter && <Text style={s.kartAlt}>Defter Türü: {secili.defter}</Text>}
      </View>
    </View>
  );

  // ───────────────────────── 2) YÖN SEÇ ─────────────────────────
  if (!yon) {
    return (
      <SafeAreaView style={s.kok}>
        {mukellefKarti}
        <Text style={[s.altBaslik, { paddingHorizontal: spacing.lg, paddingTop: spacing.md }]}>
          Belge hangi tarafa işlenecek?
        </Text>
        <View style={s.yonKutu}>
          <Pressable style={[s.yonDugme, { borderColor: colors.blue }]} onPress={() => setYon('ALIS')}>
            <Text style={[s.yonBaslik, { color: colors.blue }]}>Gider</Text>
            <Text style={s.yonAlt}>Alış faturası / fiş</Text>
          </Pressable>
          <Pressable style={[s.yonDugme, { borderColor: colors.green }]} onPress={() => setYon('SATIS')}>
            <Text style={[s.yonBaslik, { color: colors.green }]}>Gelir</Text>
            <Text style={s.yonAlt}>Satış faturası / fiş</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ───────────────────────── 3) BELGELER ─────────────────────────
  const yonRenk = yon === 'ALIS' ? colors.blue : colors.green;
  const hepsiSecili = belgeler.length > 0 && belgeler.every((b) => b.secili);

  return (
    <SafeAreaView style={s.kok}>
      {mukellefKarti}

      <View style={s.yonSerit}>
        <Text style={[s.yonEtiket, { color: yonRenk, borderColor: yonRenk }]}>
          {yon === 'ALIS' ? 'Gider · Alış' : 'Gelir · Satış'}
        </Text>
        <Pressable onPress={() => { setYon(null); setSonuc(''); }} hitSlop={10}>
          <Text style={s.degistir}>değiştir</Text>
        </Pressable>
      </View>

      {belgeler.length > 0 && (
        <>
          <Pressable style={s.silSerit} onPress={seciliSil} disabled={!seciliSayi}>
            <Text style={[s.silYazi2, !seciliSayi && s.pasifYazi]}>Seçilenleri Sil</Text>
          </Pressable>
          <View style={s.sayacSerit}>
            <View style={s.sayacKutu}>
              <Text style={s.sayacYazi}>
                {seciliSayi} / {belgeler.length}
              </Text>
            </View>
            <Pressable style={s.tumu} onPress={tumunuDegistir} hitSlop={8}>
              <View style={[s.kutucuk, hepsiSecili && s.kutucukDolu]}>
                {hepsiSecili && <Text style={s.kutucukTik}>✓</Text>}
              </View>
              <Text style={s.tumuYazi}>{hepsiSecili ? 'Tüm seçilenleri kaldır' : 'Tümünü seç'}</Text>
            </Pressable>
          </View>
        </>
      )}

      <ScrollView contentContainerStyle={s.belgeListe}>
        {belgeler.map((b) => (
          <Pressable
            key={b.anahtar}
            style={[s.belgeSatir, b.secili && { borderColor: yonRenk }]}
            onPress={() => seciliDegistir(b.anahtar)}
          >
            <View style={[s.kutucuk, b.secili && s.kutucukDolu]}>{b.secili && <Text style={s.kutucukTik}>✓</Text>}</View>
            <Image source={{ uri: b.uri }} style={s.belgeResim} resizeMode="cover" />
            <View style={s.belgeMetin}>
              <Text style={s.belgeAd} numberOfLines={1}>
                {b.ad}
              </Text>
              <Text style={s.belgeBoyut}>
                {b.oncekiBayt ? `${mb(b.oncekiBayt)} > ${mb(b.sonraBayt)}` : mb(b.sonraBayt)}
              </Text>
            </View>
          </Pressable>
        ))}

        {!belgeler.length && !hazirlaniyor && (
          <Text style={s.bilgi}>
            Henüz belge yok.{'\n'}“Belge Tara” ile kamerayı fişe tutun — kenarları kendisi bulur.
          </Text>
        )}
        {hazirlaniyor && (
          <View style={s.orta}>
            <ActivityIndicator color={colors.gold} />
            <Text style={s.bilgi}>Belgeler hazırlanıyor…</Text>
          </View>
        )}
        {!!sonuc && <Text style={s.basari}>{sonuc}</Text>}
      </ScrollView>

      <View style={s.altBar}>
        <Pressable style={s.ikincilDugme} onPress={dosyaEkle} disabled={hazirlaniyor}>
          <Text style={s.ikincilYazi}>Dosya Ekle</Text>
        </Pressable>
        <Pressable style={s.ikincilDugme} onPress={tara} disabled={hazirlaniyor}>
          <Text style={s.ikincilYazi}>Belge Tara</Text>
        </Pressable>
        <Pressable
          style={[s.anaDugme, (!seciliSayi || hazirlaniyor) && s.pasif]}
          onPress={gonder}
          disabled={!seciliSayi || hazirlaniyor}
        >
          <Text style={s.anaYazi}>{seciliSayi ? `Gönder (${seciliSayi})` : 'Gönder'}</Text>
        </Pressable>
      </View>

      <Modal visible={gonderiliyor} transparent animationType="fade">
        <View style={s.perde}>
          <View style={s.perdeKutu}>
            <ActivityIndicator color={colors.gold} size="large" />
            <Text style={s.perdeBaslik}>Belgeleriniz yükleniyor…</Text>
            <Text style={s.perdeYuzde}>%{ilerleme.toFixed(2)}</Text>
            <View style={s.perdeSayac}>
              <Text style={[s.perdeSayi, { color: colors.green }]}>Yüklenen: {basarili}</Text>
              <Text style={[s.perdeSayi, { color: colors.rose }]}>Hatalı: {basarisiz}</Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: colors.bg },
  baslikKutu: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 2 },
  baslik: { color: colors.text, fontSize: 21, fontWeight: '700' },
  altBaslik: { color: colors.textMuted, fontSize: 13 },

  aramaKutu: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  arama: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 9,
    fontSize: 15,
  },

  liste: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: 8 },
  satir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    padding: 12,
  },
  rozet: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  rozetYazi: { color: colors.gold, fontWeight: '700', fontSize: 13 },
  satirMetin: { flex: 1, minWidth: 0 },
  satirAd: { color: colors.text, fontSize: 15, fontWeight: '600' },
  satirVkn: { color: colors.textSoft, fontSize: 12, marginTop: 1 },

  kart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: spacing.md,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kartGeri: { color: colors.gold, fontSize: 26, paddingHorizontal: 4, marginTop: -3 },
  kartMetin: { flex: 1, minWidth: 0 },
  kartAd: { color: colors.text, fontSize: 17, fontWeight: '700' },
  kartAlt: { color: colors.textMuted, fontSize: 12.5, marginTop: 1 },

  yonSerit: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  yonEtiket: { fontSize: 12.5, fontWeight: '700', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  degistir: { color: colors.textSoft, fontSize: 12.5, textDecorationLine: 'underline' },

  yonKutu: { padding: spacing.lg, gap: 14 },
  yonDugme: { borderWidth: 1.5, borderRadius: radius.lg, paddingVertical: 26, alignItems: 'center', backgroundColor: colors.surface2, gap: 4 },
  yonBaslik: { fontSize: 22, fontWeight: '700' },
  yonAlt: { color: colors.textMuted, fontSize: 13 },

  silSerit: {
    marginHorizontal: spacing.lg,
    marginBottom: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: 'rgba(251,113,133,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.35)',
  },
  silYazi2: { color: colors.rose, fontSize: 14.5, fontWeight: '700' },
  pasifYazi: { opacity: 0.4 },

  sayacSerit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: 8 },
  sayacKutu: { backgroundColor: colors.surface3, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 6 },
  sayacYazi: { color: colors.text, fontSize: 15, fontWeight: '700' },
  tumu: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tumuYazi: { color: colors.textMuted, fontSize: 13 },

  kutucuk: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  kutucukDolu: { backgroundColor: colors.gold, borderColor: colors.gold },
  kutucukTik: { color: colors.black, fontSize: 14, fontWeight: '900', lineHeight: 16 },

  belgeListe: { paddingHorizontal: spacing.lg, paddingBottom: 130, gap: 8 },
  belgeSatir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    padding: 10,
  },
  belgeResim: { width: 44, height: 58, borderRadius: radius.sm, backgroundColor: colors.surface3 },
  belgeMetin: { flex: 1, minWidth: 0 },
  belgeAd: { color: colors.text, fontSize: 14, fontWeight: '600' },
  belgeBoyut: { color: colors.textSoft, fontSize: 12, marginTop: 2 },

  altBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ikincilDugme: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.surface2 },
  ikincilYazi: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  anaDugme: { flex: 1.2, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold },
  anaYazi: { color: colors.black, fontSize: 13.5, fontWeight: '700' },
  pasif: { opacity: 0.4 },

  perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  perdeKutu: { width: '100%', borderRadius: radius.lg, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, alignItems: 'center', gap: 10 },
  perdeBaslik: { color: colors.text, fontSize: 16, fontWeight: '700' },
  perdeYuzde: { color: colors.gold, fontSize: 22, fontWeight: '800' },
  perdeSayac: { flexDirection: 'row', gap: 18, marginTop: 2 },
  perdeSayi: { fontSize: 13.5, fontWeight: '700' },

  orta: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: spacing.xl },
  bilgi: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  hata: { color: colors.rose, fontSize: 14, textAlign: 'center' },
  basari: { color: colors.green, fontSize: 14, fontWeight: '600', marginTop: 8, textAlign: 'center' },
});
