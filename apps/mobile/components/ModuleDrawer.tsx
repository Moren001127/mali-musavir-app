import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { ChevronDown, ChevronUp, LogOut, X } from 'lucide-react-native';
import { AppAudience, getModuleNav, getModulesForAudience, groupModules } from '../lib/mobile-modules';
import { useAuth } from '../lib/auth';
import { colors, fonts, moduleAccents, radius, spacing, withAlpha } from '../lib/theme';

const SCREEN = Dimensions.get('window');
const PANEL_W = Math.min(326, Math.round(SCREEN.width * 0.85));

type DrawerCtxValue = { open: () => void; close: () => void };
const DrawerContext = createContext<DrawerCtxValue>({ open: () => {}, close: () => {} });

export function useDrawer() {
  return useContext(DrawerContext);
}

export function DrawerProvider({
  audience,
  children,
}: {
  audience: AppAudience;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const [visible, setVisible] = useState(false);
  const tx = useRef(new Animated.Value(-PANEL_W)).current;
  const fade = useRef(new Animated.Value(0)).current;

  const open = useCallback(() => {
    setVisible(true);
    Animated.parallel([
      Animated.timing(tx, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [tx, fade]);

  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(tx, { toValue: -PANEL_W, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setVisible(false));
  }, [tx, fade]);

  const go = useCallback(
    (route: string) => {
      close();
      setTimeout(() => router.push(route as any), 180);
    },
    [close],
  );

  const value = useMemo(() => ({ open, close }), [open, close]);

  const groups = groupModules(getModulesForAudience(audience));
  const company = auth.user?.companyName || auth.user?.firstName;

  return (
    <DrawerContext.Provider value={value}>
      <View style={styles.flex}>{children}</View>

      <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <Animated.View style={[styles.scrim, { opacity: fade }]}>
          <Pressable style={styles.flex} onPress={close} />
        </Animated.View>

        <Animated.View style={[styles.panel, { transform: [{ translateX: tx }] }]}>
          {/* başlık — logo + kimlik */}
          <View style={styles.header}>
            <Image source={require('../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
            <View style={styles.headerText}>
              <Text style={styles.brand}>Moren</Text>
              <Text style={styles.brandSub}>{audience === 'advisor' ? 'Mali Müşavirlik' : 'Mükellef Portalı'}</Text>
            </View>
            <Pressable onPress={close} style={styles.closeBtn} accessibilityLabel="Kapat">
              <X size={18} color={colors.textMuted} strokeWidth={2} />
            </Pressable>
          </View>

          {company ? (
            <View style={styles.userChip}>
              <Text style={styles.userChipText} numberOfLines={1}>
                {company}
              </Text>
            </View>
          ) : null}

          <ScrollView style={styles.flex} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {Object.entries(groups).map(([group, modules]) => (
              <DrawerGroup key={group} title={group} modules={modules} onGo={go} />
            ))}

            <Pressable onPress={() => { close(); setTimeout(() => auth.logout(), 180); }} style={styles.logout}>
              <LogOut size={17} color={colors.rose} strokeWidth={2} />
              <Text style={styles.logoutText}>Çıkış yap</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </Modal>
    </DrawerContext.Provider>
  );
}

function DrawerGroup({
  title,
  modules,
  onGo,
}: {
  title: string;
  modules: ReturnType<typeof getModulesForAudience>;
  onGo: (route: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <View style={styles.group}>
      <Pressable style={styles.groupHead} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.groupTitle}>{title}</Text>
        {open ? (
          <ChevronUp size={15} color={colors.textSoft} strokeWidth={2} />
        ) : (
          <ChevronDown size={15} color={colors.textSoft} strokeWidth={2} />
        )}
      </Pressable>

      {open
        ? modules.map((m) => {
            const nav = getModuleNav(m.id);
            const accent = moduleAccents[nav.color] || colors.gold;
            const Icon = m.icon;
            return (
              <Pressable
                key={m.id}
                onPress={() => onGo(nav.route)}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              >
                <View style={[styles.itemBar, { backgroundColor: accent }]} />
                <View style={[styles.itemIcon, { backgroundColor: withAlpha(accent, 0.16) }]}>
                  <Icon size={17} color={accent} strokeWidth={2} />
                </View>
                <Text style={styles.itemText} numberOfLines={1}>
                  {m.title}
                </Text>
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_W,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: 54,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  logo: { width: 46, height: 46 },
  headerText: { flex: 1 },
  brand: { color: colors.text, fontFamily: fonts.heading, fontSize: 22, fontWeight: '700' },
  brandSub: { color: colors.goldMuted, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  userChip: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.gold, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.25),
  },
  userChipText: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  group: { marginBottom: spacing.sm },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  groupTitle: {
    color: colors.textSoft,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  itemPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  itemBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3 },
  itemIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  itemText: { flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '600' },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginHorizontal: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.rose, 0.3),
    backgroundColor: withAlpha(colors.rose, 0.08),
  },
  logoutText: { color: colors.rose, fontSize: 13, fontWeight: '700' },
});
