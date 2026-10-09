/**
 * 离线待办解析器：不依赖任何大模型，用规则从文字里提取待办。
 *
 * 服务对象：作业列表 / 通知截图的 OCR 结果、手输短句（如"周五下午前交周报"）。
 * 覆盖不了自由语言的语义（那是大模型的活），但结构化内容够用；
 * 大模型不可用（没网 / 没配置）时作为降级链里「算法」这一环。
 *
 * 规则要点：
 * - 日期时间支持：2026-10-15 13:00 / 2026年10月15日 / 10月15日 / 今天 明天 后天 /
 *   周五 / 下周三，时间支持 13:00、13点30、下午3点半、晚上8点 等常见写法；
 * - 日期落在过去 → 跳过该条（与 LLM 提示词行为一致，「已截止」的作业不会被建出来）；
 *   但「无年份」的日期若已过去 → 滚动到未来（周五 → 下周五、10月15日 → 明年）——
 *   手输的未来意图不该因为解析粗糙被丢掉；
 * - 只给日期不给时刻 → 当天 23:59；「下午」不给钟点 → 18:00（与 LLM 提示词对齐）；
 * - 多任务：按标题行分块；连续标题行取更具体的一条；无日期且无任务关键词的块
 *   按噪音丢弃（单行输入例外——总是保留）。
 */
import type { ParsedTodo } from './nl-todo-prompt';
import { priorityFrom } from './nl-todo-prompt';

const WEEKDAY_INDEX: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

/** 属性行（不当作标题）：批改方式、总分、按钮文案等 */
const ATTRIBUTE_RE = /总分|批改|互评|教师评分|得分|分数|评分|进入|详情|查看|来源|按钮|返回|菜单/;

/** 时间属性行（有价值但不是标题）：截止时间说明等 */
const TIME_ATTR_RE = /截止|截止时间|过期|开始|结束|开放/;

/** 任务关键词：无日期时判断"这条值不值得留" */
const TASK_KEYWORD_RE = /作业|报告|任务|通知|考试|测验|测试|复习|预习|练习|论文|实验|项目|报名|缴费|申请|提交|答辩|演示|打印|填写|准备|完成|交|写|做/;

