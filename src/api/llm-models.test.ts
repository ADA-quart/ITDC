import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchModelsDirect, resolveProviderBase } from './llm-models';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('resolveProviderBase', () => {
  it('未填地址时用服务商默认端点', () => {
    expect(resolveProviderBase('deepseek')).toBe('https://api.deepseek.com/v1');
    expect(resolveProviderBase('ollama')).toBe('http://localhost:11434');
  });

  it('用户填的地址优先，并容忍尾部斜杠', () => {
    expect(resolveProviderBase('deepseek', 'https://proxy.example.com/v1/')).toBe('https://proxy.example.com/v1');
    expect(resolveProviderBase('custom', '   ')).toBe('');
  });
});

describe('fetchModelsDirect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('解析 OpenAI 兼容的 { data: [...] }，去重并排序', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }, { id: 'deepseek-chat' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchModelsDirect({ provider: 'deepseek', apiKey: 'sk-test' });

    expect(result.success).toBe(true);
    expect(result.models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(result.source).toBe('direct');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/models');
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer sk-test');
  });

  it('Ollama 走 /api/tags 并解析 name 字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ models: [{ name: 'llama3' }, { name: 'qwen2.5' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchModelsDirect({ provider: 'ollama' });

    expect(result.models).toEqual(['llama3', 'qwen2.5']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
  });

  it('401 归为认证失败', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad key' }, 401)));

    const result = await fetchModelsDirect({ provider: 'deepseek', apiKey: 'wrong' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('认证失败');
  });

  it('网络异常不抛出，转成可直接展示的文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await fetchModelsDirect({ provider: 'openai', apiKey: 'sk' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('无法直连');
  });

  it('自定义服务商没填地址时提示先补地址', async () => {
    const result = await fetchModelsDirect({ provider: 'custom' });

    expect(result.success).toBe(false);
    expect(result.message).toBe('请先填写 API 地址');
  });
});
