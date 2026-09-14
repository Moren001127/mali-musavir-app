import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { sesKoordinatorAcik } from './ses-koordinator';

/**
 * Whisper'a giden dosyanın uzantısını MIME türünden türetir (Whisper uzantıya bakar; kabul: flac, mp3,
 * mp4, mpeg, mpga, m4a, ogg, wav, webm). WhatsApp sesli notu "audio/ogg; codecs=opus" → ogg
 * (eskiden bu dal yoktu, her bilinmeyen tür mp3 sayılıyordu). Saf fonksiyon; testte doğrulanır.
 */
export function sesDosyaUzantisi(mimetype: string): 'webm' | 'm4a' | 'wav' | 'ogg' | 'mp3' {
  const m = String(mimetype || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg') || m.includes('opus') || m.includes('oga')) return 'ogg';
  return 'mp3';
}

/**
 * Sesli konuşma için STT (Speech-to-Text) + TTS (Text-to-Speech) + Realtime oturum anahtarı.
 *
 * Yaklaşım: OpenAI Whisper (STT) + OpenAI TTS + OpenAI Realtime (kulak+ağız). Varsayılan kapalıdır.
 * Beyin Max'tedir: Realtime'ın portal_query aracı → realtimePortalQuery → EKİP koordinatörü
 * (EKIP_SES_KOORDINATOR != off) ya da chat(voiceMode).
 *
 * Fallback: MOREN_AI_ALLOW_OPENAI_API=1 yoksa frontend browser Web Speech API kullanır.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  private getOpenAiKey(): string | null {
    if (process.env.MOREN_AI_ALLOW_OPENAI_API !== '1') return null;
    return process.env.OPENAI_API_KEY || null;
  }

  /** Ses hattı açık mı? (MOREN_AI_ALLOW_OPENAI_API=1 + OPENAI_API_KEY). Kapalıysa çağıran sessizce yazılı akışta kalır. */
  sesHattiAcik(): boolean {
    return !!this.getOpenAiKey();
  }

  async createRealtimeClientSecret(identity?: { userName?: string; officeName?: string }) {
    const key = this.getOpenAiKey();
    if (!key) {
      throw new BadRequestException(
        'OpenAI ses API hattı kapalı. MOREN_AI_ALLOW_OPENAI_API=1 verilmeden API çağrısı yapılmaz.',
      );
    }

    const office = identity?.officeName || 'Moren Mali Müşavirlik';
    // Sahibin kimliğini talimata göm: ses katmanı "ben kimim / beni tanıyor musun"
    // sorularını anında, doğru cevaplasın (eskiden ses oturumu kimliği bilmiyordu).
    const identityLine = identity?.userName
      ? `Şu an seninle konuşan kişi ${identity.userName}, ${office} ofisinin meslek mensubu/sahibi. "Ben kimim", "beni tanıyor musun", "adım ne" diye sorarsa bunu net söyle; ASLA "bilmiyorum/tahmin edemem" deme, isim de TAHMİN etme. `
      : '';

    const payload = {
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: {
        type: 'realtime',
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini',
        instructions:
          `Türkçe konuş. Kadın sesli, doğal ve sakin ol. Sen ${office} ofisinin canlı ses katmanı MOREN AI'sın. ` +
          identityLine +
          'Karşındaki kişi bu ofisin mali müşavir meslek mensubu; asla "mali müşavire danışın", "uzmana başvurun" veya sorumluluk reddi deme. ' +
          (sesKoordinatorAcik()
            ? 'Muhatabın ofisin yapay çalışan ekibinin KOORDİNATÖRÜ (Ofis Müdürü): portal_query çağrısı doğrudan ona gider; o veriyi toplar, işi ekibe dağıtır, riskli işi sahibin onayına düşürür. Cevap gelmesi 10-60 saniye sürebilir; bekle, uydurma. Kullanıcı "canlı yap", "gerçek çalıştır", "kuru test olmasın" derse bu sözleri question metnine AYNEN koy (canlı mod bu sözle açılır). ' +
              'Koordinatör "ONAYLIYORUM #PRV-…" beklediğini söylerse kullanıcı aynen bu sözü söyleyince onu question olarak ilet. '
            : '') +
          'ARAÇ KULLANIMI: Veri, mükellef, vergi, SGK, beyan, mali tablo, hafıza, portal işlemi GEREKEN sorularda VE kullanıcının kendisi/kimliği/portal/kabiliyetleri ("neler yapabilirsin", "portal ne işe yarar") hakkındaki sorularda portal_query toolunu çağır ve dönen cevabı söyle. SADECE düz selamlaşma ve tamam/evet/hayır gibi tek kelimelik onaylarda tool kullanma; o zaman çok kısa cevap ver. ' +
          'Cevaplar kısa, net ve mesleki olsun: 1-3 cümle.',
        tool_choice: 'auto',
        tools: [
          {
            type: 'function',
            name: 'portal_query',
            description:
              'Her sesli kullanici sorusunu MOREN AI portal backendine iletir. Mukellef, vergi, SGK, hukuk, mevzuat, mali tablo, hafiza, maliyet ve portal islemleri icin her zaman bunu kullan.',
            parameters: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description: 'Kullanicinin sesli sorusunun kisa ve net metin hali.',
                },
              },
              required: ['question'],
            },
          },
        ],
        audio: {
          input: {
            // Mikrofon gürültüsünü bastır; VAD'in ortam "çıt" seslerine takılmasını azaltır.
            noise_reduction: { type: 'near_field' },
            // Akıllı sıra-algılama: ses enerjisine değil, konuşmanın gerçekten bitip
            // bitmediğine bakar. Küçük/ani seslerde cevabı kesmez; kullanıcı gerçekten
            // konuşmaya başlayınca doğal şekilde araya girilebilir (interrupt_response).
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'low',
              interrupt_response: true,
              create_response: true,
            },
          },
          output: {
            voice: process.env.OPENAI_REALTIME_VOICE || 'marin',
          },
        },
      },
    };

    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`Realtime token hata: ${res.status} — ${err.slice(0, 500)}`);
      throw new BadRequestException(`Realtime ses başlatılamadı: ${err.slice(0, 200)}`);
    }

    return res.json();
  }

  /**
   * Ses dosyasını metne çevirir (Whisper).
   * @param audio  Buffer (mp3/wav/webm/m4a)
   * @param mimetype
   */
  async transcribe(audio: Buffer, mimetype: string, language = 'tr'): Promise<{ text: string; durationMs: number }> {
    const key = this.getOpenAiKey();
    if (!key) {
      throw new BadRequestException(
        'OpenAI ses API hattı kapalı. MOREN_AI_ALLOW_OPENAI_API=1 verilmeden API çağrısı yapılmaz. ' +
        'Alternatif: frontend browser Web Speech API kullansın.',
      );
    }

    const started = Date.now();

    // Dosya uzantısını mimetype'tan türet (ogg dalı: WhatsApp sesli notu)
    const ext = sesDosyaUzantisi(mimetype);

    const fd = new FormData();
    // Node 18+ global Blob — Buffer BufferSource olarak kabul edilir
    const blob = new Blob([audio as unknown as ArrayBuffer], { type: mimetype });
    fd.append('file', blob, `ses.${ext}`);
    fd.append('model', 'whisper-1');
    fd.append('language', language);
    fd.append('response_format', 'json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: fd,
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`Whisper hata: ${res.status} — ${err.slice(0, 500)}`);
      throw new BadRequestException(`STT hatası: ${err.slice(0, 200)}`);
    }

    const data: any = await res.json();
    return {
      text: (data.text || '').trim(),
      durationMs: Date.now() - started,
    };
  }

  /**
   * Metni sese çevirir (OpenAI tts-1).
   * @param text
   * @returns mp3 buffer
   */
  async synthesize(
    text: string,
    voice = 'nova',
    instructions?: string,
  ): Promise<{ audio: Buffer; contentType: string; durationMs: number }> {
    // Uzun metinleri kes — TTS maliyeti token bazlı
    return this.seslendir(text, { voice, instructions, format: 'mp3', contentType: 'audio/mpeg', maxChars: 4000 });
  }

  /**
   * WhatsApp SESLİ NOTU için metni Ogg/Opus'a çevirir (OpenAI TTS response_format:'opus'; ffmpeg gerekmez,
   * Baileys'e ptt:true ile doğrudan verilir). Ses/ton MOREN AI ses ekranıyla aynı (nova).
   * Tavan 900 karakter: uzun raporun yalnız başı seslendirilir; tamamı yazılı mesaj olarak zaten gider.
   */
  async synthesizeOpus(
    text: string,
    opts?: { voice?: string; instructions?: string; maxChars?: number },
  ): Promise<{ audio: Buffer; contentType: string; durationMs: number }> {
    return this.seslendir(text, {
      voice: opts?.voice || 'nova',
      instructions: opts?.instructions,
      format: 'opus',
      contentType: 'audio/ogg; codecs=opus',
      maxChars: opts?.maxChars ?? 900,
    });
  }

  /** Ortak TTS çağrısı (mp3 = portal ses ekranı, opus = WhatsApp sesli notu). */
  private async seslendir(
    text: string,
    o: { voice: string; instructions?: string; format: 'mp3' | 'opus'; contentType: string; maxChars: number },
  ): Promise<{ audio: Buffer; contentType: string; durationMs: number }> {
    const key = this.getOpenAiKey();
    if (!key) {
      throw new BadRequestException(
        'OpenAI TTS API hattı kapalı. MOREN_AI_ALLOW_OPENAI_API=1 verilmeden API çağrısı yapılmaz.',
      );
    }

    const trimmed = text.length > o.maxChars ? text.slice(0, o.maxChars) + '…' : text;
    const started = Date.now();

    const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
    const payload: Record<string, any> = {
      model,
      input: trimmed,
      voice: o.voice,
      response_format: o.format,
    };
    if (o.instructions?.trim() && model.includes('gpt-4o')) {
      payload.instructions = o.instructions.trim().slice(0, 1200);
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`TTS hata (${o.format}): ${res.status} — ${err.slice(0, 500)}`);
      throw new BadRequestException(`TTS hatası: ${err.slice(0, 200)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuf),
      contentType: o.contentType,
      durationMs: Date.now() - started,
    };
  }
}
