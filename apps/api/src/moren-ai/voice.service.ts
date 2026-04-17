import { Injectable, BadRequestException, Logger } from '@nestjs/common';

/**
 * Sesli konuşma için STT (Speech-to-Text) + TTS (Text-to-Speech).
 *
 * Yaklaşım: OpenAI Whisper (STT) + OpenAI TTS. API key: OPENAI_API_KEY.
 *
 * Fallback: OPENAI_API_KEY yoksa frontend browser Web Speech API kullanır.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  private getOpenAiKey(): string | null {
    return process.env.OPENAI_API_KEY || null;
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
        'OPENAI_API_KEY ayarlanmamış — sesli giriş için Railway environment\'ına eklenmeli. ' +
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
  async synthesize(text: string, voice = 'nova'): Promise<{ audio: Buffer; contentType: string; durationMs: number }> {
    const key = this.getOpenAiKey();
    if (!key) {
      throw new BadRequestException(
        'OPENAI_API_KEY ayarlanmamış — TTS için Railway environment\'ına eklenmeli.',
      );
    }

    // Uzun metinleri kes — TTS maliyeti token bazlı
    const trimmed = text.length > 4000 ? text.slice(0, 4000) + '…' : text;
    const started = Date.now();

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: trimmed,
        voice,            // nova | alloy | echo | fable | onyx | shimmer
        response_format: 'mp3',
      }),
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
