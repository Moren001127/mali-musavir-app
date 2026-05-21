import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { colors, fonts, radius, spacing } from '../lib/theme';
import { MobileModule, ModuleStatus } from '../lib/mobile-modules';
import { StatusPill } from './StatusPill';

const statusLabel: Record<ModuleStatus, string> = {
  live: 'Portalda canlı',
  'mobile-ready': 'Mobil hazır',
  prep: 'Hazırlık',
};

const statusTone: Record<ModuleStatus, 'green' | 'gold' | 'blue'> = {
  live: 'green',
  'mobile-ready': 'gold',
  prep: 'blue',
};

export function ModuleTile({ module, onPress }: { module: MobileModule; onPress?: () => void }) {
  const Icon = module.icon;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <LinearGradient colors={['rgba(255,255,255,0.045)', 'rgba(255,255,255,0.02)']} style={styles.tile}>
        <View style={styles.iconWrap}>
          <Icon size={19} color={colors.gold} strokeWidth={2} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{module.title}</Text>
            <StatusPill label={statusLabel[module.status]} tone={statusTone[module.status]} />
          </View>
          <Text style={styles.subtitle}>{module.subtitle}</Text>
          {module.apiPath ? <Text style={styles.path}>{module.apiPath}</Text> : null}
        </View>
        <ChevronRight size={17} color={colors.textSoft} strokeWidth={2} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ translateY: 1 }],
  },
  iconWrap: {
    width: 39,
    height: 39,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212,184,118,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(212,184,118,0.22)',
  },
  body: {
    flex: 1,
    gap: 5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  path: {
    color: colors.textSoft,
    fontSize: 10.5,
    fontFamily: fonts.mono,
  },
});
