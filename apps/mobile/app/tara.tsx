/**
 * BELGE TARAYICI — sade APK akışı (2026-09-23, Muzaffer Bey).
 *
 * "Portalın asıl mobil uygulaması çıkana kadar evrakları yüklemek için kullanacağımız bir şey."
 * Akış: Mükellef seç → Alış/Satış seç → kamerayı fişe tut (kenar bulan tarama) → Gönder.
 * Gönderilen belgeler Fatura İşleme Merkezi'nde ilgili mükellefin ALIŞ/SATIŞ kuyruğuna düşer.
 *
 * Fotoğraf DEĞİL tarama: react-native-document-scanner-plugin kenarları kendisi bulur,
 * perspektifi düzeltir ve kırpar (Android'de ML Kit Document Scanner).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

type Mukellef = { id: string; ad: string; vkn: string; bas: string };
type Yon = 'ALIS' | 'SATIS';

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

export default function TaraEkrani() {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState('');
  const [mukellefler, setMukellefler] = useState<Mukellef[]>([]);
  const [arama, setArama] = useState('');

  const [secili, setSecili] = useState<Mukellef | null>(null);
  const [yon, setYon] = useState<Yon | null>(null);
  const [sayfalar, setSayfalar] = useState<string[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState<string>('');

  const mukellefleriYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata('');
    try {
      const { data } = await api.get('/taxpayers');
      const arr: any[] = Array.isArray(data) ? data : data?.items || data?.data || data?.taxpayers || [];
      const liste = arr
        .map((t) => {
          const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '—').trim();
          return { id: String(t.id), ad, vkn: String(t.taxNumber || t.vergiKimlikNo || ''), bas: basHarfleri(ad) };
        })
        .filter((t) => t.id && t.ad !== '—')
        .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
      setMukellefler(liste);
      if (!liste.length) setHata('Mükellef listesi boş geldi.');
    } catch (e: any) {
      // 401 → api katmanı belirteci yeniler; yine olmuyorsa ana ekrandan giriş gerekir.
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

  async function tara() {
    try {
      // Kenar bulma + perspektif düzeltme + kırpma eklentinin kendi ekranında yapılır;
      //   kullanıcı köşeleri orada düzeltebilir. Biz yalnız dosya yolunu alıyoruz.
      const { scannedImages } = await DocumentScanner.scanDocument({
        maxNumDocuments: 25,
        croppedImageQuality: 92, // 100 gereksiz büyük dosya üretiyor; 92 okunaklı ve hızlı yüklenir
        responseType: ResponseType.ImageFilePath,
      });
      if (scannedImages?.length) setSayfalar((s) => [...s, ...scannedImages]);
    } catch (e: any) {
      Alert.alert('Tarama açılamadı', String(e?.message || e));
    }
  }

  function sayfaSil(i: number) {
    setSayfalar((s) => s.filter((_, k) => k !== i));
  }

  async function gonder() {
    if (!secili || !yon || !sayfalar.length) return;
    setGonderiliyor(true);
    setSonuc('');
    try {
      const fd = new FormData();
      sayfalar.forEach((uri, i) => {
        fd.append('files', {
          uri,
          name: `tarama-${Date.now()}-${i + 1}.jpg`,
          type: 'image/jpeg',
        } as any);
      });
      fd.append('taxpayerId', secili.id);
      fd.append('invoiceKind', yon);
      fd.append('source', 'mobil-tarayici');
      fd.append('documentType', 'OKC_FIS');
      fd.append('period', buAy());

      await api.post('/fatura-muhasebelestirme/documents/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      });

      const adet = sayfalar.length;
      setSayfalar([]);
      setSonuc(`${adet} belge gönderildi · ${secili.ad} · ${yon === 'ALIS' ? 'Alış' : 'Satış'}`);
    } catch (e: any) {
      const m = e?.response?.data?.message || e?.message || 'bilinmeyen hata';
      Alert.alert('Gönderilemedi', String(m));
    } finally {
      setGonderiliyor(false);
    }
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
                  {!!m.vkn && <Text style={s.satirVkn}>{m.vkn}</Text>}
                </View>
              </Pressable>
            ))}
            {!suzulmus.length && <Text style={s.bilgi}>Eşleşen mükellef yok.</Text>}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // ───────────────────────── 2) YÖN SEÇ ─────────────────────────
  if (!yon) {
    return (
      <SafeAreaView style={s.kok}>
        <View style={s.baslikKutu}>
          <Pressable onPress={() => setSecili(null)} hitSlop={12}>
            <Text style={s.geri}>‹ Mükellef değiştir</Text>
          </Pressable>
          <Text style={s.baslik} numberOfLines={2}>
            {secili.ad}
          </Text>
          <Text style={s.altBaslik}>Belge hangi tarafa işlenecek?</Text>
        </View>
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

  // ───────────────────────── 3) TARA ve GÖNDER ─────────────────────────
  const yonAd = yon === 'ALIS' ? 'Gider · Alış' : 'Gelir · Satış';
  return (
    <SafeAreaView style={s.kok}>
      <View style={s.baslikKutu}>
        <Pressable onPress={() => { setYon(null); setSonuc(''); }} hitSlop={12}>
          <Text style={s.geri}>‹ Yön değiştir</Text>
        </Pressable>
        <Text style={s.baslik} numberOfLines={1}>
          {secili.ad}
        </Text>
        <Text style={[s.altBaslik, { color: yon === 'ALIS' ? colors.blue : colors.green }]}>{yonAd}</Text>
      </View>

      <ScrollView contentContainerStyle={s.kucukResimler}>
        {sayfalar.map((uri, i) => (
          <View key={`${uri}-${i}`} style={s.kucukKutu}>
            <Image source={{ uri }} style={s.kucukResim} resizeMode="cover" />
            <Pressable style={s.sil} onPress={() => sayfaSil(i)} hitSlop={8}>
              <Text style={s.silYazi}>×</Text>
            </Pressable>
            <Text style={s.kucukNo}>{i + 1}</Text>
          </View>
        ))}
        {!sayfalar.length && (
          <Text style={s.bilgi}>
            Henüz belge yok. “Belge Tara” ile kamerayı fişe tutun; kenarları kendisi bulur.
          </Text>
        )}
        {!!sonuc && <Text style={s.basari}>{sonuc}</Text>}
      </ScrollView>

      <View style={s.altBar}>
        <Pressable style={s.ikincilDugme} onPress={tara} disabled={gonderiliyor}>
          <Text style={s.ikincilYazi}>Belge Tara</Text>
        </Pressable>
        <Pressable
          style={[s.anaDugme, (!sayfalar.length || gonderiliyor) && s.pasif]}
          onPress={gonder}
          disabled={!sayfalar.length || gonderiliyor}
        >
          {gonderiliyor ? (
            <ActivityIndicator color={colors.black} />
          ) : (
            <Text style={s.anaYazi}>{sayfalar.length ? `Gönder (${sayfalar.length})` : 'Gönder'}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: colors.bg },
  baslikKutu: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 2 },
  baslik: { color: colors.text, fontSize: 21, fontWeight: '700' },
  altBaslik: { color: colors.textMuted, fontSize: 13 },
  geri: { color: colors.gold, fontSize: 14, marginBottom: 6 },

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
  rozet: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rozetYazi: { color: colors.gold, fontWeight: '700', fontSize: 13 },
  satirMetin: { flex: 1, minWidth: 0 },
  satirAd: { color: colors.text, fontSize: 15, fontWeight: '600' },
  satirVkn: { color: colors.textSoft, fontSize: 12, marginTop: 1 },

  yonKutu: { padding: spacing.lg, gap: 14 },
  yonDugme: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingVertical: 26,
    alignItems: 'center',
    backgroundColor: colors.surface2,
    gap: 4,
  },
  yonBaslik: { fontSize: 22, fontWeight: '700' },
  yonAlt: { color: colors.textMuted, fontSize: 13 },

  kucukResimler: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: spacing.lg,
    paddingBottom: 120,
  },
  kucukKutu: {
    width: 96,
    height: 128,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface3,
  },
  kucukResim: { width: '100%', height: '100%' },
  sil: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  silYazi: { color: colors.white, fontSize: 17, lineHeight: 19, fontWeight: '700' },
  kucukNo: {
    position: 'absolute',
    bottom: 3,
    left: 5,
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    textShadowColor: '#000',
    textShadowRadius: 3,
  },

  altBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ikincilDugme: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.surface2,
  },
  ikincilYazi: { color: colors.text, fontSize: 15, fontWeight: '600' },
  anaDugme: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.gold,
  },
  anaYazi: { color: colors.black, fontSize: 15, fontWeight: '700' },
  pasif: { opacity: 0.4 },

  orta: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: spacing.lg },
  bilgi: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  hata: { color: colors.rose, fontSize: 14, textAlign: 'center' },
  basari: { color: colors.green, fontSize: 14, fontWeight: '600', width: '100%', marginTop: 4 },
});
