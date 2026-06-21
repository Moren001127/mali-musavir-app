import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { FileSpreadsheet, LineChart, Scale } from 'lucide-react-native';
import { Screen } from '../../components/Screen';
import { ColorStrip, ListRow, ModuleHeader, SectionLabel } from '../../components/ModuleKit';
import { colors, spacing } from '../../lib/theme';

const COLOR = 'blue' as const;

export default function MaliTablolarScreen() {
  return (
    <Screen>
      <ColorStrip color={COLOR} color2="steel" />
      <ModuleHeader
        eyebrow="‹ Mali Veriler"
        title="Mali Tablolar"
        subtitle="Mizan, gelir tablosu ve bilanço"
        color={COLOR}
        onBack={() => router.back()}
      />

      <View style={{ gap: spacing.sm }}>
        <SectionLabel label="Tablolar" />
        <ListRow
          color={COLOR}
          icon={<Scale size={17} color={colors.blue} strokeWidth={2} />}
          title="Mizan"
          subtitle="Hesap bazlı borç/alacak bakiyeleri"
          onPress={() => router.push('/(advisor)/mizan')}
        />
        <ListRow
          color={COLOR}
          icon={<LineChart size={17} color={colors.blue} strokeWidth={2} />}
          title="Gelir Tablosu"
          subtitle="Brüt satıştan dönem net karına"
          onPress={() => router.push('/(advisor)/gelir-tablosu')}
        />
        <ListRow
          color={COLOR}
          icon={<FileSpreadsheet size={17} color={colors.blue} strokeWidth={2} />}
          title="Bilanço"
          subtitle="Aktif / Pasif denge tablosu"
          onPress={() => router.push('/(advisor)/bilanco')}
        />
      </View>
    </Screen>
  );
}
