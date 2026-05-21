import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Camera, ImagePlus, Search, Send, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusPill } from '../../components/StatusPill';
import { CompanyHero, PremiumCard, QuickAction, ScanFrame, SectionLabel } from '../../components/Premium';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { taxpayerRows } from '../../lib/sample-data';
import { colors, fonts, radius, spacing } from '../../lib/theme';

type InvoiceKind = 'ALIS' | 'SATIS';
type TaxpayerRow = {
  id: string;
  name?: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  taxNumber?: string;
  status?: string;
};

type StagedAsset = {
  uri: string;
  name: string;
  type: string;
};

function displayName(row: TaxpayerRow) {
  return row.name || row.companyName || [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Mükellef';
}

function initials(row: TaxpayerRow) {
  return displayName(row)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR');
}

function currentPeriodLabel() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdvisorOcrScreen() {
  const auth = useAuth();
  const [search, setSearch] = useState('');
  const [selectedTaxpayer, setSelectedTaxpayer] = useState<TaxpayerRow | null>(null);
  const [invoiceKind, setInvoiceKind] = useState<InvoiceKind>('ALIS');
  const [assets, setAssets] = useState<StagedAsset[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;

  const taxpayers = useQuery({
    queryKey: ['ocr-taxpayers', search],
    enabled,
    queryFn: () => api.get('/taxpayers', { params: { search } }).then((res) => res.data as TaxpayerRow[]),
  });

  const filteredTaxpayers = useMemo(() => {
    const source = taxpayers.data?.length ? taxpayers.data : taxpayerRows;
    const needle = search.trim().toLocaleLowerCase('tr-TR');
    if (!needle || taxpayers.data?.length) return source.slice(0, 5);
    return source.filter((row) => displayName(row).toLocaleLowerCase('tr-TR').includes(needle)).slice(0, 5);
  }, [search, taxpayers.data]);

  const upload = useMutation({
    mutationFn: async () => {
      if (!selectedTaxpayer || assets.length === 0) return null;

      if (auth.user?.isDemo) {
        return { uploaded: assets.length, documents: assets.map((asset) => ({ originalName: asset.name })) };
      }

      const form = new FormData();
      form.append('taxpayerId', selectedTaxpayer.id);
      form.append('source', 'mobile-ocr');
      form.append('documentType', 'OKC_FIS');
      form.append('invoiceKind', invoiceKind);
      form.append('periodLabel', currentPeriodLabel());

      assets.forEach((asset) => {
        form.append('files', {
          uri: asset.uri,
          name: asset.name,
          type: asset.type,
        } as any);
      });

      const { data } = await api.post('/fatura-muhasebelestirme/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: (data) => {
      const count = data?.uploaded ?? assets.length;
      setUploadMessage(`${count} görüntü ${selectedTaxpayer ? displayName(selectedTaxpayer) : 'mükellef'} için portala gönderildi.`);
      setAssets([]);
    },
    onError: () => {
      setUploadMessage('Görüntüler portala gönderilemedi. Bağlantıyı ve yetkiyi kontrol edin.');
    },
  });

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsMultipleSelection: true,
    });
    if (!result.canceled) {
      setUploadMessage(null);
      setAssets((prev) => [
        ...prev,
        ...result.assets.map((asset, index) => ({
          uri: asset.uri,
          name: asset.fileName || `mobil-ocr-${Date.now()}-${index + 1}.jpg`,
          type: asset.mimeType || 'image/jpeg',
        })),
      ]);
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setUploadMessage(null);
      setAssets((prev) => [
        ...prev,
        {
          uri: asset.uri,
          name: asset.fileName || `mobil-ocr-kamera-${Date.now()}.jpg`,
          type: asset.mimeType || 'image/jpeg',
        },
      ]);
    }
  }

  function removeAsset(uri: string) {
    setAssets((prev) => prev.filter((asset) => asset.uri !== uri));
  }

  const selectedName = selectedTaxpayer ? displayName(selectedTaxpayer) : 'Önce mükellef seçin';

  return (
    <Screen>
      <TopBar title="Anlık fiş yakala" subtitle="Mükellef seç, tara, portala düşür" audience="advisor" onLogout={auth.logout} />

      {selectedTaxpayer ? (
        <CompanyHero
          label="Seçili mükellef"
          name={displayName(selectedTaxpayer)}
          meta={[selectedTaxpayer.taxNumber ? `VKN: ${selectedTaxpayer.taxNumber}` : 'VKN bekleniyor', invoiceKind === 'ALIS' ? '191 Alış' : '391 Satış', currentPeriodLabel()]}
        />
      ) : (
        <PremiumCard tone="gold" style={styles.selectHero}>
          <Text style={styles.heroKicker}>OCR hedefi</Text>
          <Text style={styles.heroTitle}>Görüntüler portala seçtiğiniz mükellefin altında düşer</Text>
          <Text style={styles.heroText}>Arama yapıp firmayı seçin, sonra kamera veya galeriden belge ekleyin.</Text>
        </PremiumCard>
      )}

      <SectionLabel label="Mükellef seçimi" right={taxpayers.isFetching ? 'Aranıyor' : `${filteredTaxpayers.length} sonuç`} />
      <PremiumCard tone="blue" style={styles.searchCard}>
        <View style={styles.searchWrap}>
          <Search size={18} color={colors.textSoft} strokeWidth={2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Unvan, VKN veya ad ara"
            placeholderTextColor={colors.textSoft}
            style={styles.searchInput}
          />
        </View>
        <View style={styles.taxpayerList}>
          {filteredTaxpayers.map((row) => {
            const selected = selectedTaxpayer?.id === row.id;
            return (
              <Pressable
                accessibilityRole="button"
                key={row.id}
                onPress={() => setSelectedTaxpayer(row)}
                style={[styles.taxpayerRow, selected && styles.taxpayerRowSelected]}
              >
                <View style={[styles.avatar, selected && styles.avatarSelected]}>
                  <Text style={[styles.avatarText, selected && styles.avatarTextSelected]}>{initials(row)}</Text>
                </View>
                <View style={styles.taxpayerBody}>
                  <Text style={styles.taxpayerName}>{displayName(row)}</Text>
                  <Text style={styles.taxpayerMeta}>{row.status || row.taxNumber || 'VKN/TCKN bekleniyor'}</Text>
                </View>
                {selected ? <StatusPill label="Seçili" tone="gold" /> : null}
              </Pressable>
            );
          })}
        </View>
      </PremiumCard>

      <SectionLabel label="Tarama türü" right="Portala OCR kuyruğu" />
      <PremiumCard tone="gold" style={styles.kindCard}>
        <SegmentedControl
          value={invoiceKind}
          onChange={setInvoiceKind}
          options={[
            { value: 'ALIS', label: 'Alış / 191' },
            { value: 'SATIS', label: 'Satış / 391' },
          ]}
        />
      </PremiumCard>

      <ScanFrame
        title={assets.length ? `${assets.length} görüntü hazır` : selectedName}
        subtitle={selectedTaxpayer ? `${displayName(selectedTaxpayer)} için fişi çerçeveye sığdırın` : 'Fişi çerçeveye sığdırın, önce mükellefi seçin'}
        count={assets.length}
      />

      <View style={styles.quickGrid}>
        <QuickAction label="Kamera" Icon={Camera} active onPress={takePhoto} />
        <QuickAction label="Galeri" Icon={ImagePlus} tone="blue" onPress={pickFromLibrary} />
      </View>

      <PrimaryButton
        label="Portala gönder ve OCR başlat"
        disabled={!selectedTaxpayer || assets.length === 0}
        loading={upload.isPending}
        onPress={() => upload.mutate()}
        icon={<Send size={18} color={colors.black} strokeWidth={2.2} />}
      />

      {assets.length ? (
        <>
          <SectionLabel label="Hazır görüntüler" right={`${assets.length} dosya`} />
          <View style={styles.grid}>
            {assets.map((asset) => (
              <View key={asset.uri} style={styles.asset}>
                <Image source={{ uri: asset.uri }} style={styles.thumbnail} />
                <Pressable accessibilityRole="button" onPress={() => removeAsset(asset.uri)} style={styles.remove}>
                  <X size={14} color={colors.text} strokeWidth={2.4} />
                </Pressable>
                <Text style={styles.assetName} numberOfLines={1}>
                  {asset.name}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {uploadMessage ? <Text style={styles.uploadMessage}>{uploadMessage}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  selectHero: {
    gap: spacing.xs,
  },
  heroKicker: {
    color: colors.goldMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: colors.text,
    fontFamily: fonts.heading,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 26,
  },
  heroText: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  searchCard: {
    gap: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  searchInput: {
    flex: 1,
    height: 46,
    color: colors.text,
    fontSize: 15,
  },
  taxpayerList: {
    gap: spacing.sm,
  },
  taxpayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  taxpayerRowSelected: {
    borderColor: 'rgba(212,184,118,0.55)',
    backgroundColor: 'rgba(212,184,118,0.12)',
  },
  avatar: {
    width: 39,
    height: 39,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  avatarSelected: {
    backgroundColor: colors.gold,
  },
  avatarText: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '800',
  },
  avatarTextSelected: {
    color: colors.surface,
  },
  taxpayerBody: {
    flex: 1,
  },
  taxpayerName: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '800',
  },
  taxpayerMeta: {
    color: colors.textSoft,
    fontSize: 11,
    marginTop: 2,
  },
  kindCard: {
    padding: spacing.sm,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  asset: {
    width: '47%',
    gap: spacing.xs,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 0.78,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  remove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  assetName: {
    color: colors.textMuted,
    fontSize: 11,
  },
  uploadMessage: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '800',
  },
});
