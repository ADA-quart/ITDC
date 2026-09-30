import { LLMProvider, LLMMessage, LLMResponse, ModelListResult } from './provider.js';

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

  /** 列出本地已安装的模型（GET /api/tags） */
  async listModels(): Promise<ModelListResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) {
        return { success: false, models: [], message: `Ollama 返回 ${res.status}` };
      }
      const data = await res.json();
      const models: string[] = (data?.models || [])
        .map((m: any) => m?.name || m?.model || m)
        .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0);

      const unique = Array.from(new Set<string>(models)).sort();
      return {
        success: unique.length > 0,
        models: unique,
        message: unique.length > 0 ? undefined : 'Ollama 尚未安装任何模型（可先执行 ollama pull）',
      };
    } catch (err: any) {
      return { success: false, models: [], message: `Ollama 连接失败: ${err.message}` };
    }
  }
}
