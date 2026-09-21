import { Router, Request, Response } from 'express';
import multer from 'multer';
import XLSX from 'xlsx-js-style';
import db from '../db/index.js';
import { parseIcsFile } from '../services/ical-parser.js';
import { debug } from '../utils/debug.js';

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

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

// 获取所有日历
router.get('/calendars', (_req: Request, res: Response) => {
  const calendars = db.prepare('SELECT * FROM calendars ORDER BY created_at DESC').all();
  res.json(calendars);
});

// 创建日历
router.post('/calendars', (req: Request, res: Response) => {
  const { name, color } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: '日历名称不能为空' });
  }
  const result = db.prepare('INSERT INTO calendars (name, color) VALUES (?, ?)').run(name, color || '#1890ff');
  const calendar = db.prepare('SELECT * FROM calendars WHERE id = ?').get(result.lastInsertRowid);
  res.json(calendar);
});

// 删除日历（使用事务确保原子性）
router.delete('/calendars/:id', (req: Request, res: Response) => {
  const calendar = db.prepare('SELECT id FROM calendars WHERE id = ?').get(req.params.id);
  if (!calendar) {
    return res.status(404).json({ error: '日历不存在' });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM events WHERE calendar_id = ?').run(req.params.id);
    db.prepare('DELETE FROM calendars WHERE id = ?').run(req.params.id);
  });
  // transaction() 内部已调用 markDirty()，显式 save 确保立即持久化
  db.save();
  res.json({ success: true });
});

// 获取事件列表
router.get('/events', (req: Request, res: Response) => {
  const { start, end } = req.query;
  let events;
  if (start && end) {
    events = db.prepare(
      'SELECT e.*, c.name as calendar_name, c.color as calendar_color FROM events e JOIN calendars c ON e.calendar_id = c.id WHERE e.start_time < ? AND e.end_time > ? ORDER BY e.start_time'
    ).all(end, start);
  } else {
    events = db.prepare(
      'SELECT e.*, c.name as calendar_name, c.color as calendar_color FROM events e JOIN calendars c ON e.calendar_id = c.id ORDER BY e.start_time DESC'
    ).all();
  }
  res.json(events);
});

// 创建事件
router.post('/events', (req: Request, res: Response) => {
  const { calendar_id, title, description, start_time, end_time, rrule, location } = req.body;
  if (!title || !calendar_id || !start_time || !end_time) {
    return res.status(400).json({ error: '标题、日历、开始时间和结束时间为必填项' });
  }
  if (new Date(end_time) <= new Date(start_time)) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }
  const result = db.prepare(
    'INSERT INTO events (calendar_id, title, description, start_time, end_time, rrule, location) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(calendar_id, title, description || null, start_time, end_time, rrule || null, location || null);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  res.json(event);
});

// 更新事件
router.put('/events/:id', (req: Request, res: Response) => {
  const { title, description, start_time, end_time, rrule, location, calendar_id } = req.body;
  const fields: string[] = [];
  const values: any[] = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(title); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (start_time !== undefined) { fields.push('start_time = ?'); values.push(start_time); }
  if (end_time !== undefined) { fields.push('end_time = ?'); values.push(end_time); }
  if (rrule !== undefined) { fields.push('rrule = ?'); values.push(rrule); }
  if (location !== undefined) { fields.push('location = ?'); values.push(location); }
  if (calendar_id !== undefined) { fields.push('calendar_id = ?'); values.push(calendar_id); }
  if (fields.length === 0) return res.json({ success: true });

  // 验证开始时间必须早于结束时间
  if (start_time !== undefined || end_time !== undefined) {
    const current = db.prepare('SELECT start_time, end_time FROM events WHERE id = ?').get(req.params.id) as { start_time: string; end_time: string } | undefined;
    if (current) {
      const finalStart = start_time ?? current.start_time;
      const finalEnd = end_time ?? current.end_time;
      if (new Date(finalEnd) <= new Date(finalStart)) {
        return res.status(400).json({ error: '结束时间必须晚于开始时间' });
      }
    }
  }

  values.push(req.params.id);
  db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  res.json(event);
});

