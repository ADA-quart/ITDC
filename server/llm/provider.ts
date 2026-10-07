export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
}

export interface ModelListResult {
  success: boolean;
  models: string[];
  /** 失败或列表为空时的说明，供界面直接展示 */
  message?: string;
}

export interface LLMProvider {
  chat(messages: LLMMessage[]): Promise<LLMResponse>;
  testConnection(): Promise<{ success: boolean; message: string; model?: string }>;
  /** 列出该服务商当前可用的模型，供设置页下拉选择 */
  listModels(): Promise<ModelListResult>;
}

export interface LLMConfig {
  provider: string;
  api_key: string | null;
  base_url: string | null;
  model: string | null;
  /** DeepSeek V4 思考强度：none 关闭、low/high/max 逐级增强 */
  thinking_effort?: string | null;
  is_active: number;
}
