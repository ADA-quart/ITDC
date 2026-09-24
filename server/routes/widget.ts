import { Router, Request, Response } from 'express';
import db from '../db/index.js';

const router = Router();

// 今天 [00:00, 24:00) UTC 边界 —— 与 DB 中 toISOString() 存储格式一致
function todayRange(): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.toISOString().replace('Z', ''), end.toISOString().replace('Z', '')];
}

// 小组件数据接口：今日课表（已排期 todo）+ 待办 Top5
router.get('/today', (_req: Request, res: Response) => {
  try {
    const [dayStart, dayEnd] = todayRange();

    const schedule = db.prepare(
      `SELECT id, title, color, urgency, importance, scheduled_start, scheduled_end
       FROM todos
       WHERE status = 'scheduled' AND scheduled_start IS NOT NULL
         AND scheduled_end > ? AND scheduled_start < ?
       ORDER BY scheduled_start ASC`
    ).all(dayStart, dayEnd);

    const todos = db.prepare(
      `SELECT id, title, urgency, importance, deadline
       FROM todos
       WHERE status != 'completed' AND completed_at IS NULL
       ORDER BY (urgency * 10 + importance) DESC, COALESCE(deadline, '9999-12-31') ASC
       LIMIT 5`
    ).all();

    const fmt = (iso: string | null): string => {
      if (!iso) return '';
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    res.json({
      schedule: schedule.map((s: any) => ({
        id: s.id, title: s.title, color: s.color || '',
        start: fmt(s.scheduled_start), end: fmt(s.scheduled_end),
      })),
      todos: todos.map((t: any) => ({
        id: t.id, title: t.title,
        urgency: t.urgency, importance: t.importance,
        deadline: t.deadline ? new Date(t.deadline).toDateString() : '',
      })),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

export default router;