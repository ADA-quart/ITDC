import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SYSTEM_PROMPT,
  buildUserPrompt,
  parseScheduleResponse,
  renderSystemPrompt,
} from './llm-prompt';
import { formatNowForModel } from './current-time';

describe('renderSystemPrompt', () => {
  it('没有自定义模板时用默认模板并替换时间占位符', () => {
    const rendered = renderSystemPrompt('', new Date('2026-09-30T00:00:00.000Z'));
    expect(rendered).not.toContain('{{current_time}}');
    expect(rendered).toContain('2026-09-30'); // 本机时区的日期
    expect(rendered.startsWith(DEFAULT_SYSTEM_PROMPT.split('{{current_time}}')[0])).toBe(true);
  });

  it('自定义模板优先，且支持多处占位符', () => {
    const rendered = renderSystemPrompt('A {{current_time}} B {{current_time}}', new Date());
    expect(rendered.startsWith('A ')).toBe(true);
    expect(rendered).not.toContain('{{current_time}}');
  });

  it('纯空白模板视为未设置', () => {
    expect(renderSystemPrompt('   ', new Date())).toContain('当前时间');
  });
});

describe('formatNowForModel', () => {
  it('带上时区偏移量，避免模型回裸时间导致排到过去', () => {
    const text = formatNowForModel(new Date('2026-09-30T05:56:00.000Z'));
    expect(text).toMatch(/[+-]\d{2}:\d{2}/);
    expect(text).toContain('UTC 偏移');
    expect(text).toContain('2026-09-30T05:56:00.000Z');
  });

  it('默认系统提示词要求带偏移量的 ISO 时间', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('带时区偏移');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('当前时间之前');
  });
});

describe('buildUserPrompt', () => {
  it('三段数据都带上', () => {
    const prompt = buildUserPrompt({
      events: [{ title: '编译原理', start_time: '2026-09-30T01:00:00.000Z' }],
      scheduledTodos: [{ title: '写作业' }],
      pendingTodos: [{ id: 1, title: '复习' }],
    });
    expect(prompt).toContain('当前日历事件');
    expect(prompt).toContain('编译原理');
    expect(prompt).toContain('已安排的待办');
    expect(prompt).toContain('待安排的待办事件');
    expect(prompt).toContain('复习');
  });
});

describe('parseScheduleResponse', () => {
  it('解析纯 JSON 数组', () => {
    const items = parseScheduleResponse('[{"todo_id":1,"start":"2026-09-30T01:00:00.000Z","end":"2026-09-30T02:00:00.000Z"}]');
    expect(items).toHaveLength(1);
    expect(items[0].todo_id).toBe(1);
  });

  it('容忍 markdown 代码块与前后解释文字', () => {
    const content = '好的，安排如下：\n```json\n[{"todo_id":2,"start":"A","end":"B"}]\n```\n以上。';
    expect(parseScheduleResponse(content)).toEqual([{ todo_id: 2, start: 'A', end: 'B' }]);
  });

  it('无法解析时抛出可展示的错误', () => {
    expect(() => parseScheduleResponse('这不是 JSON')).toThrow('格式无法解析');
    expect(() => parseScheduleResponse('{"todo_id":1}')).toThrow('格式无法解析');
  });
});
