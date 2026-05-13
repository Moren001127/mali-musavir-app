// Web Speech API yardımcıları — ücretsiz, ek maliyet yok
// Mikrofon: SpeechRecognition (Chrome/Edge native)
// Konuşma: SpeechSynthesis (tüm browser'larda)

import type { AgentId } from '@/lib/moren-ofis';

// Her ajan için ses profili — pitch ve rate ile karakter
// Voice seçimi browser'da mevcut Türkçe ses'lerden yapılır
export const VOICE_PROFILES: Record<AgentId, { pitch: number; rate: number; voiceGender: 'male' | 'female' | 'neutral' }> = {
  arda: { pitch: 1.0, rate: 1.0, voiceGender: 'male' },      // baş müşavir — sakin, net
  nevra: { pitch: 1.1, rate: 1.05, voiceGender: 'female' }, // vergi uzmanı — kararlı
  cem: { pitch: 0.85, rate: 0.95, voiceGender: 'male' },    // denetçi — düşük, sakin
  volkan: { pitch: 1.0, rate: 1.1, voiceGender: 'male' },   // bordro — pratik, hızlı
  defne: { pitch: 1.2, rate: 1.1, voiceGender: 'female' }, // asistan — enerjik
  kayra: { pitch: 0.95, rate: 1.05, voiceGender: 'neutral' }, // operatör — düz
  deniz: { pitch: 0.9, rate: 1.0, voiceGender: 'male' },    // yazılım uzmanı — sakin, yorgun
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

// Her ajan için bir Türkçe ses bul — gender'a göre filtrele
async function pickVoiceForAgent(agentId: AgentId): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices();
  if (voices.length === 0) return null;

  // Önce Türkçe sesleri filtrele
  const trVoices = voices.filter((v) => v.lang.startsWith('tr'));
  const pool = trVoices.length > 0 ? trVoices : voices.filter((v) => v.lang.startsWith('en'));

  const profile = VOICE_PROFILES[agentId];
  // Gender tahmin — Windows TTS'de isim genelde TR-TR-EmelNeural (kadın), TR-TR-AhmetNeural (erkek)
  const femaleNames = /emel|tulay|aysun|ipek|seda|gizem|female|woman/i;
  const maleNames = /ahmet|tolga|mert|emre|deniz|kerem|male|man/i;

  const tryFind = () => {
    if (profile.voiceGender === 'female') {
      return pool.find((v) => femaleNames.test(v.name)) || pool.find((v) => !maleNames.test(v.name));
    }
    if (profile.voiceGender === 'male') {
      return pool.find((v) => maleNames.test(v.name)) || pool.find((v) => !femaleNames.test(v.name));
    }
    return pool[0];
  };

  return tryFind() || pool[0] || null;
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

  const utterance = new SpeechSynthesisUtterance(cleanTextForSpeech(text));
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
  rec.onerror = (event: any) => opts.onError?.(event.error || 'Bilinmeyen hata');
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
