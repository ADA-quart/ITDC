import db from '../db/index.js';
import { getActiveProvider } from './llm-scheduler.js';
import { debug } from '../utils/debug.js';
import {
  NL_TODO_SYSTEM_PROMPT,
  NL_TODO_LIST_SYSTEM_PROMPT,
  parseTodoFromModel,
  parseTodosFromModel,
  type ParsedTodo,
} from '../../shared/nl-todo-prompt.js';
import { fillCurrentTime } from '../../shared/current-time.js';

export type { ParsedTodo };

export async function parseNaturalLanguageTodo(text: string): Promise<ParsedTodo> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('LLM 尚未配置：请在设置中启用一个 LLM 服务商后再使用自然语言录入。');
  }

  debug.info('NL todo parse', { text: text.slice(0, 80), length: text.length });

  const response = await provider.chat([
    { role: 'system', content: fillCurrentTime(NL_TODO_SYSTEM_PROMPT, new Date()) },
    { role: 'user', content: '请解析这条待办描述：' + text },
  ]);

  return parseTodoFromModel(response.content);
}

/** 批量版：一段文字/截图识别结果里的所有任务 */
export async function parseNaturalLanguageTodos(text: string): Promise<ParsedTodo[]> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('LLM 尚未配置：请在设置中启用一个 LLM 服务商后再使用自然语言录入。');
  }

  debug.info('NL todo parse (batch)', { text: text.slice(0, 80), length: text.length });

  const response = await provider.chat([
    { role: 'system', content: fillCurrentTime(NL_TODO_LIST_SYSTEM_PROMPT, new Date()) },
    { role: 'user', content: '请提取这段文字里的所有待办任务：\n' + text },
  ]);

  return parseTodosFromModel(response.content);
}

/** 图片版：多模态模型直接读图提取待办，无需本地 OCR */
export async function parseNaturalLanguageTodosFromImage(dataUrl: string): Promise<ParsedTodo[]> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('LLM 尚未配置：请在设置中启用一个 LLM 服务商后再使用自然语言录入。');
  }

  debug.info('NL todo parse (image)', { imageKB: Math.round(dataUrl.length / 1024) });

  const response = await provider.chat([
    { role: 'system', content: fillCurrentTime(NL_TODO_LIST_SYSTEM_PROMPT, new Date()) },
    { role: 'user', content: '请提取这张图片里的所有待办任务。', images: [dataUrl] },
  ]);

  return parseTodosFromModel(response.content);
}
