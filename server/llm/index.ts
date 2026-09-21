import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OllamaProvider } from './ollama.js';
import type { LLMConfig, LLMProvider } from './provider.js';

export * from './provider.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';
export { OllamaProvider } from './ollama.js';

/**
 * Unified provider factory — the single entry point for creating an LLM provider.
 * All providers are created through this function; per-provider files only define
 * the implementation, no longer expose their own factories.
 */
export function createProvider(
  config: Pick<LLMConfig, 'provider' | 'base_url' | 'model'> & { api_key: string | null },
): LLMProvider | null {
  const { provider, base_url, model, api_key } = config;

  switch (provider) {
    case 'openai':
      return new OpenAICompatibleProvider({
        apiKey: api_key || null,
        baseUrl: base_url || 'https://api.openai.com/v1',
        model: model || 'gpt-4o-mini',
        providerName: 'OpenAI',
      });
    case 'deepseek':
      return new OpenAICompatibleProvider({
        apiKey: api_key || null,
        baseUrl: base_url || 'https://api.deepseek.com/v1',
        model: model || 'deepseek-chat',
        providerName: 'DeepSeek',
      });
    case 'ollama':
      return new OllamaProvider(base_url ?? undefined, model ?? undefined);
    case 'lmstudio':
      return new OpenAICompatibleProvider({
        apiKey: null,
        baseUrl: base_url || 'http://localhost:1234/v1',
        model: model || '',
        providerName: 'LM Studio',
      });
    case 'custom':
      return new OpenAICompatibleProvider({
        apiKey: api_key || null,
        baseUrl: base_url || 'http://localhost:8080/v1',
        model: model || '',
        providerName: 'Custom',
      });
    default:
      return null;
  }
}
