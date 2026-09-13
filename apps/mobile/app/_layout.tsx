import React, { useState } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { colors } from '../lib/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  const stack = <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
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
      </QueryClientProvider>
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
