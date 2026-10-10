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
 *   但「无年份」的日期若已过去：周X → 下周五；刚过去一个月内的月/日 → 保留为
 *   逾期任务（"10月8日"在 10-10 输入就是要提醒补交）；更久远的 → 滚到明年
 *   （10 月里说"3月15日"是说明年的）；
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

/** 提问/讨论行（"到底十一号还是明天下午"）：没有任务关键词就不是待办 */
const QUESTION_RE = /[?？]|吗|呢|还是|到底/;

/**
 * "这是截止时间"的强信号。作业通知里常见 开始时间 / 结束时间 两行，
 * 按行序取第一个日期会先取到"开始时间"（往往已经过去），把整条误判成已截止；
 * 所以取值时先扫带这些词的行，扫不到再退回"第一个带日期的行"。
 */
const DEADLINE_HINT_RE = /截止|结束|过期|到期|deadline|due/i;

/** 页面/栏目标题（"[课程通知]"、"公告"、"作业结束提醒"）：本身不是任务 */
const SECTION_HEADER_RE = /^[【\[（(]?\s*(课程通知|作业通知|学习通知|通知|公告|消息|提醒)\s*[】\]）)]?$/;

/** 发送者名片（"JSAI卫（不回答技术问题）"）：被当成标题时改选正文行 */
const SENDER_NAME_RE = /^[^\s]{1,16}[（(][^）)]{2,}[）)]$/;

/** 聊天记录里的「非消息」行：群名、时间戳、成员名片、底部工具栏 */
const CHAT_META_RES: RegExp[] = [
  /LV\s*\d+/i,
  /\d{11}/,
  /^(昨天|今天|前天|星期[一二三四五六日天]|\d{1,2}月\d{1,2}日)?\s*\d{1,2}[:：]\d{2}$/,
  // "09/2621:55"：OCR 常把日期时间和前面的文字挤在一起，中间没有空格
  /^\d{1,2}[/\-.月]\s*\d{1,2}[日号]?\s*\d{1,2}[:：]\d{2}$/,
  /群[（(]\d+[)）]/,
  /^[\d\s]*(文件|相册|表情|更多|精华消息|接龙统计|发送|图片|语音|视频|位置|红包|转账|作业|老师消息)+[\d\s]*$/,
];

/** 聊天里的寒暄/应答（不产生待办） */
const CHAT_FILLER_RE = /^(收到|好的?|好嘞|嗯+|哦+|谢谢|感谢|抱歉|对不起|知道了|明白了|没事|没有了|哈哈+|写错|打错|发错|撤回|同上|加一)/;

/**
 * 聊天时间戳行 → 具体时刻（消息发出的时间），拿它给消息里的"10月8日"这类
 * 无年份日期做锚点：09/26 的消息说"10月8日"就是同年 10-08（已过 → 按已截止跳过），
 * 而不是按"未来意图"滚到明年 10-08。
 */
function parseChatTimestamp(line: string, now: Date): Date | null {
  let m = /^(昨天|今天|前天)\s*(\d{1,2})[:：](\d{2})$/.exec(line);
  if (m) {
    const d = new Date(now);
    d.setDate(d.getDate() - (m[1] === '昨天' ? 1 : m[1] === '前天' ? 2 : 0));
    d.setHours(parseInt(m[2], 10), parseInt(m[3], 10), 0, 0);
    return d;
  }
  m = /^(\d{1,2})[/\-.月]\s*(\d{1,2})[日号]?\s*(\d{1,2})[:：](\d{2})$/.exec(line);
  if (m) {
    const d = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10), 0, 0);
    // 12/31 的消息在 1 月初看到时按上一年算
    if (d.getTime() > now.getTime() + 24 * 3600 * 1000) d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  m = /^星期([一二三四五六日天])?\s*(\d{1,2})[:：](\d{2})$/.exec(line);
  if (m) {
    const target = WEEKDAY_INDEX[m[1] ?? '日'] ?? 0;
    const d = new Date(now);
    d.setDate(d.getDate() - ((now.getDay() - target + 7) % 7));
    d.setHours(parseInt(m[2], 10), parseInt(m[3], 10), 0, 0);
    return d;
  }
  return null;
}

