import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, LayoutGrid, ScanLine, Check, Bot, LucideIcon } from 'lucide-react-native';
import { colors, withAlpha } from '../lib/theme';

type Item = { name: string; label: string; icon: LucideIcon; fab?: boolean };

// HTML tasarımıyla birebir: Özet · Modüller · [OCR FAB] · Onay · AI
const ADVISOR: Item[] = [
  { name: 'index', label: 'Özet', icon: Home },
  { name: 'modules', label: 'Modüller', icon: LayoutGrid },
  { name: 'ocr', label: '', icon: ScanLine, fab: true },
  { name: 'onay', label: 'Onay', icon: Check },
  { name: 'ofis', label: 'AI', icon: Bot },
];

export function FloatingTabBar({ state, navigation, items = ADVISOR }: any) {
  const insets = useSafeAreaInsets();
  const activeName = state?.routes?.[state.index]?.name;

  return (
    <View pointerEvents="box-none" style={[styles.host, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        {(items as Item[]).map((it) => {
          const focused = activeName === it.name;
          if (it.fab) {
            return (
              <Pressable key={it.name} onPress={() => navigation.navigate(it.name)} style={styles.fabWrap}>
                <LinearGradient colors={['#e7d3a1', '#d4b876']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.fab}>
                  <it.icon size={24} color="#141109" />
                </LinearGradient>
              </Pressable>
            );
          }
          return (
            <Pressable key={it.name} onPress={() => navigation.navigate(it.name)} style={styles.tab}>
              {focused ? <View style={styles.indicator} /> : null}
              <it.icon size={22} color={focused ? colors.gold : colors.textSoft} />
              <Text style={[styles.label, { color: focused ? colors.gold : colors.textSoft }]}>{it.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  bar: {
    height: 70,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    backgroundColor: 'rgba(16,13,9,0.92)',
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.28),
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  indicator: { position: 'absolute', top: -1, width: 26, height: 3, borderRadius: 999, backgroundColor: colors.gold },
  label: { fontSize: 10, fontWeight: '600' },
  fabWrap: { width: 62, alignItems: 'center' },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -30,
    shadowColor: colors.gold,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
});
