export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
}

export interface LLMProvider {
  chat(messages: LLMMessage[]): Promise<LLMResponse>;
  testConnection(): Promise<{ success: boolean; message: string; model?: string }>;
}

export interface LLMConfig {
  provider: string;
  api_key: string | null;
  base_url: string | null;
  model: string | null;
  is_active: number;
}
