import { Injectable, Logger } from '@nestjs/common';
import { claudeTextViaMax, isMaxAvailable } from '../../common/max-inference';

/**
 * OpenRouter adapter — Claude / GPT-5 / Gemini / DeepSeek hepsine tek API'dan.
 * https://openrouter.ai/docs
 *
 * ENV:
 *   OPENROUTER_API_KEY — gerekli
 *
 * Maliyet: OpenRouter %5 markup ekler. Karşılığında tek SDK, tek auth.
 * İleride direct API'lere geçilebilir.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string; // 'anthropic/claude-sonnet-4-6', 'openai/gpt-5', vb.
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  // Prompt caching için Anthropic'in ekstra parametresi (OpenRouter geçirir)
  cachePromptPrefix?: boolean;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd?: number;
  };
}

@Injectable()
export class OpenRouterAdapter {
  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly apiKey = process.env.OPENROUTER_API_KEY || '';
  private readonly baseUrl = 'https://openrouter.ai/api/v1';

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // CLAUDE modelleri → Max aboneliği (ücretsiz). GPT/Gemini gibi Claude-dışı modeller OpenRouter'da kalır.
    const isClaude = /claude/i.test(req.model);
    if (isClaude && isMaxAvailable()) {
      const maxModel = req.model.replace(/^anthropic\//, '');
      const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined;
      const convo = req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => `${m.role === 'assistant' ? 'Asistan' : 'Kullanıcı'}: ${m.content}`)
        .join('\n\n');
      const max = await claudeTextViaMax({ prompt: convo || ' ', system, model: maxModel });
      if (max.ok) {
        return {
          content: max.text,
          model: max.model,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
        };
      }
      this.logger.warn(`Max çağrısı başarısız (${req.model}): ${max.error}`);
      // API fallback yalnızca açıkça izin verilmişse; değilse yumuşak hata (orkestrasyon çökmesin).
      if (process.env.AI_ALLOW_API_FALLBACK !== '1') {
        // Ham hata kullanıcıya gösterilmez; gerçek hata yukarıda loglandı (line 64).
        return {
          content: 'Şu anda yanıt üretemiyorum, servis geçici olarak yanıt vermedi. Lütfen birazdan tekrar deneyin.',
          model: req.model,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
        };
      }
      // izin verildiyse aşağıdaki OpenRouter akışına düş
    }

    // MAX-ONLY GÜVENLİĞİ: Claude-DIŞI model (GPT/Gemini vb.) = ücretli OpenRouter
    // çağrısı. Bu, Max-only kuralının sessiz bypass yüzeyiydi. Yalnız açık izinle
    // (AI_ALLOW_API_FALLBACK=1) geç; aksi halde yumuşak hata ver, ücretli API'ye düşme.
    if (!isClaude && process.env.AI_ALLOW_API_FALLBACK !== '1') {
      this.logger.warn(`Claude-disi model (${req.model}) AI_ALLOW_API_FALLBACK=1 olmadan reddedildi (Max-only kurali).`);
      return {
        content: 'Şu anda yanıt üretemiyorum (yalnız Max modelleri etkin).',
        model: req.model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
      };
    }

    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY env değişkeni tanımlı değil');
    }

    const body: any = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 1500,
    };

    // Prompt caching — Anthropic modelleri için system prompt'u cache et
    if (req.cachePromptPrefix && req.model.startsWith('anthropic/')) {
      const sys = req.messages.find((m) => m.role === 'system');
      if (sys && sys.content.length > 1000) {
        // OpenRouter Anthropic provider'ı cache_control attribute'unu pass'liyor
        body.messages = req.messages.map((m) =>
          m.role === 'system'
            ? { role: 'system', content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
            : m,
        );
      }
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://portal.morenmusavirlik.com',
        // HTTP header'lar ASCII-only. Türkçe karakterler "ByteString" hatasını
        // patlatıyor: ş (U+015F = 351) > 255. Sade ASCII kullan.
        'X-Title': 'Moren Mali Musavirlik Ofisi',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      this.logger.error(`OpenRouter boş choices: ${JSON.stringify(data).slice(0, 300)}`);
      throw new Error('Model yanıtı boş geldi (choices yok)');
    }

    // İçerik OpenAI/Anthropic farklı yerlerde olabilir; hepsini dene
    const msg = choice.message || {};
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Anthropic content block formatı: [{ type: 'text', text: '...' }]
      content = msg.content
        .filter((b: any) => b?.type === 'text' || typeof b === 'string')
        .map((b: any) => (typeof b === 'string' ? b : b.text || ''))
        .join('\n');
    }
    // Refusal fallback (OpenAI)
    if (!content && msg.refusal) content = `[Reddedildi: ${msg.refusal}]`;
    // Tool call fallback
    if (!content && msg.tool_calls?.length) {
      content = '[Tool çağrısı: ' + msg.tool_calls.map((t: any) => t.function?.name || 'unknown').join(', ') + ']';
    }
    // Hala boşsa raw debug
    if (!content) {
      this.logger.warn(`Model ${req.model} boş içerik döndü. Raw choice: ${JSON.stringify(choice).slice(0, 300)}`);
      content = `[${req.model} boş cevap döndü — modeli kontrol et veya farklı sor]`;
    }

    return {
      content,
      model: data.model || req.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        costUsd: data.usage?.cost,
      },
    };
  }
}
