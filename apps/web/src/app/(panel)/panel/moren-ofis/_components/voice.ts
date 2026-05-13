// Web Speech API yardımcıları — ücretsiz, ek maliyet yok
// Mikrofon: SpeechRecognition (Chrome/Edge native)
// Konuşma: SpeechSynthesis (tüm browser'larda)

import type { AgentId } from '@/lib/moren-ofis';

type VoiceGender = 'male' | 'female' | 'neutral';
type VoiceProfile = {
  pitch: number;
  rate: number;
  voiceGender: VoiceGender;
  voiceHints: RegExp[];
};

// Her ajan için ses profili — pitch ve rate ile karakter
// Voice seçimi browser'da mevcut Türkçe ses'lerden yapılır
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

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesLoadedPromise: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesLoadedPromise) return voicesLoadedPromise;
  voicesLoadedPromise = new Promise((resolve) => {
    const tryLoad = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        cachedVoices = voices;
        resolve(voices);
      } else {
        setTimeout(tryLoad, 100);
      }
    };
    // Bazı browser'lar 'voiceschanged' event'i ile yükler
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        cachedVoices = window.speechSynthesis.getVoices();
        resolve(cachedVoices);
      };
      tryLoad();
    } else {
      resolve([]);
    }
  });
  return voicesLoadedPromise;
}

// Her ajan için en uygun sesi bul. Tarayıcıda ses listesi sınırlıysa gender,
// isim ipuçları ve pitch/rate ile karakter ayrımı korunur.
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

/**
 * Ajan adına metni sesli oku.
 * Otomatik queue — her ajan kendi sırasıyla konuşur, üst üste binmez.
 */
export async function speakAs(agentId: AgentId, text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  // Mevcut konuşmayı iptal et — yeni ajan başlasın
  // (alternatif: queue, ama mali müşavirlik için sıralı daha doğal)
  // window.speechSynthesis.cancel();

  const voice = await pickVoiceForAgent(agentId);
  const profile = VOICE_PROFILES[agentId];

  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return;

  const utterance = new SpeechSynthesisUtterance(`${AGENT_SPEECH_NAMES[agentId]}. ${cleaned}`);
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
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// TTS için metni temizle — markdown ve özel karakterleri kaldır
function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/`(.+?)`/g, '$1') // inline code
    .replace(/```[\s\S]+?```/g, '(kod bloğu)') // code blocks
    .replace(/#{1,6}\s+/g, '') // headers
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/\n{2,}/g, '. ') // paragraph -> sentence break
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800); // TTS uzun metni boğar
}

// === SPEECH-TO-TEXT (mikrofon) ===

// SpeechRecognition Chrome/Edge'de var, Firefox'ta yok
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
    opts.onError?.('Tarayıcınız sesli komutu desteklemiyor — Chrome veya Edge kullanın');
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
  return !!window.speechSynthesis;
}
