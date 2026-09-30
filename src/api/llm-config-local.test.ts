import { describe, it, expect, vi, beforeEach } from 'vitest';

// kv 与密钥存储都用内存实现顶替，测试只关心本机配置的语义
const store = vi.hoisted(() => ({
  memory: new Map<string, any>(),
  secrets: new Map<string, string>(),
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

import {
  activateLocalConfig,
  createLocalConfig,
  deleteLocalConfig,
  findLocalKey,
  getActiveLocalConfig,
  getLocalPromptTemplate,
  listLocalConfigs,
  saveLocalPromptTemplate,
} from './llm-config-local';

beforeEach(() => {
  store.memory.clear();
  store.secrets.clear();
});

describe('本机 LLM 配置', () => {
  it('第一条配置自动启用', async () => {
    const created = await createLocalConfig({ provider: 'deepseek', api_key: 'sk-a', model: 'deepseek-chat' });
    expect(created.is_active).toBe(1);

    const list = await listLocalConfigs();
    expect(list).toHaveLength(1);
    expect(list[0].provider).toBe('deepseek');
  });

  it('新增配置会把旧配置取消启用，一次只用一个模型', async () => {
    const first = await createLocalConfig({ provider: 'deepseek', api_key: 'sk-a' });
    const second = await createLocalConfig({ provider: 'openai', api_key: 'sk-b' });

    const list = await listLocalConfigs();
    expect(list.find((c) => c.id === first.id)?.is_active).toBe(0);
    expect(list.find((c) => c.id === second.id)?.is_active).toBe(1);
  });

  it('密钥不进配置记录，只存在安全存储里', async () => {
    const created = await createLocalConfig({ provider: 'deepseek', api_key: 'sk-secret' });
    const raw = store.memory.get('llm_configs');
    expect(JSON.stringify(raw)).not.toContain('sk-secret');

    const active = await getActiveLocalConfig();
    expect(active?.api_key).toBe('sk-secret');
    expect(await findLocalKey({ provider: 'deepseek' })).toBe('sk-secret');
    expect(store.secrets.get(`llm_key_${created.id}`)).toBe('sk-secret');
  });

  it('删除当前启用的配置后，剩下的第一条自动接管', async () => {
    const first = await createLocalConfig({ provider: 'deepseek', api_key: 'sk-a' });
    const second = await createLocalConfig({ provider: 'openai', api_key: 'sk-b' });

    await deleteLocalConfig(second.id);

    const list = await listLocalConfigs();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(first.id);
    expect(list[0].is_active).toBe(1);
    // 密钥跟着配置一起删掉，避免残留
    expect(store.secrets.has(`llm_key_${second.id}`)).toBe(false);
  });

  it('可以显式切换启用项', async () => {
    const first = await createLocalConfig({ provider: 'deepseek', api_key: 'sk-a' });
    await createLocalConfig({ provider: 'openai', api_key: 'sk-b' });

    await activateLocalConfig(first.id);

    const list = await listLocalConfigs();
    expect(list.find((c) => c.id === first.id)?.is_active).toBe(1);
  });

  it('提示词模板存本机', async () => {
    expect(await getLocalPromptTemplate()).toBe('');
    await saveLocalPromptTemplate('自定义模板 {{current_time}}');
    expect(await getLocalPromptTemplate()).toBe('自定义模板 {{current_time}}');
  });
});
