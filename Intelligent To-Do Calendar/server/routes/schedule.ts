import { Router, Request, Response } from 'express';
import db from '../db/index.js';
import { generateSchedule, ScheduledItem } from '../services/scheduler.js';
import { generateLLMSchedule, getProviderForConfig, DEFAULT_SYSTEM_PROMPT } from '../services/llm-scheduler.js';
import { encrypt } from '../utils/crypto.js';
import { debug } from '../utils/debug.js';

const router = Router();

const VALID_PROVIDERS = ['openai', 'deepseek', 'ollama', 'lmstudio', 'custom'];

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;
    debug.info('Schedule generate', { mode });

    if (mode === 'llm') {
      const result = await generateLLMSchedule();
      debug.info('Schedule generated (LLM)', { count: result.schedule.length, valid: result.validation.valid });
      res.json({ mode: 'llm', ...result });
    } else {
      const schedule = generateSchedule();
      debug.info('Schedule generated (algorithm)', { count: schedule.length });
      res.json({ mode: 'algorithm', schedule, validation: { valid: true, errors: [] } });
    }
  } catch (error: any) {
    debug.error('Schedule generate failed', error.message);
    res.status(500).json({ error: error.message || '生成调度方案失败' });
  }
});

router.post('/apply', (req: Request, res: Response) => {
  try {
    const { schedule } = req.body as { schedule: ScheduledItem[] };
    debug.info('Schedule apply', { count: schedule.length });

    const groups = new Map<number, ScheduledItem[]>();
    for (const item of schedule) {
      if (!groups.has(item.todo_id)) {
        groups.set(item.todo_id, []);
      }
      groups.get(item.todo_id)!.push(item);
    }

    db.transaction(() => {
      for (const [todoId, items] of groups) {
        if (items.length === 1) {
          const item = items[0];
          db.prepare(
            "UPDATE todos SET status = 'scheduled', scheduled_start = ?, scheduled_end = ? WHERE id = ?"
          ).run(item.start, item.end, item.todo_id);
        } else {
          const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
          const originalTodo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as any;
          if (!originalTodo) continue;

          db.prepare(
            "UPDATE todos SET status = 'scheduled', scheduled_start = ?, scheduled_end = ? WHERE id = ?"
          ).run(sorted[0].start, sorted[0].end, todoId);

          for (let i = 1; i < sorted.length; i++) {
            const segStart = new Date(sorted[i].start);
            const segEnd = new Date(sorted[i].end);
            const segMinutes = Math.round((segEnd.getTime() - segStart.getTime()) / 60000);
            const segTitle = `${originalTodo.title} (${i + 1}/${sorted.length})`;

            db.prepare(
              `INSERT INTO todos (title, description, estimated_minutes, priority, urgency, importance, deadline, status, scheduled_start, scheduled_end, color)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`
            ).run(
              segTitle,
              originalTodo.description,
              segMinutes,
              originalTodo.priority,
              originalTodo.urgency,
              originalTodo.importance,
              originalTodo.deadline,
              sorted[i].start,
              sorted[i].end,
              originalTodo.color
            );
          }
        }
      }
    });

    db.save();
    res.json({ success: true, applied_count: schedule.length });
  } catch (error: any) {
    debug.error('Schedule apply failed', error.message);
    res.status(500).json({ error: error.message || '应用调度方案失败' });
  }
});

router.get('/llm-config', (_req: Request, res: Response) => {
  const configs = db.prepare('SELECT id, provider, base_url, model, is_active, created_at FROM llm_config ORDER BY created_at DESC').all();
  res.json(configs);
});

