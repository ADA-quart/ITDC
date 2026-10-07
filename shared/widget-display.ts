/**
 * 小组件卡片副标题的显示文案。
 *
 * 教务给的 location 形如「【东区1教】 - E1B205」：教学楼谁都认识，写出来只占地方，
 * 老师名字存在教务导入时的 description 首行。因此拼成「E1B205 · 张三」。
 * 手动事件 / iCal 导入没有这种结构，原样显示，不做猜测。
 */
export interface WidgetLocationSource {
  location?: string | null;
  description?: string | null;
  source?: string | null;
}

export function widgetLocationLabel(event: WidgetLocationSource): string {
  const raw = (event.location || '').trim();
  if (!raw) return '';
  const source = (event.source || '').toLowerCase();
  const isSchoolImport = !!source && source !== 'manual' && source !== 'ical';
  if (!isSchoolImport) return raw;

  const room = raw.split(' - ').pop()?.trim() || raw;
  const firstLine = (event.description || '').split('\n')[0]?.trim() || '';
  // description 首行若不是名字（手填备注、带标点、过长），只显示教室
  const looksLikeName =
    firstLine.length > 0 && firstLine.length <= 8 && !/[，。；：:,\s]/.test(firstLine);
  return looksLikeName ? `${room} · ${firstLine}` : room;
}
