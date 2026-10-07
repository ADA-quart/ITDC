import React, { useEffect, useState } from 'react';
import { Spin, Empty, Modal, Button, Tag } from 'antd';
import dayjs from 'dayjs';
import { todoApi } from '../api/client';
import type { Todo, Priority } from '../types';
import { PRIORITY_COLORS } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { cardStyle, secondaryTextColor, sectionTitleStyle, TOUCH_TARGET, TYPE } from './ui';
import { getDeadlineCountdown } from '../utils/priority';

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
  const isMobile = useIsMobile();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  // 点开的象限（二级界面）：列出该象限里还剩哪些待办
  const [quadrant, setQuadrant] = useState<Priority | null>(null);

  useEffect(() => {
    const refresh = () => todoApi.getAll().then(setTodos).catch(() => {}).finally(() => setLoading(false));
    refresh();
    const handler = () => refresh();
    window.addEventListener('todo-data-changed', handler);
    return () => window.removeEventListener('todo-data-changed', handler);
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
  const priorityLabel = (p: Priority) =>
    p === 'urgent-important' ? t.priority.urgentImportant
      : p === 'important' ? t.priority.important
        : p === 'urgent' ? t.priority.urgent
          : t.priority.normal;
  const statusLabel = (td: Todo) =>
    td.status === 'done' ? t.todo.done : td.status === 'scheduled' ? t.todo.scheduled : t.todo.pending;
  const quadrantTodos = quadrant ? activeTodos.filter((td) => td.priority === quadrant) : [];

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
    <div style={cardStyle(isDark, isMobile)}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: t.review.overdue, value: overdueCount, color: '#f5222d' },
          { label: t.review.dueToday, value: dueTodayCount, color: '#1890ff' },
          { label: t.review.pending, value: pendingCount, color: '#faad14' },
          { label: t.review.done, value: doneCount, color: '#52c41a' },
        ].map(item => (
          <div
            key={item.label}
            style={{ flex: 1, minWidth: isMobile ? '40%' : 100, padding: '16px 8px', borderRadius: 8, border: `1px solid ${isDark ? '#333' : '#eee'}`, textAlign: 'center' }}
          >
            <div style={{ fontSize: 28, fontWeight: 'bold', color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 12, color: isDark ? '#aaa' : '#888' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* 四象限：每个方框显示还剩多少待办，点进去看具体是哪些 */}
      <div style={{ marginBottom: 20 }}>
        <h4 style={sectionTitleStyle}>{t.review.quadrants}</h4>
        <div style={{ ...TYPE.caption, color: secondaryTextColor(isDark), marginBottom: 10 }}>
          {t.review.quadrantHint}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {PRIORITY_ORDER.map((p) => {
            const count = byPriority[p];
            const percent = totalActive ? Math.round((count / totalActive) * 100) : 0;
            return (
              <button
                key={p}
                type="button"
                aria-label={`${priorityLabel(p)}：${count} ${t.review.quadrantUnit}`}
                onClick={() => setQuadrant(p)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: '12px 12px 10px',
                  borderRadius: 12,
                  border: `1px solid ${isDark ? '#333' : '#eee'}`,
                  borderTop: `3px solid ${PRIORITY_COLORS[p]}`,
                  background: isDark ? '#1f1f1f' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minHeight: TOUCH_TARGET,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: PRIORITY_COLORS[p], flexShrink: 0 }} />
                  {priorityLabel(p)}
                </span>
                <span style={{
                  fontSize: 26,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: count > 0 ? PRIORITY_COLORS[p] : (isDark ? '#666' : '#bbb'),
                }}>
                  {count}
                </span>
                <span style={{ ...TYPE.label, color: secondaryTextColor(isDark) }}>{t.review.quadrantUnit}</span>
                <span style={{ display: 'block', width: '100%', height: 3, borderRadius: 2, background: isDark ? '#333' : '#f0f0f0' }}>
                  <span style={{ display: 'block', width: `${percent}%`, height: 3, borderRadius: 2, background: PRIORITY_COLORS[p] }} />
                </span>
              </button>
            );
          })}
        </div>
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
              <div style={{ fontSize: 11, color: isDark ? '#a6a6a6' : '#666' }}>
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

      {/* 二级界面：这个象限里还剩哪些待办 */}
      <Modal
        open={!!quadrant}
        title={quadrant ? priorityLabel(quadrant) : ''}
        onCancel={() => setQuadrant(null)}
        footer={[
          <Button
            key="go"
            type="primary"
            onClick={() => {
              setQuadrant(null);
              window.location.hash = 'todos';
            }}
          >
            {t.review.goTodos}
          </Button>,
        ]}
      >
        {quadrantTodos.length === 0 ? (
          <Empty description={t.review.quadrantEmpty} />
        ) : (
          <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
            {quadrantTodos.map((td) => (
              <li
                key={td.id}
                style={{
                  padding: '10px 12px',
                  marginBottom: 8,
                  borderRadius: 10,
                  background: isDark ? '#262626' : '#fafafa',
                  borderLeft: `3px solid ${PRIORITY_COLORS[td.priority]}`,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, wordBreak: 'break-word' }}>{td.title}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, ...TYPE.caption, color: secondaryTextColor(isDark) }}>
                  <span>{statusLabel(td)}</span>
                  <span>{td.estimated_minutes} {t.todo.minutes}</span>
                  {td.deadline && <span>{getDeadlineCountdown(td.deadline, t.todo)}</span>}
                  {td.scheduled_start && <span>{dayjs(td.scheduled_start).format('MM/DD HH:mm')}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
};

export default DailyReview;
