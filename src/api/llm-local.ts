// 本机模式直连大模型：不经过服务器，WebView 直接 POST 服务商接口。
//
// 之所以可行：DeepSeek / OpenAI 兼容端点与 Ollama 都返回 CORS 响应头
// （已在 v1.6.1 的模型列表直连上验证），Android WebView 与桌面浏览器都能直接调用。
import { PROVIDER_DEFAULT_BASE, resolveProviderBase } from './llm-models';
import type { LLMConfig } from '../types';

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 附带的图片（data URL）。OpenAI 兼容端点转成 content 数组，Ollama 转成 images 字段 */
  images?: string[];
}

export interface LocalModelConfig {
  provider: LLMConfig['provider'] | string;
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
  thinking_effort?: LLMConfig['thinking_effort'] | null;
}

// 大模型排程动辄要思考一两分钟（推理型模型更久，实测 v4-pro 约 197s），
// 超时给足但要能中断。
const CHAT_TIMEOUT_MS = 240000;

/** 服务商默认模型：用户没填模型名时兜底，避免发空 model 被拒 */
const DEFAULT_MODEL: Record<string, string> = {
  openai: 'gpt-4o-mini',
  // 实测 deepseek-chat 排程会无视课表冲突（4 处冲突被本地校验拦下），
  // deepseek-flash 能遵守约束（约 18s）；v4-pro 质量更高但约 197s，接近超时上限
  deepseek: 'deepseek-flash',
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

/** OpenAI 兼容端点：带图消息的 content 从字符串换成 [text, image_url...] 数组 */
function toOpenAIMessages(messages: LocalChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (!m.images?.length) {
      const { images: _skip, ...rest } = m;
      return rest;
    }
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    };
  });
}

/** Ollama：图片走 messages[].images（纯 base64，不带 data URL 前缀） */
function toOllamaMessages(messages: LocalChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (!m.images?.length) {
      const { images: _skip, ...rest } = m;
      return rest;
    }
    return {
      role: m.role,
      content: m.content,
      images: m.images.map((img) => (img.includes(',') ? img.slice(img.indexOf(',') + 1) : img)),
    };
  });
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

  let body: string;
  if (isOllama) {
    body = JSON.stringify({ model, messages: toOllamaMessages(messages), stream: false });
  } else {
    const payload: Record<string, unknown> = { model, messages: toOpenAIMessages(messages), temperature: 0.3 };
    // DeepSeek V4 默认 high 思考，排程这种结构化任务用 low 足够快，
    // 关思考（none）最快但可能忽略约束，最终仍由本地校验器兜底。
    if (config.provider === 'deepseek') {
      const effort = config.thinking_effort || 'low';
      if (effort === 'none') payload.thinking = { type: 'disabled' };
      else payload.reasoning_effort = effort;
    }
    body = JSON.stringify(payload);
  }

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
