import { Router, Request, Response } from 'express';
import db from '../db/index.js';
import { debug } from '../utils/debug.js';

const router = Router();

/**
 * 合并同步。
 *
 * 与"以某一端为准"不同，这里把两端数据按 uid 合并：
 *   - 只有一端有      → 保留（补到另一端）
 *   - 两端都有        → 比较 updated_at，新的赢
 *   - 任一端显式删除  → 记墓碑，两端一起删（否则会被另一端再带回来）
 *
 * uid 是客户端生成的稳定标识。必须用它而不是自增 id：
 * 本机 id 是时间戳派生的大数字、服务端从 1 开始，按 id 对齐会张冠李戴。
 */

interface MergeStats {
  added: number;
  updated: number;
}

function ts(v: unknown): number {
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? 0 : t;
}

/** 把另一端报告的删除落到本端，并记入墓碑供其它设备下次取用 */
function applyTombstones(table: string, uids: string[]): number {
  let removed = 0;
  for (const uid of uids) {
    if (!uid) continue;
    const existing = db.prepare('SELECT id FROM ' + table + ' WHERE sync_uid = ?').get(uid) as { id: number } | undefined;
    if (existing) {
      db.prepare('DELETE FROM ' + table + ' WHERE sync_uid = ?').run(uid);
      removed++;
    }
    db.prepare(
      'INSERT OR REPLACE INTO sync_tombstone (uid, table_name, deleted_at) VALUES (?, ?, ?)'
    ).run(uid, table, new Date().toISOString());
  }
  return removed;
}

/** 按 uid 合并一张表；columns 是要同步的业务列（不含 id / uid） */
function mergeRows(table: string, incoming: any[], columns: string[]): MergeStats {
  const stats: MergeStats = { added: 0, updated: 0 };

  for (const row of incoming) {
    // 客户端传 sync_uid（与 events 表原有的 iCal uid 区分开）
    const uid = row?.sync_uid;
    if (!uid) continue;

    const existing = db.prepare('SELECT * FROM ' + table + ' WHERE sync_uid = ?').get(uid) as any;
    const values = columns.map((c) => (row[c] === undefined ? null : row[c]));
    const stamp = row.updated_at || new Date().toISOString();

    if (!existing) {
      const cols = ['sync_uid', ...columns, 'updated_at'];
      const vals = [uid, ...values, stamp];
      db.prepare(
        'INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')'
      ).run(...vals);
      stats.added++;
      continue;
    }

    // 两端都有：新的赢。缺失时间戳视为很旧，避免覆盖有明确时间的一端
    if (ts(stamp) > ts(existing.updated_at)) {
      const sets = [...columns.map((c) => c + ' = ?'), 'updated_at = ?'];
      db.prepare('UPDATE ' + table + ' SET ' + sets.join(',') + ' WHERE sync_uid = ?')
        .run(...values, stamp, uid);
      stats.updated++;
    }
  }

  return stats;
}

const TODO_COLS = [
  'title', 'description', 'estimated_minutes', 'priority', 'urgency', 'importance',
  'can_do_in_class', 'deadline', 'status', 'scheduled_start', 'scheduled_end', 'color', 'completed_at', 'created_at',
];
const CALENDAR_COLS = ['name', 'color', 'source', 'created_at'];
const EVENT_COLS = [
  'calendar_id', 'title', 'description', 'start_time', 'end_time', 'rrule',
  'location', 'source', 'uid', 'created_at',
];

router.post('/merge', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const inTodos: any[] = Array.isArray(body.todos) ? body.todos : [];
    const inCalendars: any[] = Array.isArray(body.calendars) ? body.calendars : [];
    const inEvents: any[] = Array.isArray(body.events) ? body.events : [];
    const deleted = body.deleted || {};

    const stats = { added: 0, updated: 0, removed: 0 };

    const result = db.transaction(() => {
      // 删墓碑优先：即使本端存在也要删掉
      stats.removed += applyTombstones('events', deleted.events || []);
      stats.removed += applyTombstones('todos', deleted.todos || []);
      stats.removed += applyTombstones('calendars', deleted.calendars || []);

      // 先合并日历：事件用 calendar_uid 指向它
      const calStats = mergeRows('calendars', inCalendars, CALENDAR_COLS);

      // 事件把 calendar_uid 解析成本端实际日历 id
      const eventsWithId = inEvents.map((e) => {
        if (!e || !e.calendar_uid) return e;
        const cal = db.prepare('SELECT id FROM calendars WHERE sync_uid = ?').get(e.calendar_uid) as { id: number } | undefined;
        return cal ? { ...e, calendar_id: cal.id } : e;
      }).filter((e) => e && e.calendar_id != null);

      const evStats = mergeRows('events', eventsWithId, EVENT_COLS);
      const todoStats = mergeRows('todos', inTodos, TODO_COLS);

      stats.added += calStats.added + evStats.added + todoStats.added;
      stats.updated += calStats.updated + evStats.updated + todoStats.updated;

      // 返回合并后的全量，客户端据此替换本地（此时已含两端所有记录）
      const todos = db.prepare('SELECT * FROM todos ORDER BY id').all();
      const calendars = db.prepare('SELECT * FROM calendars ORDER BY id').all();
      const events = db.prepare(
        'SELECT e.*, c.name as calendar_name, c.color as calendar_color, c.sync_uid as calendar_uid ' +
        'FROM events e LEFT JOIN calendars c ON e.calendar_id = c.id ORDER BY e.id'
      ).all();
      const tombstones = db.prepare('SELECT uid, table_name FROM sync_tombstone').all();

      return { todos, calendars, events, tombstones, stats };
    });

    debug.info('Sync merge', stats);
    res.json({ success: true, ...result });
  } catch (error: any) {
    debug.error('Sync merge failed', error.message);
    res.status(500).json({ error: error.message || '合并同步失败' });
  }
});

export default router;
