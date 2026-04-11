import { LLMProvider, LLMMessage, LLMResponse } from './provider.js';

/**
 * 通用 OpenAI 兼容 API Provider
 * 适用于 OpenAI、DeepSeek 及所有兼容 OpenAI Chat Completions API 的服务商
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private apiKey: string | null;
  private baseUrl: string;
  private model: string;
  private providerName: string;

  constructor(options: {
    apiKey?: string | null;
    baseUrl?: string;
    model?: string;
    providerName?: string;
  }) {
    this.apiKey = options.apiKey || null;
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = options.model || 'gpt-4o-mini';
    this.providerName = options.providerName || 'OpenAI';
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${this.providerName} API 错误: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return { content: data.choices[0].message.content };
  }
}

/**
 * 便捷工厂函数：创建 OpenAI Provider
 */
export function createOpenAIProvider(apiKey: string, baseUrl?: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: baseUrl || 'https://api.openai.com/v1',
    model: model || 'gpt-4o-mini',
    providerName: 'OpenAI',
  });
}

/**
 * 便捷工厂函数：创建 DeepSeek Provider
 */
export function createDeepSeekProvider(apiKey: string, baseUrl?: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: baseUrl || 'https://api.deepseek.com/v1',
    model: model || 'deepseek-chat',
    providerName: 'DeepSeek',
  });
}