// 删除事件
router.delete('/events/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 导入 iCal 文件
router.post('/import', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 .ics 文件' });
    }

    const icsContent = req.file.buffer.toString('utf-8');
    const parsedEvents = parseIcsFile(icsContent);

    if (parsedEvents.length === 0) {
      return res.status(400).json({ error: '未找到有效事件' });
    }

    const calendarName = req.body.calendar_name || '导入日历';
    const calendarColor = req.body.calendar_color || '#52c41a';

    debug.info('iCal import', { calendarName, eventCount: parsedEvents.length });

    const calendarResult = db.prepare(
      "INSERT INTO calendars (name, color, source) VALUES (?, ?, 'ical')"
    ).run(calendarName, calendarColor);

    const calendarId = calendarResult.lastInsertRowid;

    const insertStmt = db.prepare(
      'INSERT INTO events (calendar_id, title, description, start_time, end_time, rrule, location, source, uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const importedCount = db.transaction(() => {
      let count = 0;
      for (const ev of parsedEvents) {
        insertStmt.run(
          calendarId,
          ev.title,
          ev.description || null,
          ev.startTime,
          ev.endTime,
          ev.rrule || null,
          ev.location,
          'ical',
          ev.uid
        );
        count++;
      }
      return count;
    });

    db.save();
    debug.info('iCal import success', { importedCount });
    res.json({
      success: true,
      calendar_id: calendarId,
      imported_count: importedCount,
    });
  } catch (error: any) {
    debug.error('iCal import failed', error.message);
    res.status(500).json({ error: error.message || '导入失败' });
  }
});

