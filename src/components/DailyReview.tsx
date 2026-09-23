import React, { useEffect, useState } from 'react';
import { Spin, Empty, Progress, Tag } from 'antd';
import { todoApi } from '../api/client';
import type { Todo, Priority } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dayKeyOf(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return dayKey(d);
}

const PRIORITY_ORDER: Priority[] = ['urgent-important', 'important', 'urgent', 'normal'];

const DailyReview: React.FC = () => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    todoApi.getAll().then(setTodos).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin />;

  const todayKey = dayKey(new Date());
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const endOfDay = new Date(midnight.getTime() + 24 * 3600_000);

  const activeTodos = todos.filter(td => td.status !== 'done');
  const overdueCount = activeTodos.filter(td => td.deadline && dayKeyOf(td.deadline) < todayKey).length;
  const dueTodayCount = activeTodos.filter(td => td.deadline && dayKeyOf(td.deadline) === todayKey).length;
  const pendingCount = activeTodos.length - overdueCount - dueTodayCount;
  const doneCount = todos.length - activeTodos.length;

  const byPriority: Record<Priority, number> = { 'urgent-important': 0, important: 0, urgent: 0, normal: 0 };
  for (const td of activeTodos) byPriority[td.priority]++;
  const totalActive = Object.values(byPriority).reduce((a, b) => a + b, 0);

  // 近 7 天趋势（含今天）：新建 vs 完成
  const trend: { dayKey: string; created: number; done: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(midnight.getTime() - i * 24 * 3600_000);
    trend.push({ dayKey: dayKey(d), created: 0, done: 0 });
  }
  for (const td of todos) {
    const ck = dayKeyOf(td.created_at);
    const row = trend.find(x => x.dayKey === ck);
    if (row) row.created++;
    const dk = dayKeyOf(td.completed_at);
    const drow = trend.find(x => x.dayKey === dk);
    if (drow) drow.done++;
  }
  const maxTrend = Math.max(1, ...trend.flatMap(x => [x.created, x.done]));

  return (
    <div style={{ background: isDark ? '#1f1f1f' : '#fff', padding: 24, borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: t.review.overdue, value: overdueCount, color: '#f5222d' },
          { label: t.review.dueToday, value: dueTodayCount, color: '#1890ff' },
          { label: t.review.pending, value: pendingCount, color: '#faad14' },
          { label: t.review.done, value: doneCount, color: '#52c41a' },
        ].map(item => (
          <div
            key={item.label}
            style={{ flex: 1, minWidth: 100, padding: '16px 8px', borderRadius: 8, border: `1px solid ${isDark ? '#333' : '#eee'}`, textAlign: 'center' }}
          >
            <div style={{ fontSize: 28, fontWeight: 'bold', color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 12, color: isDark ? '#aaa' : '#888' }}>{item.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        {PRIORITY_ORDER.map(p => (
          <div key={p} style={{ marginBottom: 8 }}>
            <Tag color={PRIORITY_COLORS[p]} style={{ marginRight: 6, fontSize: 12 }}>{PRIORITY_LABELS[p]}</Tag>
            <Progress
              percent={totalActive ? Math.round((byPriority[p] / totalActive) * 100) : 0}
              strokeColor={PRIORITY_COLORS[p]}
              showInfo={false}
              
            />
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: isDark ? '#aaa' : '#888', marginBottom: 12 }}>{t.review.trend}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 160 }}>
          {trend.map((x, idx) => (
            <div key={x.dayKey} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                <div style={{ width: 10, height: Math.round((x.created / maxTrend) * 130), backgroundColor: '#1890ff', borderRadius: 2 }} />
                <div style={{ width: 10, height: Math.round((x.done / maxTrend) * 130), backgroundColor: '#52c41a', borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 10, color: isDark ? '#666' : '#999' }}>
                {idx === trend.length - 1 ? t.review.today : x.dayKey.slice(5)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 13, color: isDark ? '#aaa' : '#888', marginBottom: 8 }}>
        {t.review.overdueList}
      </div>
      {overdueCount === 0 ? (
        <Empty style={{ minHeight: 40 }} description={t.review.noOverdue} />
      ) : (
        <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
          {activeTodos
            .filter(td => td.deadline && dayKeyOf(td.deadline) < todayKey)
            .map(td => (
              <li key={td.id} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6, background: isDark ? '#2a2a2a' : '#fff5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13 }}>{td.title}</span>
                <Tag color="error" style={{ fontSize: 10 }}>{dayKeyOf(td.deadline)}</Tag>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
};

export default DailyReview;
