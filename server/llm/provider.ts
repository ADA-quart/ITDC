export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 附带的图片（data URL）：OpenAI 兼容端点转 content 数组，Ollama 转 images 字段 */
  images?: string[];
}

/** OpenAI 兼容端点：带图消息的 content 从字符串换成 [text, image_url...] 数组 */
export function toOpenAIPayloadMessages(messages: LLMMessage[]): unknown[] {
  return messages.map((m) => {
    if (!m.images?.length) {
      const { images: _skip, ...rest } = m;
      return rest;
    }
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    };
  });
}

/** Ollama：图片走 messages[].images（纯 base64，不带 data URL 前缀） */
export function toOllamaPayloadMessages(messages: LLMMessage[]): unknown[] {
  return messages.map((m) => {
    if (!m.images?.length) {
      const { images: _skip, ...rest } = m;
      return rest;
    }
    return {
      role: m.role,
      content: m.content,
      images: m.images.map((img) => (img.includes(',') ? img.slice(img.indexOf(',') + 1) : img)),
    };
  });
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