router.get('/export-week', (req: Request, res: Response) => {
  try {
    const lang = (req.query.lang as string) || (req.headers['accept-language']?.startsWith('zh') ? 'zh' : 'en');
    const { start: weekStart, end: weekEnd } = getWeekRange(new Date());

    const events = db.prepare(
      'SELECT e.*, c.name as calendar_name, c.color as calendar_color FROM events e JOIN calendars c ON e.calendar_id = c.id WHERE e.start_time < ? AND e.end_time > ? ORDER BY e.start_time'
    ).all(weekEnd.toISOString(), weekStart.toISOString()) as any[];

    const todos = db.prepare(
      "SELECT * FROM todos WHERE status = 'scheduled' AND scheduled_start < ? AND scheduled_end > ? ORDER BY scheduled_start"
    ).all(weekEnd.toISOString(), weekStart.toISOString()) as any[];

    const PRIORITY_LABELS_ZH: Record<string, string> = {
      'urgent-important': '紧急重要',
      'important': '重要不紧急',
      'urgent': '紧急不重要',
      'normal': '普通',
    };
    const PRIORITY_LABELS_EN: Record<string, string> = {
      'urgent-important': 'Urgent & Important',
      'important': 'Important',
      'urgent': 'Urgent',
      'normal': 'Normal',
    };
    const PRIORITY_LABELS = lang === 'zh' ? PRIORITY_LABELS_ZH : PRIORITY_LABELS_EN;

    const DAY_NAMES = lang === 'zh'
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
      ...events.map((e: any) => ({
        title: e.title,
        start: e.start_time,
        end: e.end_time,
        calendar_name: e.calendar_name,
        location: e.location,
        description: e.description,
        type: 'event' as const,
      })),
      ...todos.map((t: any) => ({
        title: (lang === 'zh' ? '[待办] ' : '[Todo] ') + t.title,
        start: t.scheduled_start,
        end: t.scheduled_end,
        calendar_name: lang === 'zh' ? '待办' : 'Todo',
        location: null,
        description: t.description,
        type: 'todo' as const,
        priority: t.priority,
      })),
    ];

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

    const maxRows = Math.max(1, ...columns.map(c => c.length));
    const headerStyle: XLSX.CellStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1890FF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
    const titleStyle: XLSX.CellStyle = {
      font: { sz: 16, bold: true },
      alignment: { horizontal: 'center' },
    };

    const weekTitle = lang === 'zh'
      ? `本周日历 (${fmt(weekStart)} ~ ${fmt(new Date(weekEnd.getTime() - 86400000))})`
      : `Weekly Calendar (${fmt(weekStart)} ~ ${fmt(new Date(weekEnd.getTime() - 86400000))})`;
    const weekData: any[][] = [
      [weekTitle, '', '', '', '', '', ''],
      [],
      DAY_NAMES,
    ];
    for (let r = 0; r < maxRows; r++) {
      weekData.push(columns.map(c => c[r] || ''));
    }

    const weekSheet = XLSX.utils.aoa_to_sheet(weekData);
    // Merge title row A1:G1
    weekSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
    // Title cell style
    const titleCell = weekSheet['A1'];
    if (titleCell) titleCell.s = titleStyle;
    // Header row style (row index 2)
    for (let c = 0; c < 7; c++) {
      const cell = weekSheet[XLSX.utils.encode_cell({ r: 2, c })];
      if (cell) cell.s = headerStyle;
    }
    // Column widths
    weekSheet['!cols'] = DAY_NAMES.map((name, i) => {
      let maxLen = name.length;
      columns[i].forEach(s => { if (s.length > maxLen) maxLen = s.length; });
      return { wch: Math.max(18, Math.min(Math.ceil(maxLen * 1.8), 50)) };
    });

    // --- Sheet 2: 事件明细 ---
    const LIST_HEADERS = lang === 'zh'
      ? ['类型', '标题', '开始时间', '结束时间', '所属日历', '地点', '优先级', '描述']
      : ['Type', 'Title', 'Start', 'End', 'Calendar', 'Location', 'Priority', 'Description'];
    const listData: any[][] = [LIST_HEADERS];
    for (const item of items) {
      listData.push([
        item.type === 'todo' ? (lang === 'zh' ? '待办' : 'Todo') : (lang === 'zh' ? '事件' : 'Event'),
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
    // List header style (row 0)
    for (let c = 0; c < 8; c++) {
      const cell = listSheet[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = headerStyle;
    }
    listSheet['!cols'] = [
      { wch: 8 }, { wch: 30 }, { wch: 20 }, { wch: 20 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 30 },
    ];

    // --- Build workbook and send ---
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, weekSheet, lang === 'zh' ? '本周日历' : 'Weekly Calendar');
    XLSX.utils.book_append_sheet(workbook, listSheet, lang === 'zh' ? '事件明细' : 'Event Details');

    const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="calendar-week-${fmt(weekStart)}.xlsx"`);
    res.send(buf);
  } catch (error: any) {
    res.status(500).json({ error: error.message || '导出失败' });
  }
});

router.get('/export-ical', (req: Request, res: Response) => {
  try {
    const lang = (req.query.lang as string) || (req.headers['accept-language']?.startsWith('zh') ? 'zh' : 'en');

    const events = db.prepare(
      'SELECT e.*, c.name as calendar_name, c.color as calendar_color FROM events e JOIN calendars c ON e.calendar_id = c.id ORDER BY e.start_time'
    ).all() as any[];

    const todos = db.prepare(
      "SELECT * FROM todos WHERE status = 'scheduled' AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL ORDER BY scheduled_start"
    ).all() as any[];

    const TODO_PREFIX = lang === 'zh' ? '[待办] ' : '[Todo] ';

    function escapeIcal(text: string): string {
      return text.replace(/[\\;,\n]/g, (match) => {
        if (match === '\n') return '\\n';
        return '\\' + match;
      });
    }

    function dateToIcal(dt: Date): string {
      return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }

    let ics = 'BEGIN:VCALENDAR\r\n';
    ics += 'VERSION:2.0\r\n';
    ics += 'PRODID:-//Smart Calendar//EN\r\n';
    ics += 'CALSCALE:GREGORIAN\r\n';
    ics += 'METHOD:PUBLISH\r\n';

    for (const ev of events) {
      const uid = ev.uid || `event-${ev.id}@smart-calendar`;
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:${uid}\r\n`;
      ics += `DTSTART:${dateToIcal(new Date(ev.start_time))}\r\n`;
      ics += `DTEND:${dateToIcal(new Date(ev.end_time))}\r\n`;
      ics += `SUMMARY:${escapeIcal(ev.title)}\r\n`;
      if (ev.description) ics += `DESCRIPTION:${escapeIcal(ev.description)}\r\n`;
      if (ev.location) ics += `LOCATION:${escapeIcal(ev.location)}\r\n`;
      if (ev.rrule) ics += `RRULE:${ev.rrule}\r\n`;
      ics += 'END:VEVENT\r\n';
    }

    for (const todo of todos) {
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:todo-${todo.id}@smart-calendar\r\n`;
      ics += `DTSTART:${dateToIcal(new Date(todo.scheduled_start))}\r\n`;
      ics += `DTEND:${dateToIcal(new Date(todo.scheduled_end))}\r\n`;
      ics += `SUMMARY:${escapeIcal(TODO_PREFIX + todo.title)}\r\n`;
      if (todo.description) ics += `DESCRIPTION:${escapeIcal(todo.description)}\r\n`;
      ics += 'END:VEVENT\r\n';
    }

    ics += 'END:VCALENDAR\r\n';

    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const filename = `calendar-${fmt(new Date())}.ics`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(ics);
  } catch (error: any) {
    res.status(500).json({ error: error.message || '导出失败' });
  }
});

export default router;
