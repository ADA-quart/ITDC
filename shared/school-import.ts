// 教务课表 → 日历事件的构建逻辑。
// 从 SchoolImportModal 抽出：手动导入与「更新课表 / 每天自动同步」共用同一条转换。
import { expandWeeks, resolveSectionsTime, type CdutCourse } from './cdut-parser';
import { colorForCourse } from './course-colors';

export interface BuiltSchoolEvent {
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  color: string;
  source: string;
}

/** 聚合课程并展开周次为具体日期事件列表 */
export function buildEvents(courses: CdutCourse[], weekStartDate: Date, schoolId: string): BuiltSchoolEvent[] {
  interface AggKey { name: string; teacher: string; location: string; sectionIndex: number; dayOfWeek: number; sections: string; }
  const aggMap = new Map<string, { key: AggKey; weeks: Set<number> }>();
  for (const c of courses) {
    // 节次也进 key：同一格可能出现 "05-06节" 与 "05-06-07-08节" 两种，
    // 合并会把连堂课的时间压回前半段
    const aggKey = `${c.name}|${c.teacher}|${c.location}|${c.sectionIndex}|${c.dayOfWeek}|${c.sections}`;
    if (!aggMap.has(aggKey)) {
      aggMap.set(aggKey, {
        key: { name: c.name, teacher: c.teacher, location: c.location, sectionIndex: c.sectionIndex, dayOfWeek: c.dayOfWeek, sections: c.sections },
        weeks: new Set(),
      });
    }
    for (const n of expandWeeks(c.weeks)) aggMap.get(aggKey)!.weeks.add(n);
  }

  const events: BuiltSchoolEvent[] = [];

  for (const { key, weeks } of aggMap.values()) {
    // 时间按「节次」原文算，不看格子序号：教务的 09-10-11 节是 19:10-21:35，
    // 只按格子取会漏掉第 11 小节（显示到 20:45 就没了）
    const { start: startHm, end: endHm } = resolveSectionsTime(key.sections, key.sectionIndex);
    const [sh, sm] = startHm.split(':').map(Number);
    const [eh, em] = endHm.split(':').map(Number);
    const sortedWeeks = [...weeks].sort((a, b) => a - b);
    const weekLabel = `第${sortedWeeks.join(',')}周`;
    for (const w of sortedWeeks) {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + (w - 1) * 7 + (key.dayOfWeek - 1));
      const start = new Date(date);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(date);
      end.setHours(eh, em, 0, 0);
      events.push({
        title: key.name,
        description: [key.teacher, weekLabel, key.sections].filter(Boolean).join('\n') || null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        location: key.location || null,
        // 每门课一个固定颜色，像待办那样一眼区分（同门课永远同色）
        color: colorForCourse(key.name),
        source: schoolId,
      });
    }
  }
  return events;
}
