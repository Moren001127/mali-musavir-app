import { Injectable, Logger } from '@nestjs/common';

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
    if (!choice) throw new Error('OpenRouter yanıtı boş');

    return {
      content: choice.message?.content || '',
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
