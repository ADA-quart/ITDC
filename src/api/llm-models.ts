// 直接从大模型服务商拉取模型列表。
//
// 常规路径是服务端代理：密钥存在服务器、由服务器出网。但有三种情况走不通 ——
//   · 仅本机模式根本没有服务器
//   · 服务器被判为不可达（本次会话退化为本机模式）
//   · 服务器进程还是旧版本，没有 /llm-config/models 这个接口
// DeepSeek / OpenAI / LM Studio 的 GET /models 与 Ollama 的 GET /api/tags
// 都带 CORS 响应头，因此 App 可以直接问服务商要列表，作为服务端路径的兜底。

export interface ModelListResult {
  success: boolean;
  models: string[];
  message?: string;
  /** server = 经服务器代理；direct = App 直连服务商 */
  source?: 'server' | 'direct';
}

/** 与 server/llm 中各 provider 的默认地址保持一致，避免两端解析出不同端点 */
export const PROVIDER_DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
  custom: '',
};

const DIRECT_TIMEOUT_MS = 12000;

/** 把用户填的地址与默认地址归一成同一个端点，容忍尾部斜杠 */
export function resolveProviderBase(provider: string, baseUrl?: string | null): string {
  const typed = (baseUrl || '').trim();
  const base = typed || PROVIDER_DEFAULT_BASE[provider] || '';
  return base.replace(/\/+$/, '');
}

/**
 * 直连服务商查询模型列表。
 * 不抛异常：所有失败都转成带 message 的结果，调用方直接展示即可。
 */
export async function fetchModelsDirect(params: {
  provider: string;
  apiKey?: string | null;
  baseUrl?: string | null;
}): Promise<ModelListResult> {
  const { provider } = params;
  const base = resolveProviderBase(provider, params.baseUrl);
  if (!base) {
    return { success: false, models: [], message: '请先填写 API 地址', source: 'direct' };
  }

  // Ollama 的模型列表在 /api/tags，其余 OpenAI 兼容端点都是 /models
  const url = provider === 'ollama' ? `${base}/api/tags` : `${base}/models`;
  const headers: Record<string, string> = {};
  const apiKey = (params.apiKey || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });

    if (res.status === 401 || res.status === 403) {
      return { success: false, models: [], message: '认证失败，请检查 API Key 是否正确', source: 'direct' };
    }
    if (!res.ok) {
      return { success: false, models: [], message: `接口返回 ${res.status}`, source: 'direct' };
    }

    const data: any = await res.json();
    // OpenAI 用 { data: [...] }，Ollama 用 { models: [...] }，也有端点直接返回数组
    const raw = Array.isArray(data) ? data : data?.data ?? data?.models;
    const mapped = (Array.isArray(raw) ? raw : []).map((m: any) =>
      typeof m === 'string' ? m : m?.id || m?.name || m?.model
    );
    const models = Array.from(
      new Set(mapped.filter((m: unknown): m is string => typeof m === 'string' && m.length > 0))
    ).sort();

    return {
      success: models.length > 0,
      models,
      message: models.length > 0 ? undefined : '服务商没有返回可用模型',
      source: 'direct',
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      success: false,
      models: [],
      message: aborted
        ? '请求超时，请检查网络'
        : `无法直连 ${base}（网络不通，或被浏览器跨域策略拦截）`,
      source: 'direct',
    };
  } finally {
    clearTimeout(timer);
  }
}
