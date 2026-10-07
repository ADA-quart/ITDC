import { describe, it, expect, vi, afterEach } from 'vitest';
import { chatLocal, type LocalModelConfig } from './llm-local';

/** 调一次 chatLocal，返回实际发出去的请求体 */
async function callChat(config: Partial<LocalModelConfig>) {
  let captured: any = null;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    captured = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '[]' } }] }),
    } as any;
  }));
  await chatLocal(
    { provider: 'deepseek', api_key: 'sk-test', model: 'deepseek-flash', ...config },
    [{ role: 'user', content: 'hi' }]
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

describe('chatLocal 思考强度参数', () => {
  it('low 使用 reasoning_effort=low', async () => {
    const body = await callChat({ thinking_effort: 'low' });
    expect(body.reasoning_effort).toBe('low');
    expect(body.thinking).toBeUndefined();
  });

  it('none 使用 thinking.type=disabled 且不带 reasoning_effort', async () => {
    const body = await callChat({ thinking_effort: 'none' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('未配置时 DeepSeek 默认 low，避免服务端默认 high 太慢', async () => {
    const body = await callChat({});
    expect(body.reasoning_effort).toBe('low');
  });

  it('非 DeepSeek 服务商不发送思考参数', async () => {
    const body = await callChat({ provider: 'openai', model: 'gpt-4o-mini', thinking_effort: 'low' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });
});
