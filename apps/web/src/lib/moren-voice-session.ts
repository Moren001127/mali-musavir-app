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
  /** Mikrofon giriş seviyesi 0-1 (150 ms'de bir). Kullanıcı "duyuyor mu?" diye bakabilsin. */
  micLevel: number;
  /** Mikrofon açık ama ses gelmiyor: parça 'muted' ya da 3 sn boyunca seviye 0. */
  micSessiz: boolean;
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

/**
 * Oturum talimatı. `sunucuTalimati` = backend'in jeton üretirken gömdüğü metin (sahibin kimliği,
 * "asla bilmiyorum deme" kuralı vb.). session.update talimatı BÜTÜNÜYLE değiştirdiği için
 * o metin taban alınır; buraya yalnız bağlam satırları eklenir — yoksa sayfa değişince kimlik silinir.
 */
function realtimeInstructions(s: VoiceSnapshot, sunucuTalimati: string) {
  const moduleList = PORTAL_ROUTES.map((route) => `${route.label}: ${route.path}`).join(' | ');
  return [
    sunucuTalimati || 'Türkçe konuş. Kadın sesli, doğal, sıcak ve sakin ol.',
    'Sen portal genelinde çalışan canlı MOREN AI ses katmanısın; sayfa değişse de konuşma sürer.',
    !sunucuTalimati && s.koordinator
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
    micLevel: 0,
    micSessiz: false,
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
  /** Backend'in jeton cevabında gömdüğü talimat (kimlik satırı dahil); session.update tabanı. */
  private sunucuTalimati = '';
  /** Her start() bir nesil; eski oturumun geç gelen sorgu cevabı yeni oturuma karışmaz. */
  private oturumNo = 0;
  /** Bekleyen portal_query iptali (stop → abort). */
  private sorguAbort: AbortController | null = null;
  /**
   * Bir portal_query sonucu gönderildi ama henüz seslendirilmedi. Olay kuyruğu seri olduğu için
   * VAD'ın araya girip ürettiği ikinci portal_query, birincisi bittikten SONRA işlenir; o an
   * aynı işi yeniden koşturmak yerine "sonuç hazır, söylüyorum" der (koordinatöre çift iş açılmaz).
   */
  private ciktiBekliyor = false;
  /** Ses çalarken output_audio_buffer.stopped gelmezse 'speaking'te takılmamak için emniyet. */
  private konusmaTimer: number | null = null;
  /** OpenAI tarafında üretim süren bir cevap var mı (response.created → response.done). */
  private aktifCevap = false;
  /** Aktif cevap varken gönderilemeyen response.create; sıradaki response.done'da gider. */
  private bekleyenCevapIstegi: any = null;
  /** Veri kanalı olayları tek kuyrukta sırayla işlenir (araç çağrısı beklerken sonrakiler öne geçmesin). */
  private olayKuyrugu: Promise<void> = Promise.resolve();
  /** WebRTC 'disconnected' geçici olabilir; hemen kapatma, kısa bekle. */
  private kopmaTimer: number | null = null;
  /** Mikrofon seviye ölçümü (AnalyserNode). */
  private micCtx: AudioContext | null = null;
  private micTimer: number | null = null;
  private micSessizSayac = 0;

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
        instructions: realtimeInstructions(this.snapshot, this.sunucuTalimati),
        tools: [PORTAL_QUERY_TOOL, PORTAL_NAVIGATE_TOOL],
        tool_choice: 'auto',
      },
    });
  }

  /** Araç çıktısından sonra modelin sesli cevabı; aktif cevap varsa sıraya alınır (çakışma hatası önlenir). */
  private cevapIste() {
    const istek = {
      type: 'response.create',
      response: {
        tool_choice: 'none',
        instructions:
          'Tool çıktısındaki answer alanlarını temel alarak kısa, doğal Türkçe cevap ver. En fazla 1-3 cümle; answer "CANLI modda" ile başlıyorsa bunu ilk cümlede söyle. Konuşmanın devam ettiğini hissettir.',
      },
    };
    if (this.aktifCevap) {
      this.bekleyenCevapIstegi = istek;
      return;
    }
    // Tek response.create konuşmadaki tüm function_call_output'ları kapsar; eski bekleyen istek
    // sonraki response.done'da ikinci kez gitmesin (aynı cevap iki kez seslendiriliyordu).
    this.bekleyenCevapIstegi = null;
    this.aktifCevap = true;
    this.send(istek);
  }

  private send(payload: any) {
    const dc = this.dc;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(payload));
  }

  /**
   * Mikrofon seviye ölçümü: 150 ms'de bir tepe genlik → micLevel; parça 'muted' ya da
   * ~3 sn (20 örnek) sıfır seviye → micSessiz (Windows ses vermiyor: mikrofon tuşu / gizlilik / başka uygulama).
   * Canlı teşhis (2026-09-12): bağlantı açıkken parça muted, seviye 0 → OpenAI hiç ses almıyordu.
   */
  private micOlcumBaslat(stream: MediaStream) {
    this.micOlcumDurdur();
    if (typeof window === 'undefined') return;
    const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      this.micCtx = ctx;
      this.micSessizSayac = 0;
      const track = stream.getAudioTracks()[0];
      const olc = () => {
        an.getByteTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128);
          if (v > max) max = v;
        }
        const level = Math.min(1, max / 64);
        const parcaSessiz = !track || track.muted || track.readyState !== 'live';
        if (max <= 1) this.micSessizSayac += 1;
        else this.micSessizSayac = 0;
        const micSessiz = parcaSessiz || this.micSessizSayac >= 20;
        if (level !== this.snapshot.micLevel || micSessiz !== this.snapshot.micSessiz) this.set({ micLevel: level, micSessiz });
      };
      this.micTimer = window.setInterval(olc, 150);
      track?.addEventListener('mute', () => this.set({ micSessiz: true }));
      track?.addEventListener('unmute', () => {
        this.micSessizSayac = 0;
        this.set({ micSessiz: false });
      });
    } catch {
      /* ölçüm kurulamadı; ses akışını etkilemez */
    }
  }

  private micOlcumDurdur() {
    if (this.micTimer != null && typeof window !== 'undefined') window.clearInterval(this.micTimer);
    this.micTimer = null;
    try {
      this.micCtx?.close();
    } catch {}
    this.micCtx = null;
    this.micSessizSayac = 0;
    if (this.snapshot.micLevel !== 0 || this.snapshot.micSessiz) this.set({ micLevel: 0, micSessiz: false });
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
    // Sorgu bitti: 'thinking' göstergesi kalmasın (sesli cevap gelince response.created yeniden kurar).
    this.set({ thinkingSince: null, longWait: false, ...(this.snapshot.status === 'thinking' ? { status: 'listening' as VoiceStatus } : {}) });
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

  private async runPortalQuery(call: any, args: any, nesil: number) {
    const question = String(args?.question || '').trim();
    if (!question) {
      this.sendFunctionOutput(call, { ok: false, answer: 'Soruyu net duyamadım, tekrar söyler misiniz?' });
      return;
    }
    if (this.ciktiBekliyor) {
      // Kullanıcı beklerken konuştu, VAD ikinci bir portal_query üretti; kuyruk seri olduğu için buraya
      // ilk sorgu bittikten sonra gelinir. Aynı işi yeniden koşturma; hazır sonucu seslendir.
      this.sendFunctionOutput(call, {
        ok: true,
        answer: this.snapshot.lastAnswer || 'Önceki isteğinizin sonucu hazır; onu söylüyorum.',
        tekrar: true,
      });
      return;
    }
    const abort = new AbortController();
    this.sorguAbort = abort;
    this.set({ lastQuestion: question });
    this.thinkingStart();
    try {
      const conversationId = await this.resolveConversationId();
      if (nesil !== this.oturumNo) return;
      const result = await realtimePortalQuery(
        {
          conversationId: conversationId || undefined,
          taxpayerId: this.snapshot.taxpayerId || undefined,
          question,
          currentPath: this.snapshot.currentPath || undefined,
        },
        { timeoutMs: REALTIME_PORTAL_QUERY_TIMEOUT_MS, signal: abort.signal },
      );
      setStoredMorenAiConversationId(result.conversationId);
      this.hooks.onQueryDone?.(result.conversationId);
      // Oturum bu arada kapanıp yeniden açıldıysa eski call_id yeni oturuma gönderilmez.
      if (nesil !== this.oturumNo) return;
      this.set({ lastAnswer: result.assistantMessage || '', lastAction: 'Yanıt hazırlandı' });
      this.ciktiBekliyor = true;
      this.sendFunctionOutput(call, {
        ok: true,
        answer: result.assistantMessage,
        conversationId: result.conversationId,
        usage: result.usage,
      });
    } catch (error: any) {
      if (nesil !== this.oturumNo || abort.signal.aborted) return; // stop() iptal etti; sessizce çık
      throw error;
    } finally {
      if (this.sorguAbort === abort) this.sorguAbort = null;
      if (nesil === this.oturumNo) this.thinkingEnd();
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

  /** true → çıktı gönderildi, sesli cevap istenmeli; false → yarım/bozuk çağrı ya da oturum değişti, atlandı. */
  private async handleFunctionCall(call: any, nesil: number): Promise<boolean> {
    // Kullanıcı araya girince (interrupt_response) model argümanı yarım bırakır: item.status 'incomplete',
    // arguments bozuk JSON. Öyle bir çağrıyı işlemek "Soruyu duyamadım" + gereksiz response.create üretir.
    if (call?.status === 'incomplete') return false;
    let args: any = {};
    try {
      args = call?.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      return false;
    }
    try {
      if (call?.name === 'portal_navigate') this.runNavigation(call, args);
      else if (call?.name === 'portal_query') await this.runPortalQuery(call, args, nesil);
      else this.sendFunctionOutput(call, { ok: false, answer: 'Bu sesli işlem şu an desteklenmiyor.' });
      if (nesil !== this.oturumNo) return false; // stop()/yeniden start: eski oturuma cevap isteme
    } catch (error: any) {
      if (nesil !== this.oturumNo) return false;
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
    return true;
  }

  /** Veri kanalı olayı → kuyruk. Araç çağrısı 60-90 sn sürerken gelen olaylar sırayla işlenir, öne geçmez. */
  private enqueueRealtimeEvent(raw: MessageEvent) {
    let event: any;
    try {
      event = JSON.parse(String(raw.data || '{}'));
    } catch {
      return;
    }
    // Hızlı durum olayları kuyruğu beklemesin (kullanıcı konuştu / model konuşuyor göstergesi).
    this.handleQuickEvent(event);
    if (event.type !== 'response.done') return;
    const nesil = this.oturumNo;
    this.olayKuyrugu = this.olayKuyrugu
      .then(() => (nesil === this.oturumNo ? this.handleResponseDone(event, nesil) : undefined))
      .catch(() => {});
  }

  /** Araç beklerken (thinkingSince dolu) gösterge 'thinking'e döner; yoksa 'listening'. */
  private dinlemeyeDon() {
    if (!this.snapshot.active) return;
    this.set({ status: this.snapshot.thinkingSince ? 'thinking' : 'listening' });
  }

  private konusmaEmniyetiKur() {
    if (typeof window === 'undefined') return;
    if (this.konusmaTimer != null) window.clearTimeout(this.konusmaTimer);
    // output_audio_buffer.stopped gelmezse 'Konuşuyor'da takılı kalmasın.
    this.konusmaTimer = window.setTimeout(() => {
      this.konusmaTimer = null;
      if (this.snapshot.status === 'speaking') this.dinlemeyeDon();
    }, 12_000);
  }

  private handleQuickEvent(event: any) {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        // Cevabı manuel iptal ETME: sunucudaki semantic_vad + interrupt_response doğal yönetir.
        this.set({ status: 'listening', errorText: '' });
        break;
      case 'input_audio_buffer.speech_stopped':
        this.set({ status: 'thinking' });
        break;
      case 'response.created':
        this.aktifCevap = true;
        this.set({ status: 'thinking' });
        break;
      // GA adları: response.output_audio_transcript.delta / response.output_audio.delta.
      // WebRTC'de ses veri kanalından değil medya kanalından akar; çalma başlangıcını output_audio_buffer.started verir.
      // Eski (beta) adlar geriye uyumluluk için duruyor.
      case 'output_audio_buffer.started':
      case 'response.output_audio_transcript.delta':
      case 'response.output_audio.delta':
      case 'response.audio_transcript.delta':
      case 'response.audio.delta':
        if (this.snapshot.status !== 'speaking') this.set({ status: 'speaking' });
        this.konusmaEmniyetiKur();
        break;
      case 'output_audio_buffer.stopped':
        // Hoparlörden çalma bitti (response.done üretim bitişidir, çalma birkaç sn sürer).
        if (this.konusmaTimer != null && typeof window !== 'undefined') window.clearTimeout(this.konusmaTimer);
        this.konusmaTimer = null;
        this.dinlemeyeDon();
        break;
      case 'error': {
        const kod = String(event?.error?.code || '');
        const msg = event?.error?.message || 'Ses oturumu hatası';
        if (kod === 'conversation_already_has_active_response') {
          // Bizim response.create, VAD'ın başlattığı cevapla çakıştı; o cevap bitince yeniden istenir.
          this.aktifCevap = true;
          if (!this.bekleyenCevapIstegi) this.bekleyenCevapIstegi = { type: 'response.create', response: { tool_choice: 'none' } };
          return;
        }
        this.set({ errorText: String(msg).slice(0, 200) });
        break;
      }
      default:
        break;
    }
  }

  private async handleResponseDone(event: any, nesil: number) {
    this.aktifCevap = false;
    // Kullanım kaydı ağ isteği; kuyruğu BLOKLAMASIN (asılı kalan tek POST tüm araç çağrılarını dondurur).
    void this.recordUsage(event);

    // Kullanıcı araya girdiyse (cancelled/incomplete) yarım araç çağrılarını işleme.
    const durum = String(event?.response?.status || 'completed');
    const output: any[] = event?.response?.output || [];
    const calls =
      durum === 'completed' ? output.filter((item: any) => item?.type === 'function_call' && item?.status !== 'incomplete') : [];

    if (calls.length > 0) {
      let ciktiVar = false;
      for (const call of calls) {
        if (await this.handleFunctionCall(call, nesil)) ciktiVar = true;
        if (nesil !== this.oturumNo) return; // oturum bu arada kapandı/yenilendi
      }
      if (ciktiVar) {
        this.cevapIste();
        return;
      }
    }

    // Bu cevap araç çıktısını seslendirdiyse "sonuç hazır" bayrağı düşer.
    if (calls.length === 0 && this.ciktiBekliyor) this.ciktiBekliyor = false;

    // Aktif cevap varken sıraya alınmış istek şimdi gönderilebilir.
    if (this.bekleyenCevapIstegi) {
      const istek = this.bekleyenCevapIstegi;
      this.bekleyenCevapIstegi = null;
      this.aktifCevap = true;
      this.send(istek);
      return;
    }

    // Sesli çıktı varsa hoparlörde çalma birkaç sn daha sürer → geçişi output_audio_buffer.stopped'a bırak.
    const sesVar = output.some(
      (item: any) =>
        item?.type === 'message' && Array.isArray(item?.content) && item.content.some((c: any) => c?.type === 'audio' || c?.type === 'output_audio'),
    );
    if (sesVar) {
      if (this.snapshot.status === 'speaking') this.konusmaEmniyetiKur();
      return;
    }
    this.dinlemeyeDon();
  }

  // ─── başlat / durdur ───
  async start(): Promise<void> {
    if (this.pc || this.starting) return;
    if (typeof window === 'undefined') return;
    this.starting = true;
    this.oturumNo += 1;
    const nesil = this.oturumNo;
    this.aktifCevap = false;
    this.bekleyenCevapIstegi = null;
    this.ciktiBekliyor = false;
    this.olayKuyrugu = Promise.resolve();
    this.set({ status: 'connecting', active: true, errorText: '', lastAction: 'Bağlanıyor', sessionCost: 0, sessionTokens: 0, thinkingSince: null, longWait: false });
    this.startedAt = Date.now();
    this.loggedResponses = new Set();
    // Bağlantı kurulurken stop() çağrılırsa (jeton/mikrofon/SDP beklerken) yarım kalan kaynaklar
    // kapatılıp sessizce çıkılır; yoksa görünürde kapalı ama mikrofonu açık "zombi oturum" kalıyordu.
    let pcYerel: RTCPeerConnection | null = null;
    let streamYerel: MediaStream | null = null;
    const iptalEdildi = () => {
      if (nesil === this.oturumNo) return false;
      try {
        pcYerel?.close();
      } catch {}
      streamYerel?.getTracks().forEach((t) => t.stop());
      if (this.pc === pcYerel) this.pc = null;
      if (this.stream === streamYerel) this.stream = null;
      return true;
    };

    try {
      const tokenData = await getRealtimeVoiceToken();
      if (iptalEdildi()) return;
      const model = tokenData?.model || tokenData?.session?.model || DEFAULT_MODEL;
      const koordinator = tokenData?.morenKoordinator !== false;
      // Backend'in gömdüğü talimat (kimlik + koordinatör kuralları) taban; session.update bunu ezmesin.
      this.sunucuTalimati = String(tokenData?.session?.instructions || tokenData?.instructions || '');
      this.set({ model, koordinator });
      const ephemeralKey =
        tokenData?.value || tokenData?.client_secret?.value || tokenData?.clientSecret?.value || tokenData?.secret?.value;
      if (!ephemeralKey) throw new Error('Realtime oturum anahtarı alınamadı');

      const pc = new RTCPeerConnection();
      this.pc = pc;
      pcYerel = pc;

      const audio = this.ensureAudio();
      pc.ontrack = async (event) => {
        if (!audio) return;
        audio.srcObject = event.streams[0];
        await audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (this.pc !== pc) return;
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed') {
          this.stop('Bağlantı koptu');
          return;
        }
        if (st === 'disconnected') {
          // Geçici ICE kopması çoğu zaman saniyeler içinde toparlar; 60-90 sn'lik araç beklemesinde
          // ufak dalgalanma oturumu bitirmesin. 8 sn sonra hâlâ kopuksa kapat.
          if (this.kopmaTimer == null) {
            this.set({ lastAction: 'Bağlantı dalgalanıyor…' });
            this.kopmaTimer = window.setTimeout(() => {
              this.kopmaTimer = null;
              if (this.pc === pc && (pc.connectionState === 'disconnected' || pc.connectionState === 'failed')) {
                this.stop('Bağlantı koptu');
              }
            }, 8000);
          }
          return;
        }
        if (st === 'connected' && this.kopmaTimer != null) {
          window.clearTimeout(this.kopmaTimer);
          this.kopmaTimer = null;
          this.set({ lastAction: 'Bağlantı toparlandı' });
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamYerel = stream;
      if (iptalEdildi()) return;
      this.stream = stream;
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
      this.micOlcumBaslat(stream);

      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;
      dc.onmessage = (event) => this.enqueueRealtimeEvent(event);
      dc.onopen = () => {
        this.set({ status: 'listening', lastAction: 'Dinliyor' });
        this.pushSessionUpdate();
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (iptalEdildi()) return;
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeralKey}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpResponse.ok) {
        const text = await sdpResponse.text();
        throw new Error(text.slice(0, 200) || 'Canlı ses bağlantısı kurulamadı');
      }
      const cevapSdp = await sdpResponse.text();
      if (iptalEdildi()) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: cevapSdp });
    } catch (error: any) {
      if (iptalEdildi()) return; // stop() geldi; hata gösterme
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
    if (this.kopmaTimer != null && typeof window !== 'undefined') window.clearTimeout(this.kopmaTimer);
    this.kopmaTimer = null;
    // Bekleyen koordinatör sorgusu iptal; eski nesil cevabı yeni oturuma karışmasın.
    this.oturumNo += 1;
    try {
      this.sorguAbort?.abort();
    } catch {}
    this.sorguAbort = null;
    this.ciktiBekliyor = false;
    this.aktifCevap = false;
    this.bekleyenCevapIstegi = null;
    if (this.konusmaTimer != null && typeof window !== 'undefined') window.clearTimeout(this.konusmaTimer);
    this.konusmaTimer = null;
    try {
      this.dc?.close();
    } catch {}
    this.dc = null;
    try {
      this.pc?.close();
    } catch {}
    this.pc = null;
    this.micOlcumDurdur();
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
