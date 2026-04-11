import { OpenAICompatibleProvider, createOpenAIProvider } from './openai-compatible.js';

/**
 * @deprecated 请直接使用 OpenAICompatibleProvider 或 createOpenAIProvider
 * 保留此文件以保持向后兼容
 */
export const OpenAIProvider = OpenAICompatibleProvider;

export function __createOpenAI(apiKey: string, baseUrl?: string, model?: string) {
  return createOpenAIProvider(apiKey, baseUrl, model);
}
