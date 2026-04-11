import { Router, Request, Response } from 'express';
import db from '../db/index.js';
import { generateSchedule, ScheduledItem } from '../services/scheduler.js';
import { generateLLMSchedule } from '../services/llm-scheduler.js';
import { encrypt } from '../utils/crypto.js';

const router = Router();

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;

    if (mode === 'llm') {
      const result = await generateLLMSchedule();
      res.json({ mode: 'llm', ...result });
    } else {
      const schedule = generateSchedule();
      res.json({ mode: 'algorithm', schedule, validation: { valid: true, errors: [] } });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || '生成调度方案失败' });
  }
});

router.post('/apply', (req: Request, res: Response) => {
  try {
    const { schedule } = req.body as { schedule: ScheduledItem[] };

    db.transaction(() => {
      for (const item of schedule) {
        db.prepare(
          "UPDATE todos SET status = 'scheduled', scheduled_start = ?, scheduled_end = ? WHERE id = ?"
        ).run(item.start, item.end, item.todo_id);
      }
    });

    res.json({ success: true, applied_count: schedule.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || '应用调度方案失败' });
  }
});

router.get('/llm-config', (_req: Request, res: Response) => {
  // 安全注意：不要在 SELECT 中包含 api_key 列，避免密钥泄露到前端
  const configs = db.prepare('SELECT id, provider, base_url, model, is_active, created_at FROM llm_config ORDER BY created_at DESC').all();
  res.json(configs);
});

router.post('/llm-config', (req: Request, res: Response) => {
  const { provider, api_key, base_url, model } = req.body;

  if (!provider || !['openai', 'deepseek', 'ollama'].includes(provider)) {
    return res.status(400).json({ error: '不支持的 LLM 服务商' });
  }

  const encryptedKey = api_key ? encrypt(api_key) : null;

  const result = db.prepare(
    'INSERT INTO llm_config (provider, api_key, base_url, model) VALUES (?, ?, ?, ?)'
  ).run(provider, encryptedKey, base_url || null, model || null);

  res.json({ id: result.lastInsertRowid, provider });
});

router.put('/llm-config/:id/activate', (req: Request, res: Response) => {
  db.transaction(() => {
    db.prepare('UPDATE llm_config SET is_active = 0').run();
    db.prepare('UPDATE llm_config SET is_active = 1 WHERE id = ?').run(req.params.id);
  });
  res.json({ success: true });
});

router.delete('/llm-config/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM llm_config WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
