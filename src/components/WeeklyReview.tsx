import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import { todoApi, calendarApi } from '../api/client';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { cardStyle, secondaryTextColor } from './ui';
import { computeWeeklyStats, type WeeklyStats } from '../utils/weekly-stats';

/** 大数字卡片 */
const StatCard: React.FC<{ label: string; value: string; unit: string; sub?: string; isDark: boolean; accent?: string }> = ({
  label,
  value,
  unit,
  sub,
  isDark,
  accent,
}) => (
  <div
    style={{
      padding: '12px 14px',
      borderRadius: 12,
      background: `var(--itdc-cell-bg, ${isDark ? '#1b1b1b' : '#fff'})`,
      border: `1px solid ${isDark ? '#333' : '#f0f0f0'}`,
    }}
  >
    <div style={{ fontSize: 12, color: isDark ? '#999' : '#888', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.1, color: accent }}>
      {value}
      <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, color: isDark ? '#999' : '#888' }}>{unit}</span>
    </div>
    {sub && <div style={{ fontSize: 11, marginTop: 2, color: isDark ? '#999' : '#888' }}>{sub}</div>}
  </div>
);

const WeeklyReview: React.FC = () => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const [stats, setStats] = useState<WeeklyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      Promise.all([todoApi.getAll(), calendarApi.getEvents()])
        .then(([todos, events]) => {
          if (alive) setStats(computeWeeklyStats(todos, events));
        })
        .catch(() => {
          if (alive) setStats(computeWeeklyStats([], []));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    refresh();
    const handler = () => refresh();
    window.addEventListener('todo-data-changed', handler);
    return () => {
      alive = false;
      window.removeEventListener('todo-data-changed', handler);
    };
  }, []);

  // 随机调性：每次进入「本周」随机挑一条（池子在 i18n 里）
  const tone = useMemo(() => {
    const pool = t.review.weekTonePool;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [t]);

  if (loading || !stats) return <Spin />;

  const hours = Math.round((stats.lessons.minutes / 60) * 10) / 10;
  const doneHours = Math.round((stats.doneMinutes / 60) * 10) / 10;
  const maxDay = Math.max(1, ...stats.perDay);
  const todayIdx = (new Date().getDay() + 6) % 7;

  return (
    <div style={cardStyle(isDark, isMobile)}>
      <h3 style={{ marginTop: 0, marginBottom: 6 }}>{t.review.weekTitle}</h3>
      <p style={{ fontSize: 14, marginBottom: 16, color: isDark ? '#ddd' : '#333' }}>{tone}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        <StatCard
          label={t.review.weekLessons}
          value={String(stats.lessons.count)}
          unit={t.review.weekLessonsUnit}
          sub={hours > 0 ? `${hours} ${t.review.weekHoursUnit}` : undefined}
          isDark={isDark}
          accent="#1677ff"
        />
        <StatCard
          label={t.review.weekDone}
          value={String(stats.done)}
          unit={t.review.weekDoneUnit}
          sub={doneHours > 0 ? `≈ ${doneHours} ${t.review.weekHoursUnit}` : undefined}
          isDark={isDark}
          accent="#52c41a"
        />
        <StatCard label={t.review.weekImportant} value={String(stats.doneImportant)} unit={t.review.weekDoneUnit} isDark={isDark} accent="#f5222d" />
        <StatCard label={t.review.weekStreak} value={String(stats.streakWeeks)} unit={t.review.weekStreakUnit} isDark={isDark} accent="#faad14" />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: secondaryTextColor(isDark), marginBottom: 10 }}>{t.review.weekTrend}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 116 }}>
          {stats.perDay.map((n, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 11, color: secondaryTextColor(isDark), height: 14 }}>{n > 0 ? n : ''}</div>
              <div
                style={{
                  width: 18,
                  height: 84,
                  borderRadius: 9,
                  background: `var(--itdc-head-bg, ${isDark ? '#232323' : '#fafafa'})`,
                  display: 'flex',
                  alignItems: 'flex-end',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: `${Math.round((n / maxDay) * 100)}%`,
                    borderRadius: 9,
                    background: '#52c41a',
                    opacity: n > 0 ? 1 : 0,
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: i === todayIdx ? '#1677ff' : secondaryTextColor(isDark),
                  fontWeight: i === todayIdx ? 600 : 400,
                }}
              >
                {t.review.weekDayNames[i]}
              </div>
            </div>
          ))}
        </div>
      </div>

      {stats.lastWeekDone !== null && (
        <p style={{ fontSize: 13, margin: 0, color: secondaryTextColor(isDark) }}>
          {t.review.weekCompare.replace('{last}', String(stats.lastWeekDone)).replace('{cur}', String(stats.done))}
        </p>
      )}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, color: secondaryTextColor(isDark), marginBottom: 8 }}>{t.review.weekOverdue}</div>
        {stats.overdueThisWeek.length === 0 ? (
          <p style={{ fontSize: 13, margin: 0, color: '#52c41a' }}>{t.review.weekNoOverdue}</p>
        ) : (
          <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
            {stats.overdueThisWeek.map((td) => (
              <li
                key={td.id}
                style={{
                  padding: '6px 8px',
                  marginBottom: 4,
                  borderRadius: 6,
                  background: isDark ? '#2a2a2a' : '#fff5f5',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{td.title}</span>
                <Tag color="error" style={{ fontSize: 10, marginInlineEnd: 0, flexShrink: 0 }}>
                  {dayjs(td.deadline).format('MM-DD HH:mm')}
                </Tag>
              </li>
            ))}
          </ul>
        )}
        {stats.caughtUpThisWeek > 0 && (
          <p style={{ fontSize: 12, margin: '6px 0 0', color: '#52c41a' }}>
            {t.review.weekCaughtUp.replace('{n}', String(stats.caughtUpThisWeek))}
          </p>
        )}
      </div>
    </div>
  );
};

export default WeeklyReview;
