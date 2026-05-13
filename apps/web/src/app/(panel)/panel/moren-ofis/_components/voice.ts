import type { AgentId } from '@/lib/moren-ofis';
import { synthesize } from '@/lib/moren-ai';
import { toast } from 'sonner';

type VoiceGender = 'male' | 'female' | 'neutral';
type VoiceProfile = {
  pitch: number;
  rate: number;
  voiceGender: VoiceGender;
  voiceHints: RegExp[];
};

export const VOICE_PROFILES: Record<AgentId, VoiceProfile> = {
  arda: { pitch: 1.28, rate: 1.0, voiceGender: 'female', voiceHints: [/seda/i, /emel/i, /yelda/i, /filiz/i, /ayşe|ayse/i, /google türkçe|google turkce/i] },
  nevra: { pitch: 1.2, rate: 1.04, voiceGender: 'female', voiceHints: [/emel/i, /seda/i, /ipek/i, /tulay|tülay/i, /female|woman/i] },
  cem: { pitch: 0.82, rate: 0.94, voiceGender: 'male', voiceHints: [/ahmet/i, /tolga/i, /mert/i, /emre/i, /male|man/i] },
  volkan: { pitch: 0.98, rate: 1.08, voiceGender: 'male', voiceHints: [/tolga/i, /mert/i, /kerem/i, /ozan/i, /male|man/i] },
  defne: { pitch: 1.32, rate: 1.1, voiceGender: 'female', voiceHints: [/ipek/i, /seda/i, /gizem/i, /emel/i, /female|woman/i] },
  kayra: { pitch: 0.96, rate: 1.06, voiceGender: 'neutral', voiceHints: [/google türkçe|google turkce/i, /deniz/i, /neutral/i] },
  deniz: { pitch: 0.88, rate: 0.98, voiceGender: 'male', voiceHints: [/deniz/i, /ahmet/i, /tolga/i, /male|man/i] },
};

const AGENT_SPEECH_NAMES: Record<AgentId, string> = {
  arda: 'Aylin',
  nevra: 'Nevra',
  cem: 'Cem',
  volkan: 'Volkan',
  defne: 'Defne',
  kayra: 'Kayra',
  deniz: 'Deniz',
};

const OPENAI_AGENT_VOICES: Record<AgentId, string> = {
  arda: 'coral',
  nevra: 'sage',
  cem: 'onyx',
  volkan: 'ash',
  defne: 'shimmer',
  kayra: 'verse',
  deniz: 'cedar',
};

const AGENT_TTS_STYLE: Record<AgentId, string> = {
  arda: 'kadın baş mali müşavir; sakin, net, güven veren, yönetici tonu',
  nevra: 'kadın vergi uzmanı; dikkatli, mevzuata hakim, profesyonel ton',
  cem: 'erkek mali analist; sakin, denetçi gibi ölçülü ve analitik ton',
  volkan: 'erkek bordro uzmanı; pratik, hızlı ama anlaşılır ton',
  defne: 'kadın müşteri ilişkileri sorumlusu; sıcak, düzenli, nazik ton',
  kayra: 'genç sistem operatörü; kısa, teknik, net ve enerjik ton',
  deniz: 'erkek sistem sorumlusu; olgun, teknik ama sade anlatan ton',
};

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesLoadedPromise: Promise<SpeechSynthesisVoice[]> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let remoteTtsDisabledUntil = 0;
let remoteTtsWarningShownUntil = 0;

function releaseCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesLoadedPromise) return voicesLoadedPromise;
  voicesLoadedPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve([]);
      return;
    }

    const tryLoad = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        cachedVoices = voices;
        resolve(voices);
      } else {
        setTimeout(tryLoad, 100);
      }
    };

    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoices = window.speechSynthesis.getVoices();
      resolve(cachedVoices);
    };
    tryLoad();
  });
  return voicesLoadedPromise;
}

async function pickVoiceForAgent(agentId: AgentId): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices();
  if (voices.length === 0) return null;

  const profile = VOICE_PROFILES[agentId];
  const femaleNames = /emel|tulay|tülay|aysun|ipek|seda|gizem|yelda|filiz|ayşe|ayse|female|woman|zira|google türkçe|google turkce/i;
  const maleNames = /ahmet|tolga|mert|emre|deniz|kerem|ozan|hakan|yusuf|yunus|male|man/i;

  const scoreVoice = (voice: SpeechSynthesisVoice) => {
    const name = `${voice.name} ${voice.voiceURI}`.toLocaleLowerCase('tr');
    const lang = (voice.lang || '').toLocaleLowerCase('tr');
    const looksFemale = femaleNames.test(name);
    const looksMale = maleNames.test(name);
    let score = 0;
    if (lang.startsWith('tr')) score += 200;
    else if (lang.startsWith('en')) score += 30;
    if (voice.localService) score += 8;
    if (profile.voiceHints.some((hint) => hint.test(name))) score += 500;
    if (profile.voiceGender === 'female') {
      if (looksFemale) score += 300;
      if (looksMale && !looksFemale) score -= 800;
    } else if (profile.voiceGender === 'male') {
      if (looksMale) score += 300;
      if (looksFemale && !looksMale) score -= 800;
    } else if (!looksMale && !looksFemale) {
      score += 60;
    }
    return score;
  };

  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
}

