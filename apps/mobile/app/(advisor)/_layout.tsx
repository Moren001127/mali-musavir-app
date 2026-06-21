import React, { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { Camera, CheckCircle2, Grid3X3, Home, MessageCircle } from 'lucide-react-native';
import { useAuth } from '../../lib/auth';
import { DrawerProvider } from '../../components/ModuleDrawer';
import { colors } from '../../lib/theme';

export default function AdvisorLayout() {
  const { status, audience } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && audience !== 'advisor') router.replace('/(taxpayer)');
  }, [audience, status]);

  return (
    <DrawerProvider audience="advisor">
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
        <Tabs.Screen name="modules" options={{ title: 'Modüller', tabBarIcon: ({ color }) => <Grid3X3 size={20} color={color} /> }} />
        <Tabs.Screen name="ofis" options={{ title: 'Ofis AI', tabBarIcon: ({ color }) => <MessageCircle size={20} color={color} /> }} />
        <Tabs.Screen name="onay" options={{ title: 'Onay', tabBarIcon: ({ color }) => <CheckCircle2 size={20} color={color} /> }} />
        <Tabs.Screen name="ocr" options={{ title: 'OCR', tabBarIcon: ({ color }) => <Camera size={20} color={color} /> }} />

        {/* tab çubuğunda gizli — modüllerden / panelden açılan ekranlar */}
        <Tabs.Screen name="mukellefler" options={{ href: null }} />
        <Tabs.Screen name="gorevler" options={{ href: null }} />
        <Tabs.Screen name="evraklar" options={{ href: null }} />
        <Tabs.Screen name="kdv-kontrol" options={{ href: null }} />
        <Tabs.Screen name="beyannameler" options={{ href: null }} />
        <Tabs.Screen name="fatura-merkezi" options={{ href: null }} />
        <Tabs.Screen name="cari-kasa" options={{ href: null }} />
        <Tabs.Screen name="banka-takip" options={{ href: null }} />
        <Tabs.Screen name="mali-tablolar" options={{ href: null }} />
        <Tabs.Screen name="mizan" options={{ href: null }} />
        <Tabs.Screen name="gelir-tablosu" options={{ href: null }} />
        <Tabs.Screen name="bilanco" options={{ href: null }} />
        <Tabs.Screen name="e-defter" options={{ href: null }} />
        <Tabs.Screen name="sgk" options={{ href: null }} />
        <Tabs.Screen name="ajanlar" options={{ href: null }} />
        <Tabs.Screen name="bildirimler" options={{ href: null }} />
      </Tabs>
    </DrawerProvider>
  );
}
