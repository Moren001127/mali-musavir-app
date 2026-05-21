import React, { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { Camera, CheckCircle2, Grid3X3, Home, MessageCircle, Users } from 'lucide-react-native';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function AdvisorLayout() {
  const { status, audience } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && audience !== 'advisor') router.replace('/(taxpayer)');
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
      <Tabs.Screen name="ocr" options={{ title: 'OCR', tabBarIcon: ({ color }) => <Camera size={20} color={color} /> }} />
      <Tabs.Screen name="ofis" options={{ title: 'Ofis AI', tabBarIcon: ({ color }) => <MessageCircle size={20} color={color} /> }} />
      <Tabs.Screen name="onay" options={{ title: 'Onay', tabBarIcon: ({ color }) => <CheckCircle2 size={20} color={color} /> }} />
      <Tabs.Screen name="mukellefler" options={{ title: 'Mükellef', tabBarIcon: ({ color }) => <Users size={20} color={color} /> }} />
      <Tabs.Screen name="modules" options={{ href: null, title: 'Modüller', tabBarIcon: ({ color }) => <Grid3X3 size={20} color={color} /> }} />
    </Tabs>
  );
}
