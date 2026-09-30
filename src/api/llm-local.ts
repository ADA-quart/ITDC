// 本机模式直连大模型：不经过服务器，WebView 直接 POST 服务商接口。
//
// 之所以可行：DeepSeek / OpenAI 兼容端点与 Ollama 都返回 CORS 响应头
// （已在 v1.6.1 的模型列表直连上验证），Android WebView 与桌面浏览器都能直接调用。
import { PROVIDER_DEFAULT_BASE, resolveProviderBase } from './llm-models';
import type { LLMConfig } from '../types';

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalModelConfig {
  provider: LLMConfig['provider'] | string;
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
}

const CHAT_TIMEOUT_MS = 90000;

/** 服务商默认模型：用户没填模型名时兜底，避免发空 model 被拒 */
const DEFAULT_MODEL: Record<string, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  ollama: 'llama3',
  lmstudio: '',
  custom: '',
};

export function resolveModel(config: LocalModelConfig): string {
  const typed = (config.model || '').trim();
  if (typed) return typed;
  return DEFAULT_MODEL[config.provider] || '';
}

export function resolveBase(config: LocalModelConfig): string {
  return resolveProviderBase(config.provider, config.base_url)
    || PROVIDER_DEFAULT_BASE[config.provider]
    || '';
}

async function readErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return '';
    // 服务商多半返回 JSON，抽 message/error 字段，抽不到就截原文
    try {
      const data = JSON.parse(text);
      return data?.error?.message || data?.message || data?.error || text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}

/** 直连对话补全。失败时抛出带可读文案的 Error，由排程层转成校验错误展示 */
export async function chatLocal(config: LocalModelConfig, messages: LocalChatMessage[]): Promise<string> {
  const base = resolveBase(config);
  if (!base) throw new Error('未配置大模型地址');

  const model = resolveModel(config);
  const isOllama = config.provider === 'ollama';
  const url = isOllama ? `${base}/api/chat` : `${base}/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = (config.api_key || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = isOllama
    ? JSON.stringify({ model, messages, stream: false })
    : JSON.stringify({ model, messages, temperature: 0.3 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      throw new Error('API Key 认证失败，请在设置里检查密钥');
    }
    if (!res.ok) {
      const detail = await readErrorText(res);
      throw new Error(`大模型返回 ${res.status}${detail ? '：' + detail : ''}`);
    }

    const data: any = await res.json();
    const content = isOllama ? data?.message?.content : data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('大模型没有返回内容');
    }
    return content;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('大模型响应超时，请稍后重试或换用更快的模型');
    }
    if (err instanceof Error) throw err;
    throw new Error(`无法连接大模型：${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 测试连通性：先查模型列表，列表接口不可用时用一次最小对话兜底 */
export async function testLocalConnection(
  config: LocalModelConfig
): Promise<{ success: boolean; message: string; model?: string }> {
  const base = resolveBase(config);
  const model = resolveModel(config);
  if (!base) return { success: false, message: '请先填写 API 地址' };

  try {
    const res = await fetch(base + (config.provider === 'ollama' ? '/api/tags' : '/models'), {
      headers: config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {},
    });
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'API Key 认证失败，请检查密钥' };
    }
    if (res.ok) {
      return { success: true, message: '连接成功', model: model || undefined };
    }
  } catch {
    return { success: false, message: `无法连接 ${base}（网络不通或被跨域策略拦截）` };
  }

  // 部分自建网关不开放模型列表，但对话接口可用
  try {
    await chatLocal(config, [{ role: 'user', content: 'ping' }]);
    return { success: true, message: '连接成功', model: model || undefined };
  } catch (err: any) {
    return { success: false, message: err?.message || '连接失败' };
  }
}
