import { Router, Request, Response } from 'express';
import db from '../db/index.js';
import { debug } from '../utils/debug.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { status, priority } = req.query;
  let sql = 'SELECT * FROM todos WHERE 1=1';
  const params: any[] = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (priority) {
    sql += ' AND priority = ?';
    params.push(priority);
  }

  sql += " ORDER BY CASE priority WHEN 'urgent-important' THEN 1 WHEN 'important' THEN 2 WHEN 'urgent' THEN 3 WHEN 'normal' THEN 4 END, CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, created_at DESC";

  const todos = db.prepare(sql).all(...params);
  res.json(todos);
});

router.post('/', (req: Request, res: Response) => {
  const { title, description, estimated_minutes, urgency, importance, deadline, color } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: '待办标题不能为空' });
  }
  if (!estimated_minutes || estimated_minutes < 1) {
    return res.status(400).json({ error: '预计时长必须大于0' });
  }

  const u = Math.max(1, Math.min(4, Math.round(urgency || 2)));
  const i = Math.max(1, Math.min(4, Math.round(importance || 2)));
  let priority = 'normal';
  if (u >= 3 && i >= 3) priority = 'urgent-important';
  else if (i >= 3) priority = 'important';
  else if (u >= 3) priority = 'urgent';

  debug.info('Todo create', { title, estimated_minutes, priority });

  const result = db.prepare(
    'INSERT INTO todos (title, description, estimated_minutes, priority, urgency, importance, deadline, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(title, description || null, estimated_minutes, priority, u, i, deadline || null, color || null);

  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
  res.json(todo);
});

router.put('/:id', (req: Request, res: Response) => {
  const { title, description, estimated_minutes, urgency, importance, deadline, status, scheduled_start, scheduled_end, color } = req.body;

  const fields: string[] = [];
  const values: any[] = [];

  if (title !== undefined) { fields.push('title = ?'); values.push(title); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (estimated_minutes !== undefined) { fields.push('estimated_minutes = ?'); values.push(estimated_minutes); }
  if (urgency !== undefined) {
    const val = Math.max(1, Math.min(4, Math.round(urgency)));
    fields.push('urgency = ?'); values.push(val);
  }
  if (importance !== undefined) {
    const val = Math.max(1, Math.min(4, Math.round(importance)));
    fields.push('importance = ?'); values.push(val);
  }
  if (deadline !== undefined) { fields.push('deadline = ?'); values.push(deadline); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (scheduled_start !== undefined) { fields.push('scheduled_start = ?'); values.push(scheduled_start); }
  if (scheduled_end !== undefined) { fields.push('scheduled_end = ?'); values.push(scheduled_end); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color); }

  if (urgency !== undefined || importance !== undefined) {
    const current = db.prepare('SELECT urgency, importance FROM todos WHERE id = ?').get(req.params.id) as any;
    const u = urgency !== undefined ? Math.max(1, Math.min(4, Math.round(urgency))) : current.urgency;
    const i = importance !== undefined ? Math.max(1, Math.min(4, Math.round(importance))) : current.importance;
    let priority = 'normal';
    if (u >= 3 && i >= 3) priority = 'urgent-important';
    else if (i >= 3) priority = 'important';
    else if (u >= 3) priority = 'urgent';
    fields.push('priority = ?');
    values.push(priority);
  }

  if (fields.length === 0) return res.json({ success: true });

  debug.info('Todo update', { id: req.params.id, fields: fields.map(f => f.split('=')[0].trim()) });
  values.push(req.params.id);
  db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  res.json(todo);
});

router.delete('/:id', (req: Request, res: Response) => {
  debug.info('Todo delete', { id: req.params.id });
  db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/:id/split', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { segments } = req.body as { segments: { start: string; end: string }[] };

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: '必须提供至少一个时间段' });
    }

    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as any;
    if (!todo) {
      return res.status(404).json({ error: '待办不存在' });
    }

    debug.info('Todo split', { id, segments: segments.length });

    db.transaction(() => {
      db.prepare(
        "UPDATE todos SET status = 'scheduled', scheduled_start = ?, scheduled_end = ?, color = ? WHERE id = ?"
      ).run(segments[0].start, segments[segments.length - 1].end, todo.color || null, id);

      const firstStart = new Date(segments[0].start);
      const lastEnd = new Date(segments[segments.length - 1].end);
      const totalMinutes = Math.round((lastEnd.getTime() - firstStart.getTime()) / 60000);

      for (let i = 1; i < segments.length; i++) {
        db.prepare(
          'INSERT INTO todos (title, description, estimated_minutes, priority, urgency, importance, deadline, status, scheduled_start, scheduled_end, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          `${todo.title} (${i + 1}/${segments.length})`,
          todo.description,
          Math.round((new Date(segments[i].end).getTime() - new Date(segments[i].start).getTime()) / 60000),
          todo.priority,
          todo.urgency,
          todo.importance,
          todo.deadline,
          'scheduled',
          segments[i].start,
          segments[i].end,
          todo.color || null,
        );
      }
    });

    const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    res.json(updated);
  } catch (error: any) {
    debug.error('Todo split failed', error.message);
    res.status(500).json({ error: error.message || '拆分失败' });
  }
});

export default router;
