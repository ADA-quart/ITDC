import { describe, it, expect } from 'vitest';
import { parseOfflineTodos } from './offline-todo-parser';

// 固定时间：2026-10-09（周五）10:00 —— 让"周五/明天/过期"等断言稳定
const NOW = new Date(2026, 9, 9, 10, 0, 0);

describe('offline-todo-parser', () => {
  it('从作业列表 OCR 文本里提取未截止的作业，跳过已截止的', () => {
    const text = `
17:25 O0
く电法勘採
公百
评分标准
测验与作业
|第一章电阻率法
第一节课后作业
批改方式学生互评
已截止 2026-09-25 12:00
总分20
第二节课后作业
批改方式学生互评
味件
已截止2026-09-30 13:00
总分20
第三节课后作业
批改方式学生互评
即将截止 2026-10-15 13:00
总分20
558
KBs*山“S令74
有恢
进入作业
    `;
    const todos = parseOfflineTodos(text, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('第三节课后作业');
    expect(todos[0].deadline).toBe('2026-10-15T13:00:00');
    expect(todos[0].priority).toBe('urgent-important');
  });

  it('解析"周五下午前交周报"（当天 → 今天 18:00，与 LLM 提示词口径一致）', () => {
    const todos = parseOfflineTodos('周五下午前交周报', NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].deadline).toBe('2026-10-09T18:00:00');
    expect(todos[0].title).toBe('交周报');
  });

  it('"明天 8 点交作业" → 明天 08:00', () => {
    const todos = parseOfflineTodos('明天 8 点交作业', NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].deadline).toBe('2026-10-10T08:00:00');
    expect(todos[0].title).toContain('作业');
  });

  it('无年份的过去日期滚动到未来（3月15日 → 明年）', () => {
    const todos = parseOfflineTodos('3月15日交论文', NOW);
    expect(todos[0]?.deadline).toBe('2027-03-15T23:59:00');
  });

  it('无年份的未来日期按当年处理（12月31日 → 今年）', () => {
    const todos = parseOfflineTodos('12月31日前提交年假申请', NOW);
    expect(todos[0]?.deadline).toBe('2026-12-31T23:59:00');
  });

  it('单行无日期无关键词也保留（用户输入的都算数）', () => {
    const todos = parseOfflineTodos('买牛奶', NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('买牛奶');
    expect(todos[0].deadline).toBeNull();
  });

  it('多任务按标题分块拆分', () => {
    const text = '写实验报告\n截止 2026-10-20 18:00\n买教材\n截止 2026-10-12';
    const todos = parseOfflineTodos(text, NOW);
    expect(todos.map((t) => t.title)).toEqual(['写实验报告', '买教材']);
    expect(todos[0].deadline).toBe('2026-10-20T18:00:00');
    expect(todos[1].deadline).toBe('2026-10-12T23:59:00');
  });

  it('空文本 / 纯噪音返回空数组', () => {
    expect(parseOfflineTodos('', NOW)).toEqual([]);
    expect(parseOfflineTodos('   \n  \n', NOW)).toEqual([]);
    expect(parseOfflineTodos('17:25 O0\n558\nKBs*山“S令74\n有恢', NOW)).toEqual([]);
  });

  it('带年份且已截止的条目被跳过', () => {
    const todos = parseOfflineTodos('第一节课后作业\n已截止 2026-09-25 12:00', NOW);
    expect(todos).toHaveLength(0);
  });

  it('临近截止 + 考试类 → 紧急重要', () => {
    const soon = parseOfflineTodos('考试报名\n截止 2026-10-10 12:00', NOW)[0];
    expect(soon.priority).toBe('urgent-important');
    expect(soon.urgency).toBe(4);
    expect(soon.importance).toBe(4);
  });

  it('下午带钟点按 24 小时制换算', () => {
    const todos = parseOfflineTodos('下周三下午 3 点半答辩', NOW);
    // 2026-10-09 是周五 → 下周三 = 10-14
    expect(todos[0]?.deadline).toBe('2026-10-14T15:30:00');
  });
});
