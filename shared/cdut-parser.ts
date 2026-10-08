/**
 * CDUT 教务系统「学期个人课表」页 HTML 解析。
 *
 * 页面是一张 7 列 × 6 行的大表格，每格对应「星期几的第几大节」；
 * 格子内部又可能叠着多门课、或同一门课的多段周次记录。
 * 解析结果按「每格 × 每条记录 × 每段周次」平铺返回，交给上层合并。
 */

export interface CdutCourse {
  name: string;
  teacher: string;
  weeks: string;       // 原始周次字段，如 "1-16周"
  sections: string;    // 原始节次字段，如 "1-2节"
  location: string;    // "教学楼 - 教室"
  dayOfWeek: number;   // 1=周一 ... 7=周日
  sectionIndex: number; // 0-5（每天最多 6 大节）
}

/** 解析课表 HTML，返回课程数组（每天每节课一条） */
export function parseTimetableHtml(html: string): CdutCourse[] {
  // 教务的课表格子固定长这样（属性顺序、引号风格多年未变）
  const cellRe = /<td width="123" height="28" align="center" valign='top'\s*>\s*([\s\S]*?)\s*<\/td>/g;
  const cells = Array.from(html.matchAll(cellRe), (m) => m[1]);
  const courses: CdutCourse[] = [];

  cells.forEach((cellHtml, cellIndex) => {
    // 格子按先行后列填满表格，取模即可还原星期与节次
    const dayOfWeek = (cellIndex % 7) + 1;
    const sectionIndex = Math.floor(cellIndex / 7);

    // 格子内的 DOM 有两层重复：kbcontent1 是隐藏简版、kbcontent 是完整版；
    // 而一个 div 里又可能用横线叠着好几条记录。先按 div 拆块、再按横线拆条，
    // 逐条独立解析——简版块没有 [节次]，会在解析时被自然滤掉。
    const blocks = cellHtml.split(/(?=<div[^>]*class="kbcontent)/i);
    for (const block of blocks) {
      for (const entry of block.split(/-{5,}\s*<br\s*\/?>/i)) {
        courses.push(...parseEntry(entry, dayOfWeek, sectionIndex));
      }
    }
  });

  return courses;
}

/**
 * 解析一条课程记录。同一条记录里可能挂着多段周次（同一门课拆成
 * 1-3,6-11 周与 12 周），每段单独返回一条交给上层合并——
 * 以前只取第一段，正是「缺课」的来源。
 */
function parseEntry(raw: string, dayOfWeek: number, sectionIndex: number): CdutCourse[] {
  // 课程名：格子里第一个 kbtc 悬停字体的文本
  const nameHtml = /<font onmouseover='kbtc\(this\)' onmouseout='kbot\(this\)'\s*>(.*?)<\/font>/.exec(raw)?.[1] ?? '';
  const name = nameHtml.replace(/<br\/>/g, '').trim();
  if (!name) return [];

  // 周次(节次)：只有方括号写的才是完整记录，简版块没有方括号，靠这点滤掉重复项
  const slots: Array<{ weeks: string; sections: string }> = [];
  for (const m of raw.matchAll(/<font[^>]*title='周次\(节次\)'[^>]*>(.*?)<\/font>/g)) {
    const text = m[1].replace(/<br\/>/g, '').trim();
    const parts = /^(.*?)\[(.*?)\]$/.exec(text);
    if (!parts) continue;
    slots.push({ weeks: parts[1].trim(), sections: parts[2].trim() });
  }
  if (slots.length === 0) return [];

  // 教师与地点：教学楼、教室各取一个，拼成「楼 - 房」
  const pick = (title: string) =>
    (new RegExp(`<font title='${title}'[^>]*>(.*?)</font>`).exec(raw)?.[1] ?? '').trim();
  const teacher = pick('教师');
  const location = [pick('教学楼'), pick('教室')].filter(Boolean).join(' - ');

  return slots.map((s) => ({
    name,
    teacher,
    weeks: s.weeks,
    sections: s.sections,
    location,
    dayOfWeek,
    sectionIndex,
  }));
}

/** 从课表页 <option> 中提取学期列表 */
export function parseSemesterOptions(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/<option value="(\d{4}-\d{4}-\d)"[^>]*>/g)) {
    found.add(m[1]);
  }
  return [...found];
}

/**
 * 展开周次字符串 "1-16周" 或 "1-8,10-16周" 为具体周号列表。
 * 支持逗号分隔的多段（含 "单"/"双" 后缀场景需由调用方预处理，这里只展开数字段）。
 */
