import React, { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../lib/theme';

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  flush?: boolean;
}>;

export function Screen({ children, scroll = true, flush = false }: ScreenProps) {
  const body = scroll ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, flush && styles.flushContent]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.container, flush && styles.flushContent]}>{children}</View>
  );

  return (
    <LinearGradient colors={[colors.bgTop, colors.bg]} style={styles.gradient}>
      <SafeAreaView style={styles.safe}>{body}</SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl + 94,
    gap: spacing.lg,
  },
  flushContent: {
    padding: 0,
  },
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: 'transparent',
  },
});
