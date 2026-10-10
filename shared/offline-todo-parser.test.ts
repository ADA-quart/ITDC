import { describe, it, expect } from 'vitest';
import { parseOfflineTodos, pickTaskLines } from './offline-todo-parser';

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

  it('刚过去的月/日保留为逾期任务，不滚到明年（10-09 输入"10月8日交"）', () => {
    const todos = parseOfflineTodos('10月8日交实验报告', NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].deadline).toBe('2026-10-08T23:59:00');
  });

  it('周X 仍然总是滚到下一个（周六说"周五交"= 下周五）', () => {
    const saturday = new Date(2026, 9, 10, 10, 0, 0);
    const todos = parseOfflineTodos('周五交周报', saturday);
    expect(todos[0]?.deadline).toBe('2026-10-16T23:59:00');
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

describe('pickTaskLines（无 LLM 时的最后兜底）', () => {
  it('OCR 糊成乱码时只留任务行，不要造出一串垃圾待办', () => {
    // 实测的坏 OCR 输出：11 行里除"测验与作业"外都不该进兜底
    const garbage = `17：25
（、电法勘探
公京
送件
无忆
评分标准
测验与作业
饰，产，中阳方达
第，共四后作山
批改方式学生互评
第二节课后1F
北改方式学生互评`;
    const lines = pickTaskLines(garbage, NOW);
    expect(lines).toEqual(['测验与作业']);
  });

  it('识别正常时丢掉属性行（总分/按钮/批改方式/截止说明），保留任务行', () => {
    const text = `电法勘探
评分标准
第一节课后作业
批改方式学生互评
已截止2026-09-2512:00
总分20
进入作业
即将截止2026-10-1513:00`;
    const lines = pickTaskLines(text, NOW);
    expect(lines).toContain('第一节课后作业');
    expect(lines).not.toContain('总分20');
    expect(lines).not.toContain('进入作业');
    expect(lines).not.toContain('批改方式学生互评');
    expect(lines).not.toContain('已截止2026-09-2512:00');
  });

  it('带日期的自由文本行也算任务（哪怕没有关键词）', () => {
    expect(pickTaskLines('10月20日 交表格\n纯风景照片一张', NOW)).toEqual(['10月20日 交表格']);
  });
});

describe('聊天记录截图（QQ/微信群聊）', () => {
  // 真实 OCR 输出：一条消息被拆成多行、人名/时间戳/群名/工具栏混在其中
  const chat = `3：510）
60
24级勘查1班信息通知群（36）
星期四19:29
LV81群主班长24杨康13550680501
@全体成员请未交工程勘察实验
报告的同学尽快提交
昨天10:51
LV2管理员
阳刚—15808165156
请同学们，明天
（10月11日）下
午15:00到北翼楼5408开班会
请相互通知，准时参会
昨天11:02
LV1
25杨耀龙19118690153
刚哥到底十一号还是明天下午，明
天下午是十号
LV2管理员
阳刚—15808165156
10号
LV2管理员
阳刚—15808165156
写错了
文件相册精华消息接龙统计8
发送`;

  it('按消息块聚合：不拆散换行，地点时间不丢，提问/寒暄不建待办', () => {
    const todos = parseOfflineTodos(chat, NOW);
    expect(todos.map((t) => t.title)).toEqual([
      '请未交工程勘察实验报告的同学尽快提交',
      '请同学们，明天到北翼楼5408开班会请相互通知，准时参会',
    ]);
    expect(todos[1].deadline).toBe('2026-10-11T15:00:00');
    // "尽快提交" → 紧急；实验报告 → 重要
    expect(todos[0].priority).toBe('urgent-important');
  });

  it('pickTaskLines 同样按消息块输出，不产出碎片', () => {
    const lines = pickTaskLines(chat, NOW);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('北翼楼5408');
    expect(lines.join('|')).not.toContain('到底');
    expect(lines.join('|')).not.toContain('写错了');
  });

  it('消息时间戳给无年份日期做锚点：09/26 的"10月8日"是同年已截止，不滚到明年', () => {
    const text = [
      '09/2621:55',
      '老师',
      '工程-张老师',
      '@全体成员',
      '实验报告提交时间为10月8日，实',
      '验课期间为未完成报告的同学，假',
      '期抽时间完成。',
      '报告只提交电子版，word格式。',
      '@202405060422王佳诚',
      '09/2622:09',
      '202405060313陆冠锦',
      '收到',
      '09/2809:31',
      '老师',
      '工程-张老师',
      '@全体成员',
      '大家看实验视频时，记得看一下补',
      '充视频，不要把补充视频遗漏了。',
      '文件相册作业老师消息',
      '发送',
    ].join('\n');
    const todos = parseOfflineTodos(text, NOW);
    // 实验报告那条：锚定后是 2026-10-08（已过）→ 跳过，而不是 2027-10-08
    expect(todos.map((t) => t.title)).toEqual(['大家看实验视频时，记得看一下补充视频，不要把补充视频遗漏了。']);
    expect(JSON.stringify(todos)).not.toContain('2027');
  });
});

describe('学习通 / 教务作业通知', () => {
  it('同时有开始时间和结束时间时取结束时间（开始时间已过不该把整条判成已截止）', () => {
    const text = [
      '[课程通知]',
      '作业：《马克思主义基本原理》判断题',
      '学习通知 06-29 16:54',
      '课程名称：马克思主义基本原理',
      '作业名称：判断题',
      '开始时间：2026-06-29 16:54',
      '结束时间：2026-12-29 17:54',
    ].join('\n');
    const todos = parseOfflineTodos(text, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('判断题');
    expect(todos[0].deadline).toBe('2026-12-29T17:54:00');
  });

  it('"还有24个小时就要结束"这类相对提醒：没有绝对时间就不编截止时间', () => {
    const text = [
      '[课程通知]',
      '作业结束提醒',
      '学习通知 06-30 00:50',
      '课程名称：弹性波动力学2026',
      '作业名称：第八章作业',
      '你的作业还有24个小时就要结束，请尽快作答',
    ].join('\n');
    const todos = parseOfflineTodos(text, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('第八章作业');
    expect(todos[0].deadline).toBeNull();
  });
});

describe('QQ 群公告', () => {
  it('发送者名片、公告控件与发布时间都不当标题；截止时间取到且逾期保留', () => {
    const text = [
      '群公告',
      'JSAI卫（不回答技术问题）',
      '置顶',
      '发给新成员',
      '2026年10月2日13:06',
      '各位参赛选手：复赛赛题结果文档提交截止时间为',
      '10月5日20:00复赛作品文档提交截止时间为1',
      '月7日2359。请大家按要求提交复赛结果及相关作',
      '品文档，各赛题详细提交要求，请查阅对应赛题竞赛',
      '规则（十三：提交要求）：',
      '【重要】参赛团队需将排行榜对应最高得分的代',
      '得的最高得分为准。不提交代码及其他作品被判定为',
      '你已确认',
    ].join('\n');
    const todos = parseOfflineTodos(text, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('复赛赛题结果文档提交截止时间');
    expect(todos[0].deadline).toBe('2026-10-05T20:00:00');
  });
});
