import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Camera, ImagePlus, UploadCloud } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../lib/auth';
import { colors, radius, spacing } from '../../lib/theme';

type StagedAsset = {
  uri: string;
  name: string;
};

export default function TaxpayerUploadScreen() {
  const auth = useAuth();
  const [assets, setAssets] = useState<StagedAsset[]>([]);

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: true,
    });
    if (!result.canceled) {
      setAssets((prev) => [
        ...prev,
        ...result.assets.map((asset, index) => ({
          uri: asset.uri,
          name: asset.fileName || `evrak-${Date.now()}-${index + 1}.jpg`,
        })),
      ]);
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setAssets((prev) => [...prev, { uri: asset.uri, name: asset.fileName || `kamera-${Date.now()}.jpg` }]);
    }
  }

  return (
    <Screen>
      <TopBar title="Evrak gönder" subtitle="Fatura, dekont ve belge" audience="taxpayer" onLogout={auth.logout} />

      <View style={styles.actions}>
        <PrimaryButton
          label="Kamera"
          onPress={takePhoto}
          icon={<Camera size={18} color={colors.black} strokeWidth={2.2} />}
          style={styles.button}
        />
        <PrimaryButton
          label="Galeri"
          variant="secondary"
          onPress={pickFromLibrary}
          icon={<ImagePlus size={18} color={colors.gold} strokeWidth={2.2} />}
          style={styles.button}
        />
      </View>

      <View style={styles.drop}>
        <UploadCloud size={34} color={colors.gold} strokeWidth={1.8} />
        <Text style={styles.dropTitle}>{assets.length ? `${assets.length} evrak hazır` : 'Evrak bekleniyor'}</Text>
        <Text style={styles.dropText}>Seçilen dosyalar mobil upload akışına hazırlanır.</Text>
      </View>

      <View style={styles.grid}>
        {assets.map((asset) => (
          <View key={asset.uri} style={styles.asset}>
            <Image source={{ uri: asset.uri }} style={styles.thumbnail} />
            <Text style={styles.assetName} numberOfLines={1}>{asset.name}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  button: {
    flex: 1,
  },
  drop: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dropTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  dropText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  asset: {
    width: '47%',
    gap: spacing.xs,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  assetName: {
    color: colors.textMuted,
    fontSize: 12,
  },
});

