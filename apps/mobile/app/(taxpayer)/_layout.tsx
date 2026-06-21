import React, { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { FileArchive, Grid3X3, Home, MessageCircle, Sparkles } from 'lucide-react-native';
import { useAuth } from '../../lib/auth';
import { DrawerProvider } from '../../components/ModuleDrawer';
import { colors } from '../../lib/theme';

export default function TaxpayerLayout() {
  const { status, audience } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && audience !== 'taxpayer') router.replace('/(advisor)');
  }, [audience, status]);

  return (
    <DrawerProvider audience="taxpayer">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.gold,
          tabBarInactiveTintColor: colors.textSoft,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: 64,
            paddingBottom: 8,
            paddingTop: 8,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Özet', tabBarIcon: ({ color }) => <Home size={20} color={color} /> }} />
        <Tabs.Screen name="moduller" options={{ title: 'Bölümler', tabBarIcon: ({ color }) => <Grid3X3 size={20} color={color} /> }} />
        <Tabs.Screen name="belgeler" options={{ title: 'Belgeler', tabBarIcon: ({ color }) => <FileArchive size={20} color={color} /> }} />
        <Tabs.Screen name="asistan" options={{ title: 'Asistan', tabBarIcon: ({ color }) => <Sparkles size={20} color={color} /> }} />
        <Tabs.Screen name="mesaj" options={{ title: 'Mesaj', tabBarIcon: ({ color }) => <MessageCircle size={20} color={color} /> }} />

        {/* tab çubuğunda gizli — özet / bölümlerden açılan ekranlar */}
        <Tabs.Screen name="evrak" options={{ href: null }} />
        <Tabs.Screen name="beyannameler" options={{ href: null }} />
        <Tabs.Screen name="faturalar" options={{ href: null }} />
        <Tabs.Screen name="kdv" options={{ href: null }} />
        <Tabs.Screen name="cari" options={{ href: null }} />
        <Tabs.Screen name="tebligat" options={{ href: null }} />
        <Tabs.Screen name="sgk" options={{ href: null }} />
        <Tabs.Screen name="takvim" options={{ href: null }} />
      </Tabs>
    </DrawerProvider>
  );
}
