// 本机模式的自然语言录入：App 直接调大模型把一句话解析成结构化待办。
//
// 提示词与字段校验来自 shared/nl-todo-prompt.ts，与服务端同源，
// 保证「周五下午」这类相对时间在两种模式下解析一致。
import { NL_TODO_SYSTEM_PROMPT, parseTodoFromModel, type ParsedTodo } from '../../shared/nl-todo-prompt';
import { fillCurrentTime } from '../../shared/current-time';
import { chatLocal } from './llm-local';
import { getActiveLocalConfig } from './llm-config-local';

export async function parseNaturalLanguageTodoLocally(text: string): Promise<ParsedTodo> {
  const config = await getActiveLocalConfig();
  if (!config) {
    throw new Error('本机模式还没有配置大模型：请到「设置 → LLM 服务配置」添加一个');
  }

  const content = await chatLocal(config, [
    { role: 'system', content: fillCurrentTime(NL_TODO_SYSTEM_PROMPT, new Date()) },
    { role: 'user', content: '请解析这条待办描述：' + text },
  ]);

  return parseTodoFromModel(content);
}
