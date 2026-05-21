import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LogOut } from 'lucide-react-native';
import { colors, fonts, radius, spacing } from '../lib/theme';
import { AppAudience } from '../lib/mobile-modules';

type TopBarProps = {
  title: string;
  subtitle?: string;
  audience: AppAudience;
  onLogout?: () => void;
};

export function TopBar({ title, subtitle, audience, onLogout }: TopBarProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.status}>
        <Text style={styles.time}>09:41</Text>
        <View style={styles.statusRight}>
          <Text style={styles.signal}>•••••</Text>
          <View style={styles.battery}>
            <View style={styles.batteryFill} />
          </View>
        </View>
      </View>

      <View style={styles.main}>
        <View style={styles.brand}>
          <LinearGradient colors={[colors.gold, colors.goldDeep]} style={styles.mark}>
            <Text style={styles.markText}>M</Text>
          </LinearGradient>
          <View style={styles.titleBlock}>
            <Text style={styles.kicker}>{audience === 'advisor' ? 'Müşavir girişi' : 'Mükellef girişi'}</Text>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        {onLogout ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Çıkış yap" onPress={onLogout} style={styles.logout}>
            <LogOut size={18} color={colors.gold} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  status: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  time: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signal: {
    color: colors.text,
    fontSize: 11,
  },
  battery: {
    width: 23,
    height: 11,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.text,
    padding: 2,
  },
  batteryFill: {
    width: '78%',
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  brand: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    color: colors.surface,
    fontFamily: fonts.heading,
    fontSize: 28,
    fontWeight: '800',
  },
  titleBlock: {
    flex: 1,
  },
  kicker: {
    color: colors.goldMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 2,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.heading,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12.5,
    marginTop: 2,
  },
  logout: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
