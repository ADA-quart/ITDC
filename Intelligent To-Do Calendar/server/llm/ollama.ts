import { LLMProvider, LLMMessage, LLMResponse } from './provider.js';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.model = model || 'llama3';
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API 错误: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return { content: data.message.content };
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return { success: false, message: `Ollama 连接失败: ${response.status}` };
      }
      const data = await response.json();
      const modelNames: string[] = (data.models || []).map((m: any) => m.name || m.model || m);
      return {
        success: true,
        message: `Ollama 连接成功，可用模型: ${modelNames.slice(0, 5).join(', ')}`,
        model: modelNames.length > 0 ? modelNames[0] : this.model,
      };
    } catch (err: any) {
      return { success: false, message: `Ollama 连接失败: ${err.message}` };
    }
  }
}
