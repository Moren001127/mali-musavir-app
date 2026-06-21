import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import {
  ChatBubble,
  ChatComposer,
  ColorStrip,
  LoadingBlock,
  ModuleHeader,
} from '../../components/ModuleKit';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { spacing } from '../../lib/theme';

const COLOR = 'rose' as const;

type Msg = { role: 'ai' | 'me'; text: string; time?: string };

function clock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TaxpayerAsistanScreen() {
  const auth = useAuth();
  const enabled = auth.status === 'authenticated' && !auth.user?.isDemo;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const gecmis = useQuery({
    queryKey: ['portal-ai-gecmis'],
    enabled,
    queryFn: () => api.get('/portal/ai/gecmis').then((r) => r.data as any[]),
  });

  useEffect(() => {
    if (!enabled) {
      setMessages(DEMO);
      return;
    }
    if (gecmis.data) {
      const mapped: Msg[] = gecmis.data.map((m: any) => ({
        role: m?.role === 'user' || m?.role === 'me' ? 'me' : 'ai',
        text: m?.text || m?.mesaj || m?.cevap || '',
      }));
      setMessages(mapped.length ? mapped : [WELCOME]);
    }
  }, [enabled, gecmis.data]);

  const send = useMutation({
    mutationFn: (message: string) =>
      api
        .post('/portal/ai/chat', {
          message,
          history: messages.slice(-8).map((m) => ({ role: m.role === 'me' ? 'user' : 'assistant', text: m.text })),
        })
        .then((r) => r.data as { reply: string }),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: 'ai', text: data?.reply || 'Yanıt alınamadı.', time: clock() }]);
    },
    onError: () => {
      setMessages((prev) => [...prev, { role: 'ai', text: 'Şu anda yanıt veremiyorum, lütfen birazdan tekrar deneyin.', time: clock() }]);
    },
  });

  function onSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setMessages((prev) => [...prev, { role: 'me', text, time: clock() }]);
    if (enabled) {
      send.mutate(text);
    } else {
      setMessages((prev) => [...prev, { role: 'ai', text: 'Demo modunda örnek yanıt: gerçek girişte size özel verilerinizle yanıtlarım.', time: clock() }]);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, send.isPending]);

  return (
    <Screen scroll={false}>
      <ColorStrip color={COLOR} color2="blue" />
      <ModuleHeader
        eyebrow="Moren AI"
        title="Asistan"
        subtitle="Size özel · yalnızca kendi verileriniz"
        color={COLOR}
      />

      {enabled && gecmis.isLoading ? (
        <LoadingBlock color={COLOR} label="Sohbet yükleniyor…" />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.select({ ios: 'padding', android: undefined })}
          keyboardVerticalOffset={90}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.chatBody}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((m, i) => (
              <ChatBubble key={i} role={m.role} time={m.time} color={COLOR}>
                {m.text}
              </ChatBubble>
            ))}
            {send.isPending ? (
              <ChatBubble role="ai" color={COLOR}>
                Yazıyor…
              </ChatBubble>
            ) : null}
          </ScrollView>

          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={onSend}
            placeholder="Sorunuzu yazın…"
            color={COLOR}
            sending={send.isPending}
          />
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

const WELCOME: Msg = {
  role: 'ai',
  text: 'Merhaba! Beyanname, KDV durumu, cari hesabınız veya belgeleriniz hakkında soru sorabilirsiniz.',
};

const DEMO: Msg[] = [
  WELCOME,
  { role: 'me', text: 'Bu ay ne kadar ödeyeceğim?', time: '09:21' },
  {
    role: 'ai',
    text: 'Mayıs dönemi için 18.450 ₺ KDV tahakkukunuz var. Son ödeme tarihi 26 Haziran. Tahakkuk fişini Belgeler bölümünden açabilirsiniz.',
    time: '09:21',
  },
];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chatBody: { paddingVertical: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
});
