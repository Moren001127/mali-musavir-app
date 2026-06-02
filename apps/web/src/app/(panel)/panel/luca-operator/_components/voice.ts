'use client';

// Luca Operatörü için sade tarayıcı sesi (tr-TR).
// Ücretsizdir — OpenAI TTS kullanmaz. Giriş: SpeechRecognition, çıkış: SpeechSynthesis.
// Faz 1'de yeterli; ileride istenirse backend voice uçlarına (OpenAI) geçilebilir.

type Listener = { stop: () => void };

export function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function isSynthesisSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.speechSynthesis !== 'undefined';
}

export function startListening(opts: {
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (err: string) => void;
  onEnd?: () => void;
}): Listener | null {
  if (!isSpeechSupported()) {
    opts.onError?.('Tarayıcı ses tanımayı desteklemiyor');
    return null;
  }
  const Rec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = 'tr-TR';
  rec.interimResults = true;
  rec.continuous = false;

  rec.onresult = (event: any) => {
    let transcript = '';
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    opts.onResult(transcript, isFinal);
  };
  rec.onerror = (event: any) => {
    const code = event?.error || 'bilinmeyen';
    const map: Record<string, string> = {
      'not-allowed': 'Mikrofon izni verilmedi',
      'no-speech': 'Ses algılanmadı',
      network: 'Ağ hatası (Chrome ses servisi)',
      aborted: 'İptal edildi',
    };
    opts.onError?.(map[code] || code);
  };
  rec.onend = () => opts.onEnd?.();

  try {
    rec.start();
  } catch (e: any) {
    opts.onError?.(e?.message || 'başlatılamadı');
    return null;
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {}
    },
  };
}

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!isSynthesisSupported() || !text.trim()) {
      resolve();
      return;
    }
    // Markdown işaretlerini sadeleştir, çok uzun metni kırp
    const clean = text
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/[*_`#>]/g, '')
      .slice(0, 1000);
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'tr-TR';
    u.rate = 1.0;
    u.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const tr = voices.find((v) => v.lang?.toLowerCase().startsWith('tr'));
    if (tr) u.voice = tr;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

export function stopSpeech() {
  if (typeof window === 'undefined' || !isSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {}
}
