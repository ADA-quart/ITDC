/**
 * CDUT 教务系统「学期个人课表」HTML 解析器
 * 移植自 CDUniTap JiaoWuCliCommander.ParseClassInfoNew
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
  const courses: CdutCourse[] = [];
  // 每个 <td width="123" height="28" align="center" valign='top'> 是一格（7 天 × 6 节）
  const cellRe = /<td width="123" height="28" align="center" valign='top'\s*>\s*([\s\S]*?)\s*<\/td>/g;
  let index = -1;
  let match: RegExpExecArray | null;

  while ((match = cellRe.exec(html)) !== null) {
    index++;
    const raw = match[1];
    const nameM = /<font onmouseover='kbtc\(this\)' onmouseout='kbot\(this\)'\s*>(.*?)<\/font>/.exec(raw);
    const name = (nameM?.[1] ?? '').replace(/<br\/>/g, '').trim();
    if (!name) continue;

    const teacherM = /<font title='教师' onmouseover='kbtc\(this\)' onmouseout='kbot\(this\)'\s*>(.*?)<\/font>/.exec(raw);
    const weekM = /<font title='周次\(节次\)' onmouseover='kbtc\(this\)' onmouseout='kbot\(this\)'\s*>(.*?)\[(.*?)\]<\/font>/.exec(raw);
    const buildingM = /<font title='教学楼' name='jxlmc' style='display:none;'\s*onmouseover='kbtc\(this\)' onmouseout='kbot\(this\)'\s*>(.*?)<\/font>/.exec(raw);
    const roomM = /<font title='教室' onmouseover='kbtc\(this\)' onmouseout='kbot\(this\)'\s*>(.*?)<\/font>/.exec(raw);

    courses.push({
      name,
      teacher: (teacherM?.[1] ?? '').trim(),
      weeks: (weekM?.[1] ?? '').trim(),
      sections: (weekM?.[2] ?? '').trim(),
      location: [buildingM?.[1] ?? '', roomM?.[1] ?? ''].filter(Boolean).join(' - '),
      dayOfWeek: (index % 7) + 1,
      sectionIndex: Math.floor(index / 7),
    });
  }
  return courses;
}

/** 从课表页 <option> 中提取学期列表 */
export function parseSemesterOptions(html: string): string[] {
  const re = /<option value="(\d{4}-\d{4}-\d)"[^>]*>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * 展开周次字符串 "1-16周" 或 "1-8,10-16周" 为具体周号列表。
 * 支持逗号分隔的多段（含 "单"/"双" 后缀场景需由调用方预处理，这里只展开数字段）。
 */
export function expandWeeks(raw: string): number[] {
  const weeks: number[] = [];
  const cleaned = raw.replace(/[（(]?周[)）]?$/, '').trim();
  if (!cleaned) return weeks;
  for (const seg of cleaned.split(/[,，]/)) {
    const rangeM = /^(\d+)-(\d+)$/.exec(seg.trim());
    if (rangeM) {
      const lo = parseInt(rangeM[1], 10);
      const hi = parseInt(rangeM[2], 10);
      for (let i = lo; i <= hi; i++) weeks.push(i);
    } else {
      const n = parseInt(seg.trim(), 10);
      if (!isNaN(n)) weeks.push(n);
    }
  }
  return weeks;
}

/** CDUT 节次时间表（与 CDUniTap 硬编码一致） */
export const TIMETABLE: readonly [string, string][] = [
  ['08:10', '09:45'],
  ['10:15', '11:50'],
  ['13:00', '14:00'],
  ['14:30', '16:05'],
  ['16:25', '18:00'],
  ['19:10', '20:45'],
];

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