export function expandWeeks(raw: string): number[] {
  const weeks: number[] = [];
  if (!raw) return weeks;
  // 逐段去掉「周」及其括号：教务会写成 "1-3,6-11(周)" 甚至 "1-3,6-11(周),12(周)"
  for (const rawSeg of raw.split(/[,，]/)) {
    const seg = rawSeg.replace(/[（(]?\s*周\s*[)）]?/g, '').trim();
    if (!seg) continue;
    const rangeM = /^(\d+)\s*[-~－]\s*(\d+)$/.exec(seg);
    if (rangeM) {
      const lo = parseInt(rangeM[1], 10);
      const hi = parseInt(rangeM[2], 10);
      if (hi >= lo) for (let i = lo; i <= hi; i++) weeks.push(i);
    } else {
      const n = parseInt(seg, 10);
      if (!isNaN(n)) weeks.push(n);
    }
  }
  return weeks;
}

/** CDUT 作息时间表：每个大节对应的上下课时刻 */
export const TIMETABLE: readonly [string, string][] = [
  ['08:10', '09:45'],
  ['10:15', '11:50'],
  ['13:00', '14:00'],
  ['14:30', '16:05'],
  ['16:25', '18:00'],
  ['19:10', '20:45'],
  // 晚课第三节：教务课表里有 19:10-21:35 这种连上三节的课，
  // 少了这一节，21:35 下课的课在课表格子里显示不全（也识别不成"课程"）
  ['20:55', '21:35'],
];

/**
 * 教务「节次」里的小节号 → 上面这张表的行号。
 *
 * 教务写的是小节课号（"09-10-11节"），一格大课 = 2 小节，且下午/晚上连续：
 * 01-02 = 第 1 大节、03-04 = 第 2 大节、05-06 = 第 4 大节（14:30-16:05）、
 * 07-08 = 第 5 大节（16:25-18:00）、09-10 = 第 6 大节（19:10-20:45），
 * 第 11 小节单独是第 7 大节（20:55-21:35）。
 *
 * 这张表是拿同一门课的 SimpleCDUT 导出（带真实时间）逐条比出来的：
 * 09-10-11 节 ↔ 19:10-21:35、05-06-07-08 节 ↔ 14:30-18:00。
 * 只按格子序号取时间会漏掉后半段（晚课显示到 20:45 就是这么来的）。
 */
export const SECTION_NUMBER_TO_SLOT: Record<number, number> = {
  1: 0, 2: 0,
  3: 1, 4: 1,
  5: 3, 6: 3,
  7: 4, 8: 4,
  9: 5, 10: 5,
  11: 6,
};

/** 按「节次」原文（如 "09-10-11节"）求真实起止时间；认不出来就退回格子序号 */
export function resolveSectionsTime(
  sections: string,
  fallbackSlot: number
): { start: string; end: string } {
  const toSlot = (n: number) => SECTION_NUMBER_TO_SLOT[n];
  const nums = (sections.match(/\d+/g) ?? [])
    .map(Number)
    .filter((n) => toSlot(n) !== undefined);
  if (nums.length === 0) {
    const slot = Math.max(0, Math.min(TIMETABLE.length - 1, fallbackSlot));
    return { start: TIMETABLE[slot][0], end: TIMETABLE[slot][1] };
  }
  const slots = nums.map(toSlot);
  const first = Math.min(...slots);
  const last = Math.max(...slots);
  return { start: TIMETABLE[first][0], end: TIMETABLE[last][1] };
}

/**
 * 判断一条事件是否应按"课程"处理。
 *
 * - 教务导入（source 为学校 id，如 cdut）：直接是课程；
 * - iCal 导入（source === 'ical'）：只有带教室、且起止时间精确落在标准节次
 *   边界上才视为课程——这样 SimpleCDUT 之类导出的课表也能用「课内可做」，
 *   而普通 iCal 日程（会议、生日）不会被误判；
 * - 手动事件（source === 'manual'）：不是课程。
 */
export function looksLikeCourse(event: {
  source?: string | null;
  start_time: string;
  end_time: string;
  location?: string | null;
}): boolean {
  const source = (event.source || '').toLowerCase();
  if (source && source !== 'manual' && source !== 'ical') return true;
  if (source !== 'ical') return false;
  if (!event.location || !event.location.trim()) return false;

  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  if (endMinutes <= startMinutes) return false;
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const startOk = TIMETABLE.some(([s]) => toMinutes(s) === startMinutes);
  const endOk = TIMETABLE.some(([, e]) => toMinutes(e) === endMinutes);
  return startOk && endOk;
}

/** 节次索引对应的事件起止时间，返回 ISO 字符串 */
export function sectionTime(sectionIndex: number, date: Date): { start: string; end: string } {
  const [sh, sm] = TIMETABLE[sectionIndex][0].split(':').map(Number);
  const [eh, em] = TIMETABLE[sectionIndex][1].split(':').map(Number);
  const start = new Date(date);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(date);
  end.setHours(eh, em, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}