export async function speakAs(agentId: AgentId, text: string) {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return;
  const spokenText = `${AGENT_SPEECH_NAMES[agentId]}. ${cleaned}`;

  if (await speakWithRemoteTts(agentId, spokenText)) return;
  return speakWithBrowserVoice(agentId, spokenText);
}

async function speakWithRemoteTts(agentId: AgentId, text: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return false;
  if (Date.now() < remoteTtsDisabledUntil) return false;

  try {
    const audioBlob = await synthesize(text, OPENAI_AGENT_VOICES[agentId], ttsInstructionsForAgent(agentId));
    const audioUrl = URL.createObjectURL(audioBlob);
    releaseCurrentAudio();
    currentAudioUrl = audioUrl;
    currentAudio = new Audio(audioUrl);
    currentAudio.preload = 'auto';

    await new Promise<void>((resolve, reject) => {
      if (!currentAudio) {
        reject(new Error('Ses nesnesi oluşturulamadı'));
        return;
      }
      currentAudio.onended = () => {
        releaseCurrentAudio();
        resolve();
      };
      currentAudio.onerror = () => {
        releaseCurrentAudio();
        reject(new Error('TTS ses dosyası çalınamadı'));
      };
      currentAudio.play().catch(reject);
    });
    return true;
  } catch (err) {
    remoteTtsDisabledUntil = Date.now() + 60_000;
    if (Date.now() > remoteTtsWarningShownUntil) {
      remoteTtsWarningShownUntil = Date.now() + 120_000;
      toast.warning('AI ses servisi çalışmadı', {
        description: 'Şimdilik tarayıcı sesiyle devam ediyorum. API tarafında OPENAI_API_KEY gerekli.',
      });
    }
    console.warn('Moren Ofis OpenAI TTS devre dışı, browser sesi kullanılıyor:', err);
    return false;
  }
}

async function speakWithBrowserVoice(agentId: AgentId, text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const voice = await pickVoiceForAgent(agentId);
  const profile = VOICE_PROFILES[agentId];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'tr-TR';
  if (voice) utterance.voice = voice;
  utterance.pitch = profile.pitch;
  utterance.rate = profile.rate;
  utterance.volume = 1.0;

  return new Promise<void>((resolve) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeech() {
  releaseCurrentAudio();
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function ttsInstructionsForAgent(agentId: AgentId): string {
  return [
    'Sadece Türkçe konuş. İngilizce aksan veya İngilizce telaffuz kullanma.',
    'İstanbul Türkçesiyle, doğal ofis konuşması gibi oku.',
    'Metindeki muhasebe terimlerini Türkçe telaffuz et; KDV, SGK, Luca, mizan gibi kelimeleri anlaşılır söyle.',
    'Sayıları Türkçe para ve tarih okuma alışkanlığıyla oku.',
    `Karakter: ${AGENT_TTS_STYLE[agentId]}.`,
  ].join(' ');
}

function cleanTextForSpeech(text: string): string {
  return text
    .replace(/^\[[^\]]+\]:\s*/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/```[\s\S]+?```/g, '(kod bloğu)')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

function getRecognition(): any {
  if (typeof window === 'undefined') return null;
  const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRec) return null;
  return new SpeechRec();
}

function formatSpeechRecognitionError(error?: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Mikrofon izni verilmemiş. Tarayıcı adres çubuğundan mikrofon iznini açın.';
    case 'no-speech':
      return 'Ses algılanmadı. Mikrofona daha yakın konuşup tekrar deneyin.';
    case 'audio-capture':
      return 'Mikrofon bulunamadı veya başka bir uygulama kullanıyor.';
    case 'network':
      return 'Tarayıcının ses tanıma servisine ulaşılamadı. İnternet/Chrome ses servisini kontrol edin.';
    case 'aborted':
      return 'Sesli dinleme iptal edildi.';
    case 'language-not-supported':
      return 'Tarayıcı Türkçe ses tanımayı desteklemiyor.';
    default:
      return error || 'Bilinmeyen mikrofon hatası';
  }
}

export function startListening(opts: {
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (err: string) => void;
  onEnd?: () => void;
}): { stop: () => void } | null {
  const rec = getRecognition();
  if (!rec) {
    opts.onError?.('Tarayıcınız sesli komutu desteklemiyor. Chrome veya Edge kullanın.');
    return null;
  }
  rec.lang = 'tr-TR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onresult = (event: any) => {
    let text = '';
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    opts.onResult(text, isFinal);
  };
  rec.onerror = (event: any) => opts.onError?.(formatSpeechRecognitionError(event.error));
  rec.onend = () => opts.onEnd?.();

  try {
    rec.start();
  } catch (err: any) {
    opts.onError?.(err?.message || 'Başlatılamadı');
    return null;
  }
  return { stop: () => { try { rec.stop(); } catch {} } };
}

export function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
}

export function isSynthesisSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof Audio !== 'undefined' || !!window.speechSynthesis;
}
