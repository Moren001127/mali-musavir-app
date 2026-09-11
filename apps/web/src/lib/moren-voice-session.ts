/**
 * Canlı MOREN AI — TEK ses oturumu (sayfa bağımsız).
 *
 * Eskiden iki ayrı Realtime örneği vardı: GlobalMorenVoice (yüzen panel) ve
 * /panel/moren-ai sayfasının kendi bağlantısı; sayfa değişince sayfanınki
 * unmount'ta ölüyor, ses kopuyordu. Artık WebRTC bağlantısı, mikrofon, ses
 * çıkışı ve durum bu modül-düzeyi depoda yaşar; React bileşenleri yalnız
 * useSyncExternalStore ile İZLER ve start/stop çağırır. Bileşen sökülse de
 * oturum sürer (kök layout'taki GlobalMorenVoice her sayfada durur).
 *
 * Kulak+ağız: OpenAI Realtime (WebRTC). Beyin: portal_query → backend
 * realtimePortalQuery → EKİP koordinatörü (Max). Gezinme: portal_navigate.
 */
import {
  getRealtimeVoiceToken,
  listConversations,
  logRealtimeVoiceUsage,
  realtimePortalQuery,
  REALTIME_PORTAL_QUERY_TIMEOUT_MS,
} from '@/lib/moren-ai';
import { getStoredMorenAiConversationId, setStoredMorenAiConversationId } from '@/lib/moren-ai-conversation-state';
import { getCurrentRoute, PORTAL_ROUTES, resolveRoute } from '@/lib/moren-voice-routes';

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface VoiceSnapshot {
  status: VoiceStatus;
  /** Bağlantı kuruldu / kuruluyor (oturum açık). */
  active: boolean;
  lastAction: string;
  errorText: string;
  sessionCost: number;
  sessionTokens: number;
  model: string;
  /** "Düşünüyor" ne zamandır sürüyor (ms epoch); null → düşünmüyor. */
  thinkingSince: number | null;
  /** 20 sn'yi aştı → "hâlâ çalışıyor" göstergesi. */
  longWait: boolean;
  /** Backend sesli muhatabı koordinatör (EKIP_SES_KOORDINATOR) mi? Token cevabından gelir. */
  koordinator: boolean;
  currentPath: string;
  moduleLabel: string;
  taxpayerId: string | null;
  taxpayerName: string | null;
  lastQuestion: string;
  lastAnswer: string;
}

export interface VoiceHooks {
  /** Portal içi gezinme (Next router.push). Yoksa window.location kullanılır. */
  navigate?: (path: string) => void;
  /** Sesli sorgu bitti → sorgu önbelleklerini tazele (react-query). */
  onQueryDone?: (conversationId: string) => void;
}

const LONG_WAIT_MS = 20_000;
const DEFAULT_MODEL = 'gpt-realtime-mini';

const PORTAL_QUERY_TOOL = {
  type: 'function',
  name: 'portal_query',
  description:
    'Portal verisi, mükellef, vergi, SGK, beyan, mali tablo, hafıza, WhatsApp ve ofis işi sorularını MOREN AI backendine (ekip koordinatörüne) iletir.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Kullanıcının sesli isteğinin kısa ve net metin hali; "canlı yap" / "ONAYLIYORUM #PRV-…" gibi sözleri aynen koru.',
      },
    },
    required: ['question'],
  },
};

const PORTAL_NAVIGATE_TOOL = {
  type: 'function',
  name: 'portal_navigate',
  description: 'Kullanıcı portalda bir modüle geçmek istediğinde sayfa değiştirmek için kullanılır. Konuşma devam eder.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Gidilecek modül adı veya portal yolu.' },
    },
    required: ['target'],
  },
};

