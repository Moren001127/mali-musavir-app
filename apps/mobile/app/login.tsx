import React, { useEffect, useMemo, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Fingerprint, LogIn, Sparkles } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { SegmentedControl } from '../components/SegmentedControl';
import { PrimaryButton } from '../components/PrimaryButton';
import { ModuleTile } from '../components/ModuleTile';
import { useAuth } from '../lib/auth';
import { AppAudience, getModulesForAudience } from '../lib/mobile-modules';
import { colors, fonts, radius, spacing } from '../lib/theme';

export default function LoginScreen() {
  const auth = useAuth();
  const [audience, setAudience] = useState<AppAudience>(auth.audience);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const previewModules = useMemo(
    () => getModulesForAudience(audience).filter((module) => module.priority === 'high').slice(0, 3),
    [audience],
  );

  useEffect(() => {
    if (auth.status === 'authenticated') {
      router.replace(auth.audience === 'advisor' ? '/(advisor)' : '/(taxpayer)');
    }
  }, [auth.audience, auth.status]);

  async function handleLogin() {
    setError(null);
    setLoading(true);

    try {
      await auth.login({ email: email.trim(), password, audience });
      router.replace(audience === 'advisor' ? '/(advisor)' : '/(taxpayer)');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Giriş bilgileri kontrol edilemedi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemo() {
    await auth.continueDemo(audience);
    router.replace(audience === 'advisor' ? '/(advisor)' : '/(taxpayer)');
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <Screen>
        <View style={styles.hero}>
          <Image source={require('../assets/logo-mark.png')} style={styles.logoImg} resizeMode="contain" />
          <Text style={styles.brandName}>Moren</Text>
          <Text style={styles.brandSub}>Mali Müşavirlik</Text>
          <View style={[styles.roleBadge, audience === 'taxpayer' && styles.roleBadgeTaxpayer]}>
            <Text style={styles.roleBadgeText}>{audience === 'advisor' ? 'Müşavir girişi' : 'Mükellef girişi'}</Text>
          </View>
        </View>

        <LinearGradient colors={['rgba(255,255,255,0.055)', 'rgba(255,255,255,0.02)']} style={styles.panel}>
          <SegmentedControl
            value={audience}
            onChange={(next) => {
              setAudience(next);
              auth.setAudience(next);
            }}
            options={[
              { value: 'advisor', label: 'Müşavir' },
              { value: 'taxpayer', label: 'Mükellef' },
            ]}
          />

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>E-posta</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="ornek@moren.com"
                placeholderTextColor={colors.textSoft}
                value={email}
                onChangeText={setEmail}
                style={styles.input}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Şifre</Text>
              <TextInput
                placeholder="••••••••"
                placeholderTextColor={colors.textSoft}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={[styles.input, password ? styles.inputFocused : null]}
              />
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton
            label={audience === 'advisor' ? 'Müşavir olarak gir' : 'Mükellef olarak gir'}
            loading={loading}
            disabled={!email.trim() || !password}
            onPress={handleLogin}
            icon={<LogIn size={18} color={colors.black} strokeWidth={2.2} />}
          />
          <PrimaryButton
            label="Demo önizleme"
            variant="secondary"
            onPress={handleDemo}
            icon={<Sparkles size={18} color={colors.gold} strokeWidth={2.2} />}
          />

          <View style={styles.biometric}>
            <View style={styles.biometricIcon}>
              <Fingerprint size={22} color={colors.gold} strokeWidth={2} />
            </View>
            <Text style={styles.biometricText}>FaceID / biyometrik giriş hazır</Text>
          </View>
        </LinearGradient>

        <View style={styles.preview}>
          <Text style={styles.sectionTitle}>
            {audience === 'advisor' ? 'Müşavir mobil öncelikleri' : 'Mükellef mobil öncelikleri'}
          </Text>
          {previewModules.map((module) => (
            <ModuleTile key={module.id} module={module} />
          ))}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  hero: {
    alignItems: 'center',
    gap: 5,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  logo: {
    width: 82,
    height: 82,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoImg: {
    width: 104,
    height: 84,
    marginBottom: spacing.sm,
  },
  logoText: {
    color: colors.surface,
    fontFamily: fonts.heading,
    fontSize: 48,
    fontWeight: '800',
  },
  brandName: {
    color: colors.text,
    fontFamily: fonts.heading,
    fontSize: 34,
    fontWeight: '700',
  },
  brandSub: {
    color: colors.goldMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
  },
  roleBadge: {
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(212,184,118,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(212,184,118,0.32)',
  },
  roleBadgeTaxpayer: {
    backgroundColor: 'rgba(96,165,250,0.13)',
    borderColor: 'rgba(96,165,250,0.32)',
  },
  roleBadgeText: {
    color: colors.gold,
    fontSize: 10.5,
    fontWeight: '800',
  },
  panel: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  form: {
    gap: spacing.sm,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: colors.textSoft,
    fontSize: 10.5,
    fontWeight: '800',
  },
  input: {
    height: 50,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    color: colors.text,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    fontSize: 15,
  },
  inputFocused: {
    borderColor: 'rgba(212,184,118,0.55)',
    backgroundColor: 'rgba(212,184,118,0.08)',
  },
  error: {
    color: colors.rose,
    fontSize: 13,
  },
  biometric: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  biometricIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212,184,118,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(212,184,118,0.28)',
  },
  biometricText: {
    color: colors.textSoft,
    fontSize: 11.5,
  },
  preview: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textSoft,
    fontSize: 11,
    fontWeight: '800',
  },
});
