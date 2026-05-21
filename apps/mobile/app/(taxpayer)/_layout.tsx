import React, { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { FileArchive, Home, MessageCircle, UploadCloud } from 'lucide-react-native';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function TaxpayerLayout() {
  const { status, audience } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && audience !== 'taxpayer') router.replace('/(advisor)');
  }, [audience, status]);

  return (
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
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Özet', tabBarIcon: ({ color }) => <Home size={20} color={color} /> }} />
      <Tabs.Screen name="evrak" options={{ title: 'Evrak', tabBarIcon: ({ color }) => <UploadCloud size={20} color={color} /> }} />
      <Tabs.Screen name="belgeler" options={{ title: 'Belgeler', tabBarIcon: ({ color }) => <FileArchive size={20} color={color} /> }} />
      <Tabs.Screen name="mesaj" options={{ title: 'Mesaj', tabBarIcon: ({ color }) => <MessageCircle size={20} color={color} /> }} />
    </Tabs>
  );
}

