// LLM 配置的统一入口：服务器模式走服务端，本机模式走本机存储 + 直连服务商。
//
// 设置页与排程只认这一层，不必到处判断 isSyncEnabled() ——
// 否则每加一个 LLM 相关功能都要在 UI 里重复一遍分支。
import type { LLMConfig } from '../types';
import { isSyncEnabled, llmConfigApi, promptTemplateApi } from './client';
import { DEFAULT_SYSTEM_PROMPT } from '../../shared/llm-prompt';
import { fetchModelsDirect, type ModelListResult } from './llm-models';
import { testLocalConnection } from './llm-local';
import {
  activateLocalConfig,
  createLocalConfig,
  deleteLocalConfig,
  findLocalKey,
  getLocalKey,
  getLocalPromptTemplate,
  listLocalConfigs,
  saveLocalPromptTemplate,
} from './llm-config-local';

export interface LLMTestResult {
  success: boolean;
  message: string;
  model?: string;
}

function isLocalMode(): boolean {
  return !isSyncEnabled();
}

export const llmConfigService = {
  isLocalMode,

  async getAll(): Promise<LLMConfig[]> {
    if (isLocalMode()) return listLocalConfigs();
    return llmConfigApi.getAll();
  },

  async create(data: {
    provider: string;
    api_key?: string;
    base_url?: string;
    model?: string;
    thinking_effort?: LLMConfig['thinking_effort'];
  }): Promise<void> {
    if (isLocalMode()) {
      await createLocalConfig(data);
      return;
    }
    await llmConfigApi.create(data);
  },

  async activate(id: number): Promise<void> {
    if (isLocalMode()) {
      await activateLocalConfig(id);
      return;
    }
    await llmConfigApi.activate(id);
  },

  async remove(id: number): Promise<void> {
    if (isLocalMode()) {
      await deleteLocalConfig(id);
      return;
    }
    await llmConfigApi.delete(id);
  },

  /**
   * 表单里的密钥框留空时的兜底：本机模式下密钥躺在保险箱里，
   * 要求用户为「获取列表 / 测试连接」重新粘贴一次是不合理的。
   */
  async resolveApiKey(params: {
    provider: string;
    apiKey?: string;
    baseUrl?: string | null;
  }): Promise<string> {
    const typed = (params.apiKey || '').trim();
    if (typed) return typed;
    if (!isLocalMode()) return '';
    return (await findLocalKey({ provider: params.provider, baseUrl: params.baseUrl })) || '';
  },

  async test(data: {
    provider?: string;
    api_key?: string;
    base_url?: string;
    model?: string;
  }): Promise<LLMTestResult> {
    if (!isLocalMode()) {
      return llmConfigApi.test(data);
    }
    const apiKey = await this.resolveApiKey({
      provider: data.provider || 'openai',
      apiKey: data.api_key,
      baseUrl: data.base_url,
    });
    return testLocalConnection({
      provider: data.provider || 'openai',
      api_key: apiKey,
      base_url: data.base_url,
      model: data.model,
    });
  },

  /** 测试已保存的配置（表格里的「测试」按钮） */
  async testExisting(id: number): Promise<LLMTestResult> {
    if (!isLocalMode()) {
      return llmConfigApi.test({ id });
    }
    const target = (await listLocalConfigs()).find((c) => c.id === id);
    if (!target) return { success: false, message: '配置不存在' };
    const apiKey = await getLocalKey(id);
    return testLocalConnection({
      provider: target.provider,
      api_key: apiKey || '',
      base_url: target.base_url,
      model: target.model,
    });
  },

  /**
   * 拉取模型列表。
   * 服务器可达时优先走服务器（密钥在服务器上），否则由 App 直连服务商。
   */
  async listModels(data: {
    provider: string;
    api_key?: string;
    base_url?: string;
  }): Promise<ModelListResult> {
    const apiKey = await this.resolveApiKey({
      provider: data.provider,
      apiKey: data.api_key,
      baseUrl: data.base_url,
    });

    if (!isLocalMode()) {
      try {
        const fromServer = await llmConfigApi.listModels({ ...data, api_key: apiKey || data.api_key });
        // 服务器给出结构化答复（成功或明确失败原因）就采信，不再重复请求
        if (fromServer && Array.isArray(fromServer.models)) {
          return { ...fromServer, source: 'server' };
        }
      } catch {
        // 服务器 404 / 网络错误 / 返回的不是 JSON —— 落到直连
      }
    }

    return fetchModelsDirect({ provider: data.provider, apiKey, baseUrl: data.base_url });
  },

  async getPromptTemplate(): Promise<{ template: string; defaultTemplate: string }> {
    if (isLocalMode()) {
      return { template: await getLocalPromptTemplate(), defaultTemplate: DEFAULT_SYSTEM_PROMPT };
    }
    return promptTemplateApi.get();
  },

  async savePromptTemplate(template: string): Promise<void> {
    if (isLocalMode()) {
      await saveLocalPromptTemplate(template);
      return;
    }
    await promptTemplateApi.update(template);
  },

  async resetPromptTemplate(): Promise<{ defaultTemplate: string }> {
    if (isLocalMode()) {
      await saveLocalPromptTemplate('');
      return { defaultTemplate: DEFAULT_SYSTEM_PROMPT };
    }
    return promptTemplateApi.reset();
  },
};