router.post('/llm-config', (req: Request, res: Response) => {
  const { provider, api_key, base_url, model } = req.body;

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: '不支持的 LLM 服务商' });
  }

  if (provider === 'custom' && !base_url) {
    return res.status(400).json({ error: '自定义提供商必须指定 API 地址' });
  }

  debug.info('LLM config add', { provider, base_url, model });

  const encryptedKey = api_key ? encrypt(api_key) : null;

  const result = db.prepare(
    'INSERT INTO llm_config (provider, api_key, base_url, model) VALUES (?, ?, ?, ?)'
  ).run(provider, encryptedKey, base_url || null, model || null);

  res.json({ id: result.lastInsertRowid, provider });
});

router.put('/llm-config/:id/activate', (req: Request, res: Response) => {
  debug.info('LLM config activate', { id: req.params.id });
  db.transaction(() => {
    db.prepare('UPDATE llm_config SET is_active = 0').run();
    db.prepare('UPDATE llm_config SET is_active = 1 WHERE id = ?').run(req.params.id);
  });
  db.save();
  res.json({ success: true });
});

router.delete('/llm-config/:id', (req: Request, res: Response) => {
  debug.info('LLM config delete', { id: req.params.id });
  db.prepare('DELETE FROM llm_config WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/llm-config/test', async (req: Request, res: Response) => {
  try {
    const { id, provider, api_key, base_url, model } = req.body;

    debug.info('LLM config test', { id, provider, base_url, model });

    let config: any;
    if (id) {
      config = db.prepare('SELECT * FROM llm_config WHERE id = ?').get(id);
      if (!config) {
        return res.status(404).json({ error: '配置不存在' });
      }
    } else {
      if (!provider || !VALID_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: '不支持的 LLM 服务商' });
      }
      config = {
        provider,
        api_key: api_key || null,
        base_url: base_url || null,
        model: model || null,
      };
    }

    const providerInstance = getProviderForConfig(config);
    if (!providerInstance) {
      return res.status(400).json({ error: '无法创建 LLM Provider' });
    }

    const result = await providerInstance.testConnection();
    debug.info('LLM test result', { success: result.success, message: result.message });
    res.json(result);
  } catch (error: any) {
    debug.error('LLM test failed', error.message);
    res.status(500).json({ success: false, message: error.message || '测试失败' });
  }
});

router.get('/prompt-template', (_req: Request, res: Response) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'llm_prompt_template'").get() as { value: string } | undefined;
  res.json({ template: row?.value || '', defaultTemplate: DEFAULT_SYSTEM_PROMPT });
});

router.put('/prompt-template', (req: Request, res: Response) => {
  const { template } = req.body;
  if (typeof template !== 'string') {
    return res.status(400).json({ error: '模板内容必须是字符串' });
  }
  debug.info('Prompt template updated', { length: template.length });
  const existing = db.prepare("SELECT id FROM settings WHERE key = 'llm_prompt_template'").get();
  if (existing) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'llm_prompt_template'").run(template);
  } else {
    db.prepare("INSERT INTO settings (key, value) VALUES ('llm_prompt_template', ?)").run(template);
  }
  res.json({ success: true });
});

router.post('/prompt-template/reset', (_req: Request, res: Response) => {
  debug.info('Prompt template reset');
  db.prepare("DELETE FROM settings WHERE key = 'llm_prompt_template'").run();
  res.json({ success: true, defaultTemplate: DEFAULT_SYSTEM_PROMPT });
});

router.get('/debug-log', (req: Request, res: Response) => {
  // Debug log 仅限本地访问，防止局域网泄露
  const remoteIp = req.ip || req.socket.remoteAddress || '';
  if (!['::1', '::ffff:127.0.0.1', '127.0.0.1', 'localhost'].includes(remoteIp.replace('::ffff:', ''))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({ log: debug.getLog() });
});

router.delete('/debug-log', (req: Request, res: Response) => {
  const remoteIp = req.ip || req.socket.remoteAddress || '';
  if (!['::1', '::ffff:127.0.0.1', '127.0.0.1', 'localhost'].includes(remoteIp.replace('::ffff:', ''))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  debug.clear();
  res.json({ success: true });
});

export default router;
