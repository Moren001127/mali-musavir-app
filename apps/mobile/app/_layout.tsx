import React from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { colors } from '../lib/theme';

// TEK EKRAN: app/index.tsx (tam ekran WebView köprüsü). Elle port edilmiş eski ekranlar
// (app/(advisor), app/(taxpayer), login, select) 2026-09-13'te kaldırıldı — tasarımın tek kaynağı assets/app.html.
export default function RootLayout() {
  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
    </Stack>
  );

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" backgroundColor={colors.bg} />
        {Platform.OS === 'web' ? (
          <View style={styles.webOuter}>
            <View style={styles.webPhone}>{stack}</View>
          </View>
        ) : (
          stack
        )}
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// Web önizlemede uygulamayı ortada telefon genişliğinde göster (gerçek cihazda native tam ekran).
const styles = StyleSheet.create({
  webOuter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050403',
    paddingVertical: 16,
  },
  webPhone: {
    width: 390,
    height: 820,
    maxHeight: '96%',
    borderRadius: 42,
    overflow: 'hidden',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: 'rgba(212,184,118,0.18)',
  },
});
