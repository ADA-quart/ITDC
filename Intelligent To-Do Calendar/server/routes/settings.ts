import { Router, Request, Response } from 'express';
import db from '../db/index.js';

const router = Router();

const VALID_KEYS = ['language', 'theme', 'llm_prompt_template'];

router.get('/:key', (req: Request, res: Response) => {
  const { key } = req.params;
  if (!VALID_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Invalid settings key' });
  }
  const row = db.prepare('SELECT key, value FROM settings WHERE key = ?').get(key) as { key: string; value: string } | undefined;
  res.json(row || { key, value: '' });
});

router.put('/:key', (req: Request, res: Response) => {
  const { key } = req.params;
  if (!VALID_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Invalid settings key' });
  }
  const { value } = req.body;

  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'Value must be a string' });
  }

  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
  res.json({ success: true });
});

export default router;
