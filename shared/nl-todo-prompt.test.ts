import { describe, it, expect } from 'vitest';
import { parseTodoFromModel, priorityFrom } from './nl-todo-prompt';

describe('priorityFrom', () => {
  it('按紧急/重要度映射四象限', () => {
    expect(priorityFrom(4, 4)).toBe('urgent-important');
    expect(priorityFrom(1, 4)).toBe('important');
    expect(priorityFrom(4, 1)).toBe('urgent');
    expect(priorityFrom(2, 2)).toBe('normal');
  });
});

describe('parseTodoFromModel', () => {
  it('解析纯 JSON 并算出四象限', () => {
    const parsed = parseTodoFromModel(
      '{"title":"交报告","urgency":4,"importance":3,"deadline":null,"estimated_minutes":90}'
    );
    expect(parsed.title).toBe('交报告');
    expect(parsed.priority).toBe('urgent-important');
    expect(parsed.estimated_minutes).toBe(90);
    expect(parsed.deadline).toBeNull();
  });

  it('容忍 markdown 代码块与前后解释', () => {
    const parsed = parseTodoFromModel(
      '好的：\n```json\n{"title":"买牛奶","urgency":2,"importance":2,"estimated_minutes":15}\n```'
    );
    expect(parsed.title).toBe('买牛奶');
    expect(parsed.priority).toBe('normal');
  });

  it('越界数值被夹到合法区间', () => {
    const parsed = parseTodoFromModel(
      '{"title":"x","urgency":9,"importance":-3,"estimated_minutes":10000}'
    );
    expect(parsed.urgency).toBe(4);
    expect(parsed.importance).toBe(1);
    expect(parsed.estimated_minutes).toBe(720);
  });

  it('过去或过于久远的截止时间被丢弃', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const far = new Date(Date.now() + 800 * 24 * 60 * 60 * 1000).toISOString();
    expect(parseTodoFromModel(`{"title":"a","deadline":"${past}"}`).deadline).toBeNull();
    expect(parseTodoFromModel(`{"title":"b","deadline":"${far}"}`).deadline).toBeNull();
  });

  it('保留合理的未来截止时间', () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    expect(parseTodoFromModel(`{"title":"c","deadline":"${future}"}`).deadline).toBe(future);
  });

  it('标题缺失或 JSON 非法时报错', () => {
    expect(() => parseTodoFromModel('{"title":""}')).toThrow('未能识别任务标题');
    expect(() => parseTodoFromModel('不是 JSON')).toThrow('无效的 JSON');
  });
});
