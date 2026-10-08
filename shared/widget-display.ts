/**
 * 小组件卡片副标题的显示文案。
 *
 * 导入来源的 location 可能是「【东区1教】 - E1B205」（教学楼谁都认识，只占地方），
 * 老师名字在 description 首行（教务导入、SimpleCDUT 导出都是这个结构，
 * 后者还会写成「张玮,张玮」）。因此拼成「E1B205 · 张玮」。
 * 手动建的事件没有这种结构，原样显示不猜。
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
  // 手动事件保持原样；导入的课才做「教室 + 老师」的整理
  if (!source || source === 'manual') return raw;

  const room = raw.split(' - ').pop()?.trim() || raw;
  // 教室得像个教室（带门牌号），否则「线上」这种配上一段说明会很怪
  if (!/\d/.test(room)) return room;

  const firstLine = (event.description || '').split('\n')[0]?.trim() || '';
  // SimpleCDUT 导出把老师写成 "张玮,张玮"（同一个人重复两遍），先折叠掉
  const name = firstLine.replace(/^(.{1,12})[,，]\1$/, '$1').trim();
  // 首行不是名字（手填备注、周次节次之类）就只显示教室
  const looksLikeName =
    name.length >= 2 &&
    name.length <= 8 &&
    !/[，。；：:,\s]/.test(name) &&
    !/[周月日节第]/.test(name);
  return looksLikeName ? `${room} · ${name}` : room;
}
