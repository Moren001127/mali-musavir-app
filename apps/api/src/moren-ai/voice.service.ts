import { Injectable, BadRequestException, Logger } from '@nestjs/common';

/**
 * Sesli konuşma için STT (Speech-to-Text) + TTS (Text-to-Speech).
 *
 * Yaklaşım: OpenAI Whisper (STT) + OpenAI TTS. Varsayılan kapalıdır.
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

  async createRealtimeClientSecret() {
    const key = this.getOpenAiKey();
    if (!key) {
      throw new BadRequestException(
        'OpenAI ses API hattı kapalı. MOREN_AI_ALLOW_OPENAI_API=1 verilmeden API çağrısı yapılmaz.',
      );
    }

    const payload = {
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: {
        type: 'realtime',
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini',
        instructions:
          'Türkçe konuş. Kadın sesli, doğal ve sakin ol. Sen portalın canlı ses katmanısın. Veri, mükellef, vergi, SGK, beyan, mali tablo, hafıza veya portal işlemi gereken sorularda portal_query toolunu çağır ve MOREN AI backend cevabını söyle. Selamlaşma, tamam/evet/hayır gibi kısa onaylar ve sohbet niteliğindeki cümlelerde tool kullanmadan çok kısa cevap ver. Karşındaki kişi mali müşavir meslek mensubu; asla "mali müşavire danışın", "uzmana başvurun" veya sorumluluk reddi deme. Cevaplar kısa, net ve mesleki olsun: 1-3 cümle.',
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

    // Dosya uzantısını mimetype'tan türet
    const ext = mimetype.includes('webm') ? 'webm'
              : mimetype.includes('mp4') || mimetype.includes('m4a') ? 'm4a'
              : mimetype.includes('wav') ? 'wav' : 'mp3';

    const fd = new FormData();
    // Node 18+ global Blob — Buffer BufferSource olarak kabul edilir
    const blob = new Blob([audio as unknown as ArrayBuffer], { type: mimetype });
    fd.append('file', blob, `audio.${ext}`);
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
    const key = this.getOpenAiKey();
    if (!key) {
      throw new BadRequestException(
        'OpenAI TTS API hattı kapalı. MOREN_AI_ALLOW_OPENAI_API=1 verilmeden API çağrısı yapılmaz.',
      );
    }

    // Uzun metinleri kes — TTS maliyeti token bazlı
    const trimmed = text.length > 4000 ? text.slice(0, 4000) + '…' : text;
    const started = Date.now();

    const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
    const payload: Record<string, any> = {
      model,
      input: trimmed,
      voice,
      response_format: 'mp3',
    };
    if (instructions?.trim() && model.includes('gpt-4o')) {
      payload.instructions = instructions.trim().slice(0, 1200);
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
      this.logger.error(`TTS hata: ${res.status} — ${err.slice(0, 500)}`);
      throw new BadRequestException(`TTS hatası: ${err.slice(0, 200)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuf),
      contentType: 'audio/mpeg',
      durationMs: Date.now() - started,
    };
  }
}
