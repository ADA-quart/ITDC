import { Router, Request, Response } from 'express';
import db from '../db/index.js';

const router = Router();

// 获取待办列表
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

// 创建待办
router.post('/', (req: Request, res: Response) => {
  const { title, description, estimated_minutes, urgency, importance, deadline } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: '待办标题不能为空' });
  }
  if (!estimated_minutes || estimated_minutes < 1) {
    return res.status(400).json({ error: '预计时长必须大于0' });
  }

  const u = urgency || 2;
  const i = importance || 2;
  let priority = 'normal';
  if (u >= 3 && i >= 3) priority = 'urgent-important';
  else if (i >= 3) priority = 'important';
  else if (u >= 3) priority = 'urgent';

  const result = db.prepare(
    'INSERT INTO todos (title, description, estimated_minutes, priority, urgency, importance, deadline) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(title, description || null, estimated_minutes, priority, u, i, deadline || null);

  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
  res.json(todo);
});

// 更新待办
router.put('/:id', (req: Request, res: Response) => {
  const { title, description, estimated_minutes, urgency, importance, deadline, status, scheduled_start, scheduled_end } = req.body;

  const fields: string[] = [];
  const values: any[] = [];

  if (title !== undefined) { fields.push('title = ?'); values.push(title); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (estimated_minutes !== undefined) { fields.push('estimated_minutes = ?'); values.push(estimated_minutes); }
  if (urgency !== undefined) { fields.push('urgency = ?'); values.push(urgency); }
  if (importance !== undefined) { fields.push('importance = ?'); values.push(importance); }
  if (deadline !== undefined) { fields.push('deadline = ?'); values.push(deadline); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (scheduled_start !== undefined) { fields.push('scheduled_start = ?'); values.push(scheduled_start); }
  if (scheduled_end !== undefined) { fields.push('scheduled_end = ?'); values.push(scheduled_end); }

  // 重新计算优先级
  if (urgency !== undefined || importance !== undefined) {
    const current = db.prepare('SELECT urgency, importance FROM todos WHERE id = ?').get(req.params.id) as any;
    const u = urgency !== undefined ? urgency : current.urgency;
    const i = importance !== undefined ? importance : current.importance;
    let priority = 'normal';
    if (u >= 3 && i >= 3) priority = 'urgent-important';
    else if (i >= 3) priority = 'important';
    else if (u >= 3) priority = 'urgent';
    fields.push('priority = ?');
    values.push(priority);
  }

  if (fields.length === 0) return res.json({ success: true });

  values.push(req.params.id);
  db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  res.json(todo);
});

// 删除待办
router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