/** 噪音行：纯数字/符号、状态栏碎片、独立时间戳（HH:MM）等 */
function isNoiseLine(line: string): boolean {
  const s = line.trim();
  if (s.length === 0) return true;
  if (/^[\d\s.,:%+\-*/\\|()（）【】\[\]<>《》'"“”‘’·•…~～-]+$/.test(s)) return true;
  if (/^\d{1,2}[:：]\d{2}$/.test(s)) return true;
  if (/KBs?|MB\/s|KB\/s/i.test(s)) return true;
  // 通知的发布时刻（"学习通知 06-29 16:54"）：是消息时间，不是任务时间
  if (/^(学习通知|通知时间|发布时间|发送时间)\s*[:：]?\s*\d{1,2}[/\-.月]\s*\d{1,2}[日号]?\s*\d{1,2}[:：]\d{2}$/.test(s)) return true;
  // 裸的日期时刻行（"2026年10月2日13:06"）：群公告/帖子的发布时间，不是任务
  if (/^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}[:：]\d{2}$/.test(s)) return true;
  // QQ 群公告的页面控件：只是界面元素，不是内容
  if (/^(群公告|置顶|发给新成员|你已确认|已确认)$/.test(s)) return true;
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
  /** 日期带年份（OCR 常见）；无年份的按"周X 滚下周、近月内保留逾期、更远滚明年"处理 */
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
function extractDeadline(text: string, now: Date, allowRollForward = true): DeadlineHit | null {
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

  // 无年份的日期若已过去：
  //   * "周X" 一定指下一个（周六说"周五交"=下周五）→ +7 天；
  //   * 刚过去一个月内的月/日（今天 10-10 说"10月8日交"）大概率是"已经逾期"，
  //     保留原日期当逾期任务，比滚到明年有用得多；
  //   * 更久远的月/日（10 月里说"3月15日"）按未来意图滚到明年。
  if (allowRollForward && !hasYear && date.getTime() < now.getTime()) {
    if (fromWeekday) {
      date.setDate(date.getDate() + 7);
    } else if (now.getTime() - date.getTime() > 30 * 24 * 60 * 60 * 1000) {
      date.setFullYear(date.getFullYear() + 1);
    }
  }

  return { date, dateSpan, timeSpan, hasYear, fromWeekday };
}

/** 清理标题：去掉序号前缀、保留主体（时间片段在外层剥掉） */
function cleanTitle(line: string): string {
  return line
    .replace(/^[|｜·•\-–—>*]+\s*/, '')
    // 群聊里的 "@全体成员 请…" → "请…"。OCR 会把发送者名片和 @ 提到一行
    // （"老师工程-张老师@全体成员 实验报告…"），所以允许 @ 前面粘少量名片文字。
    .replace(/^.{0,20}?@(全体成员|所有人|all)\s*[:：,，]?\s*/i, '')
    // 学习通/教务通知里的字段标签："作业名称：判断题" → "判断题"
    .replace(/^(作业名称|课程名称|作业标题|考试名称|标题|名称|主题)\s*[:：]\s*/, '')
    // 群公告里的称谓前缀："各位参赛选手：复赛…" → "复赛…"（只剥纯中文/英文的短标签，
    // 避免把 "9:30 开会" 这种时间戳当标签切掉）
    .replace(/^[\u4e00-\u9fa5A-Za-z]{1,10}\s*[:：]\s*/, '')
    .replace(/^[0-9一二三四五六七八九十]+\s*[.、)）]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    // "…提交截止时间为" 这种被日期截断后留下的悬空助词
    .replace(/[为是]\s*$/, '')
    .slice(0, 60);
}

interface Block {
  lines: string[];
  titleIdx: number;
  /** 聊天模式：这条消息发出的时刻（由最近的时间戳行使出），做日期锚点用 */
  messageTime?: Date;
}

function parseBlock(block: Block, now: Date, singleLine: boolean, chat = false): ParsedTodo | null {
  let titleLine = block.titleIdx >= 0 ? block.lines[block.titleIdx] : '';
  if (!titleLine) return null;

  // 群公告/通知截图里发送者名片（"JSAI卫（不回答技术问题）"）常被当成标题，
  // 这时改用块内第一条像句子的正文行当标题
  if (block.lines.length > 1 && SENDER_NAME_RE.test(cleanTitle(titleLine))) {
    const alt = block.lines.find(
      (l) => l !== titleLine && /[\u4e00-\u9fa5]{4,}/.test(l) && !/^\s*\d/.test(l),
    );
    if (alt) titleLine = alt;
  }

  // 聊天消息带发出时间：无年份的日期按消息发出的那天解析、且不做"未来滚动"
  // （09/26 的"10月8日"就是同年 10-08；它是已截止，按规则跳过而不是滚到明年）
  const anchored = chat && block.messageTime ? block.messageTime : null;

  // 块内先找"截止/结束/到期"这类明确的行，找不到再退回第一个带日期的行
  let hit: DeadlineHit | null = null;
  for (const line of block.lines) {
    if (!DEADLINE_HINT_RE.test(line)) continue;
    hit = extractDeadline(line, anchored ?? now, !anchored);
    if (hit) break;
  }
  if (!hit) {
    for (const line of block.lines) {
      hit = extractDeadline(line, anchored ?? now, !anchored);
      if (hit) break;
    }
  }
  // 锚定后日期已经确定（相当于带年份），过期就按已截止处理
  if (hit && anchored) hit.hasYear = true;

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
      // "明天（10月11日）下午15:00" 剥掉日期后剩一对空括号，顺手清掉
      .replace(/[（(]\s*[)）]/g, '')
      .replace(/^[的\s]*[前内到至]+\s*/, '');
    if (cleanTitle(without).length >= 2) title = cleanTitle(without);
  }

  const hasKeyword = TASK_KEYWORD_RE.test(title);
  // 页面栏目标题（"[课程通知]"）不是待办
  if (SECTION_HEADER_RE.test(title)) return null;
  // 以冒号结尾的是引出语/栏目标题（"…提交要求）："），不是任务
  if (/[：:]\s*$/.test(title)) return null;
  // 提问（"到底十一号还是明天下午"）不产生待办——除非明确带任务关键词。
  // 群聊寒暄（"收到""写错了"）同理：只有整句基本就是寒暄时才丢，
  // "好的，我这就交作业"这种仍要保留。
  if (!hasKeyword && QUESTION_RE.test(title)) return null;
  if (chat && !hit) {
    const rest = title.replace(CHAT_FILLER_RE, '').replace(/^[\s，,。.！!~～：:]+/, '');
    if (rest.length <= 2) return null;
  }
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
function splitLines(rawText: string): string[] {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** 是不是聊天记录里的人名/时间/群名/工具栏行 */
function isChatMetaLine(line: string): boolean {
  return CHAT_META_RES.some((re) => re.test(line));
}

/**
 * 聊天记录：以「人名 / 时间戳 / 群名 / 工具栏」为消息分隔符，把中间连续的内容行
 * 合并成一条消息。手机截图里一条消息常被 OCR 拆成 2~4 行（换行处没有标点），
 * 按行处理会把"请同学们，明天（10月11日）下午15:00到北翼楼5408开班会"拆成碎片，
 * 关键信息（地点/时间）反而被当成噪音丢掉。
 */
function detectChatLog(lines: string[], now: Date): boolean {
  let meta = 0;
  for (const line of lines) {
    // 时间戳行（"09/2621:55"）看起来就是数字和符号，会被噪音规则吃掉，先单独算
    if (parseChatTimestamp(line, now)) {
      meta += 1;
      continue;
    }
    if (isNoiseLine(line)) continue;
    if (isChatMetaLine(line)) meta += 1;
  }
  // 两条以上"非消息行"才认定是聊天记录，避免把普通清单误判
  return meta >= 2;
}

function buildChatBlocks(lines: string[], now: Date): Block[] {
  const blocks: Block[] = [];
  let current: string[] = [];
  let msgTime: Date | null = null;
  const flush = () => {
    if (current.length > 0) {
      blocks.push({ lines: [current.join('')], titleIdx: 0, messageTime: msgTime ?? undefined });
    }
    current = [];
  };
  for (const line of lines) {
    // 时间戳行要在噪音过滤之前判：它在字形上就是"数字+符号"，否则会被当噪音丢掉
    const t = parseChatTimestamp(line, now);
    if (t) {
      flush();
      msgTime = t;
      continue;
    }
    if (isNoiseLine(line)) continue;
    if (isChatMetaLine(line)) {
      // 人名 / 群名 / 工具栏：只做分隔，不清掉时间锚点（时间戳后面常隔一行名片才是正文）
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * 清单 / 文档：标题行开新块；连续标题行覆盖（取更具体的一条，如
 * "测验与作业" → "第一节课后作业"）；属性行（批改方式/总分/截止…）归入当前块。
 */
function buildListBlocks(lines: string[]): Block[] {
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
  return blocks;
}

export function parseOfflineTodos(rawText: string, now: Date = new Date()): ParsedTodo[] {
  const lines = splitLines(rawText);
  if (lines.length === 0) return [];
  const singleLine = lines.length === 1;
  const chat = detectChatLog(lines, now);
  const blocks = chat ? buildChatBlocks(lines, now) : buildListBlocks(lines);

  // ---- 每一块 → 一条待办 ----
  const out: ParsedTodo[] = [];
  for (const block of blocks) {
    const parsed = parseBlock(block, now, singleLine, chat);
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

/**
 * 从识别文本里挑出「像任务」的行——无 LLM 时最后一道兜底用。
 *
 * 背景：OCR 糊掉时 parseOfflineTodos 会正确地一条都不返回（拒绝把乱码当结构），
 * 但如果兜底逻辑于是「按行建待办」，就会把"公京/送件/总分20/进入作业"全部
 * 建成垃圾待办（实测一张作业截图能出 11 条）。这里宁缺毋滥：
 * 去掉噪音行与属性行（总分/按钮/批改方式/截止说明），只保留带任务关键词
 * 或能解析出日期的行，去重后限 20 条；一条都没有就交给上层弹"识别原文"。
 */
export function pickTaskLines(rawText: string, now: Date = new Date()): string[] {
  const lines = splitLines(rawText);
  if (lines.length === 0) return [];
  const chat = detectChatLog(lines, now);
  // 聊天记录按「消息块」判断（OCR 常把一条消息拆成多行，逐行会拆出碎片）；
  // 普通清单保持逐行判断——行与行是独立条目，不能被标题覆盖逻辑吞掉。
  const candidates: { text: string; ref?: Date }[] = chat
    ? buildChatBlocks(lines, now)
        .map((b) => ({ text: b.titleIdx >= 0 ? b.lines[b.titleIdx] : '', ref: b.messageTime }))
        .filter((c) => c.text)
    : lines.map((text) => ({ text }));
  const out: string[] = [];
  for (const { text: raw, ref } of candidates) {
    if (isNoiseLine(raw)) continue;
    if (ATTRIBUTE_RE.test(raw) || TIME_ATTR_RE.test(raw)) continue;
    const line = cleanTitle(raw);
    if (!line) continue;
    if (/[：:]\s*$/.test(line)) continue;
    const hasKeyword = TASK_KEYWORD_RE.test(line);
    if (!hasKeyword && QUESTION_RE.test(line)) continue;
    const hit = extractDeadline(line, ref ?? now, !ref);
    // 与 parseBlock 同口径：日期已确定（原文本就带年份，或锚定在消息时间）且已过 → 不建
    if (hit && (hit.hasYear || ref) && hit.date.getTime() < now.getTime() - 60 * 60 * 1000) continue;
    const hasDate = hit !== null;
    if (chat && !hasDate) {
      const rest = line.replace(CHAT_FILLER_RE, '').replace(/^[\s，,。.！!~～：:]+/, '');
      if (rest.length <= 2) continue;
    }
    if (!hasKeyword && !hasDate) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out.slice(0, 20);
}

