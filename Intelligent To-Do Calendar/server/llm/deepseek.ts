import { OpenAICompatibleProvider, createDeepSeekProvider } from './openai-compatible.js';

/**
 * @deprecated 请直接使用 OpenAICompatibleProvider 或 createDeepSeekProvider
 * 保留此文件以保持向后兼容
 */
export const DeepSeekProvider = OpenAICompatibleProvider;

export function __createDeepSeek(apiKey: string, baseUrl?: string, model?: string) {
  return createDeepSeekProvider(apiKey, baseUrl, model);
}