function realtimeInstructions(s: VoiceSnapshot) {
  const moduleList = PORTAL_ROUTES.map((route) => `${route.label}: ${route.path}`).join(' | ');
  return [
    'Türkçe konuş. Kadın sesli, doğal, sıcak ve sakin ol.',
    'Sen portal genelinde çalışan canlı MOREN AI ses katmanısın; sayfa değişse de konuşma sürer.',
    s.koordinator
      ? 'Muhatabın ofisin yapay çalışan ekibinin KOORDİNATÖRÜ (Ofis Müdürü): portal_query doğrudan ona gider; o veriyi toplar, işi ekibe dağıtır, riskli işi sahibin onayına düşürür. Cevap 10-60 saniye sürebilir; bekle, kendin uydurma. Kullanıcı "canlı yap", "gerçek çalıştır", "kuru test olmasın" derse bu sözleri question metnine AYNEN koy. Koordinatör "ONAYLIYORUM #PRV-…" beklediğini söylerse kullanıcı bunu söyleyince aynen question olarak ilet.'
      : '',
    'Kullanıcı bir modüle geçmek isterse portal_navigate toolunu kullan; konuşmayı kapatma.',
    'Kullanıcı veri, mükellef, mali tablo, beyan, SGK, WhatsApp veya ofis işi sorarsa portal_query toolunu kullan.',
    'Selamlaşma, tamam/evet/hayır gibi kısa onaylar ve sohbet niteliğindeki cümlelerde portal_query kullanma; doğrudan çok kısa cevap ver.',
    'Cevapları kısa, net ve mesleki tut: 1-3 cümle.',
    'Karşındaki kişi mali müşavir meslek mensubu; "mali müşavire danışın", "uzmana başvurun" veya sorumluluk reddi deme.',
    `Aktif ekran: ${s.moduleLabel} (${s.currentPath || '/panel'}).`,
    s.taxpayerName ? `Seçili mükellef: ${s.taxpayerName}.` : 'Seçili mükellef yok; genel ofis sorusu.',
    `Gezilebilir modüller: ${moduleList}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

type Listener = () => void;

class MorenVoiceStore {
  private snapshot: VoiceSnapshot = {
    status: 'idle',
    active: false,
    lastAction: 'Hazır',
    errorText: '',
    sessionCost: 0,
    sessionTokens: 0,
    model: DEFAULT_MODEL,
    thinkingSince: null,
    longWait: false,
    koordinator: true,
    currentPath: '/panel',
    moduleLabel: 'Gösterge Paneli',
    taxpayerId: null,
    taxpayerName: null,
    lastQuestion: '',
    lastAnswer: '',
  };
  private listeners = new Set<Listener>();
  private hooks: VoiceHooks = {};
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private dc: RTCDataChannel | null = null;
  private audio: HTMLAudioElement | null = null;
  private startedAt = 0;
  private loggedResponses = new Set<string>();
  private longWaitTimer: number | null = null;
  private starting = false;

  // ─── depo ───
  getSnapshot = () => this.snapshot;
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(partial: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        /* dinleyici hatası oturumu bozmasın */
      }
    });
  }

  setHooks(hooks: VoiceHooks) {
    this.hooks = { ...this.hooks, ...hooks };
  }

  /** Aktif sayfa değişti → talimat güncellenir (oturum kopmaz). */
  setContext(pathname: string | null) {
    const route = getCurrentRoute(pathname);
    const currentPath = pathname || '/panel';
    if (currentPath === this.snapshot.currentPath && route.label === this.snapshot.moduleLabel) return;
    this.set({ currentPath, moduleLabel: route.label });
    if (this.snapshot.active) this.set({ lastAction: `${route.label} ekranındasınız` });
    this.pushSessionUpdate();
  }

  /** /panel/moren-ai'daki seçili mükellef → sesli sorgu bağlamı. */
  setTaxpayer(taxpayerId: string | null, taxpayerName: string | null) {
    const id = taxpayerId || null;
    const name = taxpayerName || null;
    if (id === this.snapshot.taxpayerId && name === this.snapshot.taxpayerName) return;
    this.set({ taxpayerId: id, taxpayerName: name });
    this.pushSessionUpdate();
  }

  private pushSessionUpdate() {
    if (!this.snapshot.active || this.dc?.readyState !== 'open') return;
    this.send({
      type: 'session.update',
      session: {
        // OpenAI Realtime (GA) session.update'te zorunlu; yoksa "Missing required parameter: 'session.type'".
        type: 'realtime',
        instructions: realtimeInstructions(this.snapshot),
        tools: [PORTAL_QUERY_TOOL, PORTAL_NAVIGATE_TOOL],
        tool_choice: 'auto',
      },
    });
  }

  private send(payload: any) {
    const dc = this.dc;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(payload));
  }

  private ensureAudio(): HTMLAudioElement | null {
    if (typeof document === 'undefined') return null;
    if (this.audio && document.body.contains(this.audio)) return this.audio;
    const el = document.createElement('audio');
    el.id = 'moren-voice-audio';
    el.autoplay = true;
    el.setAttribute('playsinline', 'true');
    el.style.display = 'none';
    document.body.appendChild(el);
    this.audio = el;
    return el;
  }

  // ─── konuşma kimliği ───
  private async resolveConversationId(): Promise<string | null> {
    const stored = getStoredMorenAiConversationId();
    if (stored) return stored;
    try {
      const latest = await listConversations(1);
      const id = latest?.[0]?.id || null;
      if (id) setStoredMorenAiConversationId(id);
      return id;
    } catch {
      return null;
    }
  }

  // ─── düşünme süresi göstergesi ───
  private thinkingStart() {
    this.clearLongWait();
    this.set({ status: 'thinking', thinkingSince: Date.now(), longWait: false, lastAction: 'Yanıt hazırlanıyor', errorText: '' });
    if (typeof window === 'undefined') return;
    this.longWaitTimer = window.setTimeout(() => {
      if (this.snapshot.thinkingSince) {
        this.set({
          longWait: true,
          lastAction: this.snapshot.koordinator ? 'Hâlâ çalışıyor — koordinatör işi yürütüyor' : 'Hâlâ çalışıyor',
        });
      }
    }, LONG_WAIT_MS);
  }
  private thinkingEnd() {
    this.clearLongWait();
    this.set({ thinkingSince: null, longWait: false });
  }
  private clearLongWait() {
    if (this.longWaitTimer && typeof window !== 'undefined') window.clearTimeout(this.longWaitTimer);
    this.longWaitTimer = null;
  }

  // ─── maliyet ───
  private async recordUsage(event: any) {
    const response = event?.response;
    const usage = response?.usage;
    const responseId = response?.id || event?.event_id;
    if (!usage || !responseId || this.loggedResponses.has(responseId)) return;
    this.loggedResponses.add(responseId);
    try {
      const conversationId = await this.resolveConversationId();
      const logged = await logRealtimeVoiceUsage({
        conversationId: conversationId || undefined,
        taxpayerId: this.snapshot.taxpayerId || undefined,
        model: this.snapshot.model,
        responseId,
        usage,
        durationMs: this.startedAt ? Date.now() - this.startedAt : undefined,
      });
      this.set({
        sessionCost: this.snapshot.sessionCost + (logged.costUsd || 0),
        sessionTokens: this.snapshot.sessionTokens + (logged.inputTokens || 0) + (logged.outputTokens || 0),
      });
    } catch {
      // Maliyet kaydı ses akışını bozmasın.
    }
  }

  // ─── araç çağrıları ───
  private sendFunctionOutput(call: any, output: any) {
    this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) },
    });
  }

  private async runPortalQuery(call: any, args: any) {
    const question = String(args?.question || '').trim();
    if (!question) {
      this.sendFunctionOutput(call, { ok: false, answer: 'Soruyu net duyamadım, tekrar söyler misiniz?' });
      return;
    }
    this.set({ lastQuestion: question });
    this.thinkingStart();
    try {
      const conversationId = await this.resolveConversationId();
      const result = await realtimePortalQuery(
        {
          conversationId: conversationId || undefined,
          taxpayerId: this.snapshot.taxpayerId || undefined,
          question,
          currentPath: this.snapshot.currentPath || undefined,
        },
        { timeoutMs: REALTIME_PORTAL_QUERY_TIMEOUT_MS },
      );
      setStoredMorenAiConversationId(result.conversationId);
      this.hooks.onQueryDone?.(result.conversationId);
      this.set({ lastAnswer: result.assistantMessage || '', lastAction: 'Yanıt hazırlandı' });
      this.sendFunctionOutput(call, {
        ok: true,
        answer: result.assistantMessage,
        conversationId: result.conversationId,
        usage: result.usage,
      });
    } finally {
      this.thinkingEnd();
    }
  }

  private runNavigation(call: any, args: any) {
    const route = resolveRoute(String(args?.target || ''));
    if (!route) {
      this.sendFunctionOutput(call, { ok: false, answer: 'Bu modülü bulamadım. Modül adını bir kez daha söyleyin.' });
      return;
    }
    if (this.hooks.navigate) this.hooks.navigate(route.path);
    else if (typeof window !== 'undefined') window.location.assign(route.path);
    this.set({ lastAction: `${route.label} açıldı` });
    this.sendFunctionOutput(call, {
      ok: true,
      answer: `${route.label} ekranını açtım. Konuşmaya devam edebilirsiniz.`,
      path: route.path,
      label: route.label,
    });
  }

  private async handleFunctionCall(call: any) {
    let args: any = {};
    try {
      args = call?.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      args = {};
    }
    try {
      if (call?.name === 'portal_navigate') this.runNavigation(call, args);
      else if (call?.name === 'portal_query') await this.runPortalQuery(call, args);
      else this.sendFunctionOutput(call, { ok: false, answer: 'Bu sesli işlem şu an desteklenmiyor.' });
    } catch (error: any) {
      const zamanAsimi = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''));
      const mesaj = zamanAsimi
        ? 'Koordinatörden cevap gelmedi; iş arka planda sürüyor olabilir, mesajlaşma ekranından bakabilirsiniz.'
        : 'Portal işlemi tamamlanamadı; bağlantıyı kontrol edip tekrar deneyelim.';
      this.sendFunctionOutput(call, {
        ok: false,
        answer: mesaj,
        error: error?.response?.data?.message || error?.message || 'tool_failed',
      });
      this.set({
        status: 'error',
        errorText: error?.response?.data?.message || error?.message || 'İşlem tamamlanamadı',
        lastAction: zamanAsimi ? 'Cevap gecikti' : 'İşlem tamamlanamadı',
      });
    }
  }

  private async handleRealtimeEvent(raw: MessageEvent) {
    let event: any;
    try {
      event = JSON.parse(String(raw.data || '{}'));
    } catch {
      return;
    }

    if (event.type === 'input_audio_buffer.speech_started') {
      // Cevabı manuel iptal ETME: sunucudaki semantic_vad + interrupt_response doğal yönetir.
      this.set({ status: 'listening', errorText: '' });
    }
    if (event.type === 'input_audio_buffer.speech_stopped' || event.type === 'response.created') {
      if (!this.snapshot.thinkingSince) this.set({ status: 'thinking' });
    }
    if (event.type === 'response.audio.delta' || event.type === 'response.audio_transcript.delta') {
      this.set({ status: 'speaking' });
    }
    if (event.type === 'error') {
      const msg = event?.error?.message || 'Ses oturumu hatası';
      this.set({ errorText: String(msg).slice(0, 200) });
    }
    if (event.type !== 'response.done') return;

    await this.recordUsage(event);
    const calls = (event?.response?.output || []).filter((item: any) => item?.type === 'function_call');
    if (calls.length > 0) {
      for (const call of calls) await this.handleFunctionCall(call);
      this.send({
        type: 'response.create',
        response: {
          tool_choice: 'none',
          instructions:
            'Tool çıktısındaki answer alanlarını temel alarak kısa, doğal Türkçe cevap ver. En fazla 1-3 cümle; answer "CANLI modda" ile başlıyorsa bunu ilk cümlede söyle. Konuşmanın devam ettiğini hissettir.',
        },
      });
      return;
    }

    if (this.snapshot.active) this.set({ status: 'listening' });
  }

  // ─── başlat / durdur ───
  async start(): Promise<void> {
    if (this.pc || this.starting) return;
    if (typeof window === 'undefined') return;
    this.starting = true;
    this.set({ status: 'connecting', active: true, errorText: '', lastAction: 'Bağlanıyor', sessionCost: 0, sessionTokens: 0 });
    this.startedAt = Date.now();
    this.loggedResponses = new Set();

    try {
      const tokenData = await getRealtimeVoiceToken();
      const model = tokenData?.model || tokenData?.session?.model || DEFAULT_MODEL;
      const koordinator = tokenData?.morenKoordinator !== false;
      this.set({ model, koordinator });
      const ephemeralKey =
        tokenData?.value || tokenData?.client_secret?.value || tokenData?.clientSecret?.value || tokenData?.secret?.value;
      if (!ephemeralKey) throw new Error('Realtime oturum anahtarı alınamadı');

      const pc = new RTCPeerConnection();
      this.pc = pc;

      const audio = this.ensureAudio();
      pc.ontrack = async (event) => {
        if (!audio) return;
        audio.srcObject = event.streams[0];
        await audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && this.pc === pc) {
          this.stop('Bağlantı koptu');
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.stream = stream;
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;
      dc.onmessage = (event) => {
        this.handleRealtimeEvent(event).catch(() => {});
      };
      dc.onopen = () => {
        this.set({ status: 'listening', lastAction: 'Dinliyor' });
        this.pushSessionUpdate();
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeralKey}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpResponse.ok) {
        const text = await sdpResponse.text();
        throw new Error(text.slice(0, 200) || 'Canlı ses bağlantısı kurulamadı');
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Canlı ses başlatılamadı';
      this.stop();
      this.set({ status: 'error', errorText: message, lastAction: 'Başlatılamadı' });
      throw new Error(message);
    } finally {
      this.starting = false;
    }
  }

  stop(reason = 'Durduruldu') {
    this.clearLongWait();
    try {
      this.dc?.close();
    } catch {}
    this.dc = null;
    try {
      this.pc?.close();
    } catch {}
    this.pc = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
    this.set({ status: 'idle', active: false, thinkingSince: null, longWait: false, lastAction: reason });
  }

  async toggle(): Promise<void> {
    if (this.snapshot.active) this.stop();
    else await this.start();
  }
}

// Modül-düzeyi tekil örnek; geliştirmede (HMR) modül yeniden yüklense de oturum kaybolmasın.
const KEY = '__morenVoiceStore';
function getStore(): MorenVoiceStore {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = new MorenVoiceStore();
  return g[KEY] as MorenVoiceStore;
}

export const morenVoice = {
  getSnapshot: () => getStore().getSnapshot(),
  subscribe: (l: Listener) => getStore().subscribe(l),
  start: () => getStore().start(),
  stop: (reason?: string) => getStore().stop(reason),
  toggle: () => getStore().toggle(),
  setContext: (pathname: string | null) => getStore().setContext(pathname),
  setTaxpayer: (id: string | null, name: string | null) => getStore().setTaxpayer(id, name),
  setHooks: (hooks: VoiceHooks) => getStore().setHooks(hooks),
};

export function voiceStatusLabel(s: VoiceSnapshot): string {
  if (s.status === 'connecting') return 'Bağlanıyor';
  if (s.status === 'listening') return 'Dinliyor';
  if (s.status === 'thinking') return s.longWait ? 'Hâlâ çalışıyor' : 'Düşünüyor';
  if (s.status === 'speaking') return 'Konuşuyor';
  if (s.status === 'error') return 'Hata';
  return 'Hazır';
}
