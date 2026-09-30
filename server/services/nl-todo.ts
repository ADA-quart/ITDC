import db from '../db/index.js';
import { getActiveProvider } from './llm-scheduler.js';
import { debug } from '../utils/debug.js';
import {
  NL_TODO_SYSTEM_PROMPT,
  parseTodoFromModel,
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
