import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Screen } from '../../components/Screen';
import { colors, fonts, radius, withAlpha } from '../../lib/theme';

const MODES = ['Tekli', 'Toplu', 'Galeriden'];

export default function OcrScreen() {
  const [mode, setMode] = useState(0);
  return (
    <Screen scroll={false}>
      <View style={styles.head}>
        <Text style={styles.title}>Belge Tara</Text>
        <Text style={styles.sub}>Fatura / fiş · anında OCR</Text>
      </View>

      <View style={styles.camera}>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
        <View style={styles.hint}>
          <Text style={styles.hintTitle}>Belgeyi çerçeveye hizala</Text>
          <Text style={styles.hintSub}>Mihsap tutarı, VKN'yi ve hesabı okur</Text>
        </View>
      </View>

      <View style={styles.seg}>
        {MODES.map((m, i) => (
          <Pressable key={m} onPress={() => setMode(i)} style={[styles.segBtn, mode === i && styles.segBtnOn]}>
            <Text style={[styles.segText, mode === i && styles.segTextOn]}>{m}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.shutterWrap}>
        <Pressable style={styles.shutter}>
          <View style={styles.shutterInner} />
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginBottom: 4 },
  title: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '600', color: colors.text },
  sub: { fontSize: 11.5, color: colors.textSoft, marginTop: 2 },
  camera: { flex: 1, borderRadius: radius.xxl, borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), backgroundColor: '#0a0806', alignItems: 'center', justifyContent: 'center', marginTop: 12, overflow: 'hidden' },
  frame: { position: 'absolute', top: 34, left: 34, right: 34, bottom: 34 },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: colors.gold },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  hint: { alignItems: 'center', paddingHorizontal: 40 },
  hintTitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  hintSub: { fontSize: 11.5, color: colors.textSoft, textAlign: 'center', marginTop: 4 },
  seg: { flexDirection: 'row', backgroundColor: withAlpha(colors.white, 0.04), borderWidth: 1, borderColor: withAlpha(colors.gold, 0.14), borderRadius: radius.lg, padding: 4, marginTop: 12 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.gold },
  segText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  segTextOn: { color: '#141109' },
  shutterWrap: { alignItems: 'center', marginTop: 16 },
  shutter: { width: 66, height: 66, borderRadius: 33, borderWidth: 4, borderColor: withAlpha(colors.gold, 0.35), alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.gold },
});
