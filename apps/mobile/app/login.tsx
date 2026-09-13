import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Mail, KeyRound, Eye, ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../lib/auth';
import { AppAudience } from '../lib/mobile-modules';
import { colors, fonts, radius, spacing, withAlpha } from '../lib/theme';

export default function LoginScreen() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ audience?: string }>();
  const audience: AppAudience = params.audience === 'taxpayer' ? 'taxpayer' : 'advisor';
  const advisor = audience === 'advisor';

  const [email, setEmail] = useState(advisor ? 'admin@morenmusavirlik.com' : '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    auth.setAudience(audience);
  }, [audience]);

  useEffect(() => {
    if (auth.status === 'authenticated') router.replace(auth.audience === 'advisor' ? '/(advisor)' : '/(taxpayer)');
  }, [auth.status, auth.audience]);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      await auth.login({ email: email.trim(), password, audience });
      router.replace(advisor ? '/(advisor)' : '/(taxpayer)');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Giriş bilgileri kontrol edilemedi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemo() {
    await auth.continueDemo(audience);
    router.replace(advisor ? '/(advisor)' : '/(taxpayer)');
  }

  return (
    <LinearGradient colors={['#0b0906', '#080706']} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.select({ ios: 'padding', android: undefined })}>
          <ScrollView contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Pressable style={styles.back} onPress={() => router.replace('/select')} hitSlop={10}>
              <ChevronLeft size={20} color={colors.text} />
            </Pressable>

            <Image source={require('../assets/moren-logo-gold.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.tagline}>Bugünü düzenler,</Text>
            <Text style={styles.taglineEm}>yarına güç katar.</Text>
            <Text style={styles.lead}>
              {advisor
                ? 'Mükellef takibinden beyanname yönetimine, KDV kontrolünden evrak arşivine kadar tüm süreçler tek platformda.'
                : 'Beyanname, cari ve evraklarınıza güvenle, her yerden erişin.'}
            </Text>

            <View style={styles.field}>
              <Text style={styles.label}>E-Posta Adresi</Text>
              <View style={styles.inp}>
                <Mail size={17} color={colors.textSoft} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="ornek@moren.com"
                  placeholderTextColor={colors.textSoft}
                  style={styles.inpText}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Şifre</Text>
              <View style={styles.inp}>
                <KeyRound size={17} color={colors.textSoft} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!show}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textSoft}
                  style={styles.inpText}
                />
                <Pressable onPress={() => setShow((s) => !s)} hitSlop={8}>
                  <Eye size={17} color={colors.textSoft} />
                </Pressable>
              </View>
            </View>

            <Text style={styles.forgot}>Şifremi unuttum</Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#141109" />
              ) : (
                <>
                  <Text style={styles.loginText}>Giriş Yap</Text>
                  <ChevronRight size={17} color="#141109" />
                </>
              )}
            </Pressable>

            <Pressable onPress={handleDemo} hitSlop={8}>
              <Text style={styles.demo}>Demo önizleme ile gir</Text>
            </Pressable>

            <View style={styles.chips}>
              <Text style={styles.chip}>⚡ Akıllı Otomasyon</Text>
              <Text style={styles.chip}>🛡️ KVKK Uyumlu</Text>
              <Text style={styles.chip}>🕐 7/24 Erişim</Text>
            </View>
            <View style={styles.ssl}>
              <ShieldCheck size={12} color={colors.textSoft} />
              <Text style={styles.sslText}>256-bit SSL ile korunmaktadır</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { padding: 26, paddingTop: 30, alignItems: 'center' },
  back: {
    position: 'absolute',
    top: 8,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.white, 0.04),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.14),
    zIndex: 5,
  },
  logo: { width: 172, height: 124, marginTop: 20 },
  tagline: { fontFamily: fonts.heading, fontSize: 23, fontWeight: '600', color: colors.text, marginTop: 16, textAlign: 'center' },
  taglineEm: { fontFamily: fonts.heading, fontSize: 23, fontWeight: '600', color: colors.gold, fontStyle: 'italic', textAlign: 'center' },
  lead: { color: colors.textMuted, fontSize: 12.5, lineHeight: 19, marginTop: 12, textAlign: 'center' },
  field: { width: '100%', marginTop: 16 },
  label: { fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.goldMuted, fontWeight: '600', marginBottom: 8 },
  inp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.14),
    borderRadius: 14,
    paddingHorizontal: 15,
    height: 50,
  },
  inpText: { flex: 1, color: colors.text, fontSize: 14 },
  forgot: { alignSelf: 'flex-end', color: colors.gold, fontSize: 12, marginTop: 12 },
  error: { color: colors.rose, fontSize: 13, marginTop: 12, alignSelf: 'flex-start' },
  loginBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.gold,
  },
  loginText: { color: '#141109', fontSize: 15, fontWeight: '600' },
  demo: { color: colors.textSoft, fontSize: 12.5, marginTop: 14, textDecorationLine: 'underline' },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 24 },
  chip: {
    fontSize: 10.5,
    color: colors.textMuted,
    backgroundColor: withAlpha(colors.white, 0.04),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.14),
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  ssl: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  sslText: { color: colors.textSoft, fontSize: 10.5 },
});
