import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = vi.hoisted(() => ({
  memory: new Map<string, any>(),
  secrets: new Map<string, string>(),
}));

// 本机模式：isSyncEnabled 恒为 false，走本机存储与直连
vi.mock('./client', () => ({
  isSyncEnabled: () => false,
  llmConfigApi: {
    listModels: vi.fn(),
    test: vi.fn(),
  },
  promptTemplateApi: {
    get: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('./offline', () => ({
  kvGet: async (key: string) => store.memory.get(key),
  kvSet: async (key: string, value: any) => { store.memory.set(key, value); },
}));

vi.mock('./secure-store', () => ({
  secureSet: async (name: string, value: string) => { store.secrets.set(name, value); },
  secureGet: async (name: string) => store.secrets.get(name) ?? null,
  secureRemove: async (name: string) => { store.secrets.delete(name); },
}));

import { llmConfigService } from './llm-config-service';
import { createLocalConfig } from './llm-config-local';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

beforeEach(() => {
  store.memory.clear();
  store.secrets.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('本机模式的 LLM 配置服务', () => {
  it('表单没填密钥时，用保险箱里已保存的密钥直连服务商', async () => {
    await createLocalConfig({ provider: 'deepseek', api_key: 'sk-stored', model: 'deepseek-chat' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'deepseek-chat' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await llmConfigService.listModels({ provider: 'deepseek' });

    expect(result.models).toEqual(['deepseek-chat']);
    expect(result.source).toBe('direct');
    const headers = (fetchMock.mock.calls[0][1] as any).headers;
    expect(headers.Authorization).toBe('Bearer sk-stored');
  });

  it('表单填了新密钥时以表单为准', async () => {
    await createLocalConfig({ provider: 'deepseek', api_key: 'sk-stored' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await llmConfigService.listModels({ provider: 'deepseek', api_key: 'sk-typed' });

    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer sk-typed');
  });

  it('本机模式下配置读写落在本机存储', async () => {
    await llmConfigService.create({ provider: 'deepseek', api_key: 'sk-x', model: 'deepseek-chat' });
    const list = await llmConfigService.getAll();

    expect(list).toHaveLength(1);
    expect(list[0].provider).toBe('deepseek');
    // 服务端的 llmConfigApi 一次都不该被碰到
    const { llmConfigApi } = await import('./client');
    expect(llmConfigApi.listModels).not.toHaveBeenCalled();
  });

  it('提示词模板在本机模式读写本机副本', async () => {
    await llmConfigService.savePromptTemplate('我的模板');
    const got = await llmConfigService.getPromptTemplate();
    expect(got.template).toBe('我的模板');
    expect(got.defaultTemplate.length).toBeGreaterThan(0);
  });
});
