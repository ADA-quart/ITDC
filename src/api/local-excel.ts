// 本地周历 Excel 导出：与 server/routes/calendar.ts 的 export-week 保持同样的两张表结构。
import XLSX from 'xlsx-js-style';
import type { Calendar, CalendarEvent, Todo } from '../types';
import { exportFile } from './export-file';

const PRIORITY_LABELS_ZH: Record<string, string> = {
  'urgent-important': '紧急重要',
  important: '重要不紧急',
  urgent: '紧急不重要',
  normal: '普通',
};
const PRIORITY_LABELS_EN: Record<string, string> = {
  'urgent-important': 'Urgent & Important',
  important: 'Important',
  urgent: 'Urgent',
  normal: 'Normal',
};

function getWeekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function exportWeekLocally(
  events: CalendarEvent[],
  todos: Todo[],
  calendars: Calendar[],
  lang: 'zh' | 'en' = 'zh'
): Promise<void> {
  const { start: weekStart, end: weekEnd } = getWeekRange(new Date());
  const calNameById = new Map(calendars.map((c) => [c.id, c.name]));

  const inWeek = (start: string, end: string) =>
    new Date(start) < weekEnd && new Date(end) > weekStart;

  const weekEvents = events.filter((e) => inWeek(e.start_time, e.end_time));
  const weekTodos = todos.filter(
    (t) => t.status === 'scheduled' && t.scheduled_start && t.scheduled_end && inWeek(t.scheduled_start, t.scheduled_end)
  );

  const PRIORITY_LABELS = lang === 'zh' ? PRIORITY_LABELS_ZH : PRIORITY_LABELS_EN;
  const DAY_NAMES =
    lang === 'zh'
      ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  interface CalendarItem {
    title: string;
    start: string;
    end: string;
    calendar_name?: string;
    location?: string | null;
    description?: string | null;
    type: 'event' | 'todo';
    priority?: string;
  }

  const items: CalendarItem[] = [
    ...weekEvents.map((e) => ({
      title: e.title,
      start: e.start_time,
      end: e.end_time,
      calendar_name: calNameById.get(e.calendar_id) || '',
      location: e.location,
      description: e.description,
      type: 'event' as const,
    })),
    ...weekTodos.map((t) => ({
      title: (lang === 'zh' ? '[待办] ' : '[Todo] ') + t.title,
      start: t.scheduled_start as string,
      end: t.scheduled_end as string,
      calendar_name: lang === 'zh' ? '待办' : 'Todo',
      location: null,
      description: t.description,
      type: 'todo' as const,
      priority: t.priority,
    })),
  ];

  // --- Sheet 1: 本周日历 ---
  const columns: string[][] = [[], [], [], [], [], [], []];
  for (const item of items) {
    const itemDate = new Date(item.start);
    let dayIdx = itemDate.getDay();
    dayIdx = dayIdx === 0 ? 6 : dayIdx - 1;
    const startH = itemDate.getHours().toString().padStart(2, '0');
    const startM = itemDate.getMinutes().toString().padStart(2, '0');
    const endD = new Date(item.end);
    const endH = endD.getHours().toString().padStart(2, '0');
    const endM = endD.getMinutes().toString().padStart(2, '0');
    let text = `${startH}:${startM}-${endH}:${endM} ${item.title}`;
    if (item.priority) text += ` [${PRIORITY_LABELS[item.priority] || item.priority}]`;
    columns[dayIdx].push(text);
  }

  const maxRows = Math.max(1, ...columns.map((c) => c.length));
  const headerStyle: XLSX.CellStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1890FF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  const titleStyle: XLSX.CellStyle = {
    font: { sz: 16, bold: true },
    alignment: { horizontal: 'center' },
  };

  const weekTitle =
    lang === 'zh'
      ? `本周日历 (${fmtDate(weekStart)} ~ ${fmtDate(new Date(weekEnd.getTime() - 86400000))})`
      : `Weekly Calendar (${fmtDate(weekStart)} ~ ${fmtDate(new Date(weekEnd.getTime() - 86400000))})`;

  const weekData: any[][] = [[weekTitle, '', '', '', '', '', ''], [], DAY_NAMES];
  for (let r = 0; r < maxRows; r++) {
    weekData.push(columns.map((c) => c[r] || ''));
  }

  const weekSheet = XLSX.utils.aoa_to_sheet(weekData);
  weekSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
  const titleCell = weekSheet['A1'];
  if (titleCell) titleCell.s = titleStyle;
  for (let c = 0; c < 7; c++) {
    const cell = weekSheet[XLSX.utils.encode_cell({ r: 2, c })];
    if (cell) cell.s = headerStyle;
  }
  weekSheet['!cols'] = DAY_NAMES.map((name, i) => {
    let maxLen = name.length;
    columns[i].forEach((s) => {
      if (s.length > maxLen) maxLen = s.length;
    });
    return { wch: Math.max(18, Math.min(Math.ceil(maxLen * 1.8), 50)) };
  });

  // --- Sheet 2: 事件明细 ---
  const LIST_HEADERS =
    lang === 'zh'
      ? ['类型', '标题', '开始时间', '结束时间', '所属日历', '地点', '优先级', '描述']
      : ['Type', 'Title', 'Start', 'End', 'Calendar', 'Location', 'Priority', 'Description'];

  const listData: any[][] = [LIST_HEADERS];
  for (const item of items) {
    listData.push([
      item.type === 'todo' ? (lang === 'zh' ? '待办' : 'Todo') : lang === 'zh' ? '事件' : 'Event',
      item.title,
      item.start,
      item.end,
      item.calendar_name || '',
      item.location || '',
      item.priority ? PRIORITY_LABELS[item.priority] || item.priority : '',
      item.description || '',
    ]);
  }

  const listSheet = XLSX.utils.aoa_to_sheet(listData);
  for (let c = 0; c < 8; c++) {
    const cell = listSheet[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = headerStyle;
  }
  listSheet['!cols'] = [
    { wch: 8 },
    { wch: 30 },
    { wch: 20 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 30 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, weekSheet, lang === 'zh' ? '本周日历' : 'Weekly Calendar');
  XLSX.utils.book_append_sheet(workbook, listSheet, lang === 'zh' ? '事件明细' : 'Event Details');

  const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  await exportFile(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `calendar-week-${fmtDate(weekStart)}.xlsx`
  );
}
