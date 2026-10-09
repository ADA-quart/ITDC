// 本机模式的自然语言录入：App 直接调大模型把一句话解析成结构化待办。
//
// 提示词与字段校验来自 shared/nl-todo-prompt.ts，与服务端同源，
// 保证「周五下午」这类相对时间在两种模式下解析一致。
import {
  NL_TODO_SYSTEM_PROMPT,
  NL_TODO_LIST_SYSTEM_PROMPT,
  parseTodoFromModel,
  parseTodosFromModel,
  type ParsedTodo,
} from '../../shared/nl-todo-prompt';
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

/**
 * 批量版：一段文字（多行清单 / 截图识别结果）里的所有任务。
 * 例：一张作业列表截图里有三道课后作业，逐条提取而不是只挑一条。
 */
export async function parseNaturalLanguageTodosLocally(text: string): Promise<ParsedTodo[]> {
  const config = await getActiveLocalConfig();
  if (!config) {
    throw new Error('本机模式还没有配置大模型：请到「设置 → LLM 服务配置」添加一个');
  }

  const content = await chatLocal(config, [
    { role: 'system', content: fillCurrentTime(NL_TODO_LIST_SYSTEM_PROMPT, new Date()) },
    { role: 'user', content: '请提取这段文字里的所有待办任务：\n' + text },
  ]);

  return parseTodosFromModel(content);
}

/**
 * 图片版：把截图/照片直接发给多模态模型，返回提取出的待办（无需本地 OCR）。
 * 模型不支持图片时由调用方按错误类型识别并记录结论。
 */
export async function parseNaturalLanguageTodosFromImageLocally(dataUrl: string): Promise<ParsedTodo[]> {
  const config = await getActiveLocalConfig();
  if (!config) {
    throw new Error('本机模式还没有配置大模型：请到「设置 → LLM 服务配置」添加一个');
  }

  const content = await chatLocal(config, [
    { role: 'system', content: fillCurrentTime(NL_TODO_LIST_SYSTEM_PROMPT, new Date()) },
    { role: 'user', content: '请提取这张图片里的所有待办任务。', images: [dataUrl] },
  ]);

  return parseTodosFromModel(content);
}
