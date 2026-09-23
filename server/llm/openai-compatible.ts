import { LLMProvider, LLMMessage, LLMResponse } from './provider.js';

export class OpenAICompatibleProvider implements LLMProvider {
  private apiKey: string | null;
  private baseUrl: string;
  private model: string;
  private providerName: string;

  private timeoutMs: number;
  private maxRetries: number;

  constructor(options: {
    apiKey?: string | null;
    baseUrl?: string;
    model?: string;
    providerName?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    this.apiKey = options.apiKey || null;
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = options.model || 'gpt-4o-mini';
    this.providerName = options.providerName || 'OpenAI';
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.model,
      messages,
      temperature: 0.3,
    });

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`${this.providerName} API 错误: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        return { content: data.choices[0].message.content };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const statusMatch = lastError.message.match(/(\d{3})/);
        if (statusMatch && !['500', '502', '503', '504'].includes(statusMatch[1])) {
          throw lastError;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new Error(`${this.providerName} API 请求失败（已重试 ${this.maxRetries} 次）: ${lastError?.message}`);
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const modelsResponse = await fetch(`${this.baseUrl}/models`, { headers });

      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json();
        const modelList = modelsData.data || modelsData;
        const modelNames = Array.isArray(modelList)
          ? modelList.map((m: any) => m.id || m.name || m).slice(0, 5)
          : [];
        return {
          success: true,
          message: `${this.providerName} 连接成功`,
          model: modelNames.length > 0 ? modelNames[0] : this.model,
        };
      }

      if (modelsResponse.status === 401 || modelsResponse.status === 403) {
        return { success: false, message: `${this.providerName} 认证失败，请检查 API Key` };
      }

      const chatResponse = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5,
        }),
      });

      if (chatResponse.ok) {
        return { success: true, message: `${this.providerName} 连接成功`, model: this.model };
      }

      const errText = await chatResponse.text();
      return { success: false, message: `${this.providerName} 连接失败: ${chatResponse.status} - ${errText.slice(0, 100)}` };
    } catch (err: any) {
      return { success: false, message: `${this.providerName} 连接失败: ${err.message}` };
    }
  }
}

export function createOpenAIProvider(apiKey: string, baseUrl?: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: baseUrl || 'https://api.openai.com/v1',
    model: model || 'gpt-4o-mini',
    providerName: 'OpenAI',
  });
}

export function createDeepSeekProvider(apiKey: string, baseUrl?: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: baseUrl || 'https://api.deepseek.com/v1',
    model: model || 'deepseek-chat',
    providerName: 'DeepSeek',
  });
}

export function createLMStudioProvider(baseUrl?: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey: null,
    baseUrl: baseUrl || 'http://localhost:1234/v1',
    model: model || '',
    providerName: 'LM Studio',
  });
}

export function createCustomProvider(apiKey: string | null, baseUrl?: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: baseUrl || 'http://localhost:8080/v1',
    model: model || '',
    providerName: 'Custom',
  });
}
