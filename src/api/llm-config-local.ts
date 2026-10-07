// 本机模式的 LLM 配置存储。
//
// 配置项（服务商 / 地址 / 模型 / 是否启用）不含密钥，放 IndexedDB；
// API Key 单独走 secure-store（Android 为 Keystore 密文），两者用 config id 关联。
import type { LLMConfig } from '../types';
import * as offline from './offline';
import { secureGet, secureRemove, secureSet } from './secure-store';

const CONFIGS_KEY = 'llm_configs';
const NEXT_ID_KEY = 'llm_config_next_id';
export const LOCAL_PROMPT_KEY = 'llm_prompt_template';

/** 落盘的配置不含密钥：密钥在安全存储里，键名由 id 推出 */
type StoredConfig = LLMConfig;

function keyName(id: number): string {
  return `llm_key_${id}`;
}

async function readAll(): Promise<StoredConfig[]> {
  try {
    const list = await offline.kvGet<StoredConfig[]>(CONFIGS_KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeAll(list: StoredConfig[]): Promise<void> {
  await offline.kvSet(CONFIGS_KEY, list);
}

export async function listLocalConfigs(): Promise<LLMConfig[]> {
  const list = await readAll();
  return [...list].sort((a, b) => b.is_active - a.is_active || b.id - a.id);
}

export async function createLocalConfig(data: {
  provider: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  thinking_effort?: LLMConfig['thinking_effort'];
}): Promise<LLMConfig> {
  const list = await readAll();
  const nextId = ((await offline.kvGet<number>(NEXT_ID_KEY)) || 0) + 1;
  await offline.kvSet(NEXT_ID_KEY, nextId);

  const created: StoredConfig = {
    id: nextId,
    provider: data.provider as LLMConfig['provider'],
    base_url: data.base_url || '',
    model: data.model || '',
    // DeepSeek 默认 high 太慢，未指定时按 low 落库（与 chatLocal 的兜底保持一致）
    thinking_effort: data.thinking_effort || (data.provider === 'deepseek' ? 'low' : undefined),
    // 第一条自动启用，并且启用新配置时把旧的关掉：本机模式一次只用一个模型
    is_active: 1,
    created_at: new Date().toISOString(),
  };
  const next = list.map((c) => ({ ...c, is_active: 0 })).concat(created);
  await writeAll(next);

  if (data.api_key) await secureSet(keyName(nextId), data.api_key);
  return created;
}

export async function activateLocalConfig(id: number): Promise<void> {
  const list = await readAll();
  await writeAll(list.map((c) => ({ ...c, is_active: c.id === id ? 1 : 0 })));
}

export async function deleteLocalConfig(id: number): Promise<void> {
  const list = await readAll();
  const next = list.filter((c) => c.id !== id);
  // 删掉的是当前启用项时，把剩下的第一条顶上，避免排程时找不到可用配置
  if (next.length > 0 && !next.some((c) => c.is_active)) next[0].is_active = 1;
  await writeAll(next);
  await secureRemove(keyName(id));
}

export async function getActiveLocalConfig(): Promise<(LLMConfig & { api_key: string }) | null> {
  const list = await readAll();
  const active = list.find((c) => c.is_active) || list[0];
  if (!active) return null;

  const apiKey = (await secureGet(keyName(active.id))) || '';
  return { ...active, api_key: apiKey };
}

/**
 * 按服务商/地址找已保存配置的密钥。
 * 用途：设置页表单里的密钥框是空的（密钥在保险箱里），
 * 点「获取模型列表」「测试连接」时用已保存的密钥兜底，不必重新粘贴。
 */
export async function findLocalKey(params: {
  provider: string;
  baseUrl?: string | null;
}): Promise<string | null> {
  const list = await readAll();
  const typedBase = (params.baseUrl || '').trim();
  const sameProvider = list.filter((c) => c.provider === params.provider);
  const sameBase = typedBase ? sameProvider.filter((c) => c.base_url === typedBase) : [];
  // 优先「同地址且已启用」的那条：同一服务商可能存了多条配置（换过密钥），
  // 取数组第一条会拿到过期密钥，表现为「明明是有效 Key 却认证失败」。
  const match =
    sameBase.find((c) => c.is_active) ||
    sameBase[0] ||
    sameProvider.find((c) => c.is_active) ||
    sameProvider[0];
  if (!match) return null;
  return (await secureGet(keyName(match.id))) || null;
}

/** 该配置是否已经存过密钥（用于 UI 判断要不要提示重填） */
export async function hasLocalKey(id: number): Promise<boolean> {
  return !!(await secureGet(keyName(id)));
}

/** 按 id 取该配置的密钥（本机模式下「测试已有配置」用） */
export async function getLocalKey(id: number): Promise<string | null> {
  return (await secureGet(keyName(id))) || null;
}

// ---------- 提示词模板：本机模式同样只存本机 ----------

export async function getLocalPromptTemplate(): Promise<string> {
  try {
    return (await offline.kvGet<string>(LOCAL_PROMPT_KEY)) || '';
  } catch {
    return '';
  }
}

export async function saveLocalPromptTemplate(template: string): Promise<void> {
  await offline.kvSet(LOCAL_PROMPT_KEY, template);
}