/** 噪音行：纯数字/符号、状态栏碎片、独立时间戳（HH:MM）等 */
function isNoiseLine(line: string): boolean {
  const s = line.trim();
  if (s.length === 0) return true;
  if (/^[\d\s.,:%+\-*/\\|()（）【】\[\]<>《》'"“”‘’·•…~～-]+$/.test(s)) return true;
  if (/^\d{1,2}[:：]\d{2}$/.test(s)) return true;
  if (/KBs?|MB\/s|KB\/s/i.test(s)) return true;
  // 以时间开头、剩余只有一两个字符的碎片（如 "17:25 O0"、"9:33 门"）
  const head = /^\d{1,2}[:：]\d{2}\s*(.*)$/.exec(s);
  if (head && head[1].trim().length <= 2) return true;
  if (s.length <= 2) return true;
  return false;
}

/** 一个块里解析出的截止时间 */
interface DeadlineHit {
  date: Date;
  /** 命中的日期 / 时间原文片段（用于从标题里剥掉时间信息） */
  dateSpan: string;
  timeSpan: string;
  /** 日期带年份（OCR 常见）；无年份的按"未来意图"滚动处理 */
  hasYear: boolean;
  /** 来源是"周X"（滚动时 +7 天而不是 +1 年） */
  fromWeekday: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时间 ISO（与 LLM 提示词输出格式一致，不用 toISOString 以免转 UTC） */
function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 从文本里解析出第一个截止时间；解析不出返回 null */
function extractDeadline(text: string, now: Date): DeadlineHit | null {
  // ---- 时间部分：13:00 / 13点30 / 下午3点半 / 晚上8点 ----
  let minutesOfDay: number | null = null;
  let timeSpan = '';
  const timeRe = /(上午|下午|中午|晚上|凌晨)?\s*(\d{1,2})\s*([:：点])\s*(\d{1,2})?\s*(半|分)?/g;
  // "2026-10-15" 里的数字不会命中（需要冒号或"点"）；只取第一个有效时刻
  for (const m of text.matchAll(timeRe)) {
    let h = parseInt(m[2], 10);
    let min = m[4] ? parseInt(m[4], 10) : 0;
    if (m[5] === '半') min = 30;
    if (h > 23 || min > 59) continue;
    const period = m[1];
    if ((period === '下午' || period === '晚上') && h < 12) h += 12;
    if (period === '中午' && h < 12) h = 12;
    if (period === '凌晨' && h === 12) h = 0;
    minutesOfDay = h * 60 + min;
    timeSpan = m[0].trim();
    break;
  }

  // ---- 日期部分（按优先级）----
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  let date: Date | null = null;
  let dateSpan = '';
  let hasYear = false;
  let fromWeekday = false;

  const full = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[日号]?/.exec(text);
  const short = full ? null : /(?<!\d)(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[日号]?/.exec(text);
  if (full || short) {
    const y = full ? parseInt(full[1], 10) : now.getFullYear();
    const mo = parseInt((full ? full[2] : short![1]), 10);
    const d = parseInt((full ? full[3] : short![2]), 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      date = new Date(y, mo - 1, d);
      dateSpan = (full ? full[0] : short![0]).trim();
      hasYear = !!full;
    }
  }
  if (!date) {
    const rel = /今天|明天|后天/.exec(text);
    if (rel) {
      date = new Date(base);
      date.setDate(date.getDate() + (rel[0] === '今天' ? 0 : rel[0] === '明天' ? 1 : 2));
      dateSpan = rel[0];
    }
  }
  if (!date) {
    const wd = /(本|这|下)?\s*周\s*([一二三四五六日天])/.exec(text);
    if (wd) {
      const target = WEEKDAY_INDEX[wd[2]];
      date = new Date(base);
      if (wd[1] === '下') {
        // 下个自然周的 X（自然周从周一开始）：先跳到下周一，再加周内偏移
        const daysToMonday = (now.getDay() + 6) % 7;
        const nextMondayOffset = 7 - daysToMonday;
        date.setDate(date.getDate() + nextMondayOffset + ((target + 6) % 7));
      } else {
        // 周X / 本周X：未来最近的那个星期几（今天即当天）
        date.setDate(date.getDate() + ((target - now.getDay() + 7) % 7));
      }
      dateSpan = wd[0].trim();
      fromWeekday = true;
    }
  }
  if (!date) return null;

  // ---- 组装时刻 ----
  if (minutesOfDay === null) {
    // 光杆时段词（"周五下午"）：剥进 timeSpan 让标题更干净；
    // "下午"不带钟点按 18:00（与 LLM 提示词一致），其余给当天最后一刻
    const barePeriod = /(上午|下午|中午|晚上|凌晨)/.exec(text);
    if (barePeriod) {
      timeSpan = barePeriod[0];
      minutesOfDay = barePeriod[0] === '下午' ? 18 * 60 : 23 * 60 + 59;
    } else {
      minutesOfDay = 23 * 60 + 59;
    }
  }
  date.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);

  // 无年份的日期若已过去 → 滚动到未来（手输的"周五/10月15日"是未来意图）
  if (!hasYear && date.getTime() < now.getTime()) {
    if (fromWeekday) date.setDate(date.getDate() + 7);
    else date.setFullYear(date.getFullYear() + 1);
  }

  return { date, dateSpan, timeSpan, hasYear, fromWeekday };
}

/** 清理标题：去掉序号前缀、保留主体（时间片段在外层剥掉） */
function cleanTitle(line: string): string {
  return line
    .replace(/^[|｜·•\-–—>*]+\s*/, '')
    .replace(/^[0-9一二三四五六七八九十]+\s*[.、)）]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

interface Block {
  lines: string[];
  titleIdx: number;
}

function parseBlock(block: Block, now: Date, singleLine: boolean): ParsedTodo | null {
  const titleLine = block.titleIdx >= 0 ? block.lines[block.titleIdx] : '';
  if (!titleLine) return null;

  // 块内自上而下找第一个截止时间
  let hit: DeadlineHit | null = null;
  for (const line of block.lines) {
    hit = extractDeadline(line, now);
    if (hit) break;
  }

  // 带年份且已过期的（OCR 里的"已截止"）→ 跳过，不给用户建历史任务
  if (hit && hit.hasYear && hit.date.getTime() < now.getTime() - 60 * 60 * 1000) {
    return null;
  }

  // 从标题里剥掉日期/时间原文，标题更干净（"周五下午前交周报" → "前交周报"）
  let title = cleanTitle(titleLine);
  if (hit) {
    const without = title
      .replace(hit.dateSpan, '')
      .replace(hit.timeSpan, '')
      .replace(/^[的\s]*[前内到至]+\s*/, '');
    if (cleanTitle(without).length >= 2) title = cleanTitle(without);
  }

  const hasKeyword = TASK_KEYWORD_RE.test(title);
  // 无日期且无任务关键词的块按噪音丢（单行输入总是保留——用户输入的都算数）
  if (!hit && !hasKeyword && !singleLine) return null;

  // 四象限：临近截止 → 紧急；考试/论文/缴费类 → 重要
  let urgency = 1;
  if (hit) {
    const hours = (hit.date.getTime() - now.getTime()) / 3600_000;
    urgency = hours <= 48 ? 4 : hours <= 24 * 7 ? 3 : 2;
  }
  if (/紧急|马上|立即|尽快/.test(titleLine)) urgency = Math.max(urgency, 3);

  let importance = 2;
  if (/考试|论文|答辩|实验报告|缴费|报名|申请|演示/.test(titleLine)) importance = 4;
  else if (/作业|报告|提交|复习|实验/.test(titleLine)) importance = 3;

  return {
    title,
    urgency,
    importance,
    priority: priorityFrom(urgency, importance),
    deadline: hit ? toLocalIso(hit.date) : null,
    estimated_minutes: 60,
    in_class: false,
  };
}

/**
 * 离线解析入口：一段文字 → 结构化待办列表（可能为空）。
 * 解析逻辑纯本地、纯函数，不依赖网络与任何模型。
 */
export function parseOfflineTodos(rawText: string, now: Date = new Date()): ParsedTodo[] {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const singleLine = lines.length === 1;

  // ---- 分块：标题行开新块；连续标题行覆盖（取更具体的一条）----
  const blocks: Block[] = [];
  let current: Block = { lines: [], titleIdx: -1 };

  const flush = () => {
    if (current.lines.length > 0) blocks.push(current);
  };

  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const isTitle = !ATTRIBUTE_RE.test(line) && !TIME_ATTR_RE.test(line);

    if (!isTitle) {
      // 属性/时间行：只归到已有标题的块里（开头没主的属性直接丢）
      if (current.titleIdx >= 0) current.lines.push(line);
      continue;
    }

    if (current.titleIdx < 0) {
      current.lines.push(line);
      current.titleIdx = current.lines.length - 1;
    } else if (current.lines.length - current.titleIdx === 1) {
      // 紧跟在标题后的又一个标题 → 覆盖（"测验与作业" → "第一节课后作业"）
      current.lines[current.titleIdx] = line;
    } else {
      flush();
      current = { lines: [line], titleIdx: 0 };
    }
  }
  flush();

  // ---- 每一块 → 一条待办 ----
  const out: ParsedTodo[] = [];
  for (const block of blocks) {
    const parsed = parseBlock(block, now, singleLine);
    if (parsed) out.push(parsed);
  }
  // 去重（OCR 重复块）：标题 + 截止时间相同只留一条
  const seen = new Set<string>();
  return out.filter((t) => {
    const key = `${t.title}|${t.deadline ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
