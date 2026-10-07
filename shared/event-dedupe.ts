/**
 * 同一门课被多个日历重复导入时（教务 + 多个 iCal 导出），按
 * 「标题 + 起止时间 + 教室」去重，只保留一条展示。
 *
 * - 教务来源（非 ical）优先：信息更全（教师、周次、教室）；
 * - 教室不同不合并：单双周在不同教室上课是两门不同的安排；
 * - 只影响展示与融合目标，不动数据库；隐藏某个日历后再读依然正确。
 */
export interface DedupeableEvent {
  title: string;
  start_time: string;
  end_time: string;
  location?: string | null;
  source?: string | null;
}

function normalizeRoom(location?: string | null): string {
  const raw = (location || '').trim();
  // 「【东区1教】 - E1B205」与「E1B205」是同一间教室：取最后一段再比较
  // 「E1B214(智慧)」与「E1B214」也视为同一间：去掉括号备注
  const room = (raw.includes(' - ') ? (raw.split(' - ').pop() || raw) : raw)
    .replace(/[（(][^）)]*[）)]/g, '');
  return room.trim().replace(/\s+/g, '').toUpperCase();
}

export function dedupeEventKey(event: DedupeableEvent): string {
  return [
    String(event.title || '').trim(),
    event.start_time,
    event.end_time,
    normalizeRoom(event.location),
  ].join('|');
}

export function dedupeEvents<T extends DedupeableEvent>(events: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const event of events) {
    const key = dedupeEventKey(event);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      continue;
    }
    // 教务信息优先于 iCal 导出；同来源保留先出现的那条
    const existingIsIcal = (existing.source || '').toLowerCase() === 'ical';
    const incomingIsIcal = (event.source || '').toLowerCase() === 'ical';
    if (existingIsIcal && !incomingIsIcal) byKey.set(key, event);
  }
  return [...byKey.values()];
}
