/**
 * 课表视图：照课程表小程序那种「按大节排的格子」来渲染。
 *
 * 左边是节次与上下课时间，右边七列是周一到周日，中间插一道「午休」；
 * 课程块显示课名 + 教室，颜色沿用课程配色。数据直接复用日历事件，
 * 所以点击课程走的还是同一套详情弹窗。
 */
import React from 'react';
import type { Dayjs } from 'dayjs';
import { TIMETABLE } from '../../shared/cdut-parser';
import { useI18n } from '../i18n';
import { secondaryTextColor, TOUCH_TARGET } from './ui';

interface Props {
  /** 该周周一 */
  weekStart: Dayjs;
  /** FullCalendar 形状的事件（含 extendedProps） */
  events: any[];
  isDark: boolean;
  onSelectEvent: (event: any) => void;
}

interface GridItem {
  event: any;
  title: string;
  room: string;
  color: string;
  /** 融合进这节课的待办数量 */
  mergedCount: number;
  /** 这一格本身就是一条待办（而不是课程） */
  isTodo: boolean;
}

const TimetableGrid: React.FC<Props> = ({ weekStart, events, isDark, onSelectEvent }) => {
  const { t } = useI18n();

  // 把事件按「星期 + 大节」放进格子：大节用开始时间落在哪一段来判断，
  // 与导入时的 TIMETABLE 完全一致，避免两边对不上
  const cells = new Map<string, GridItem[]>();
  for (const ev of events) {
    if (!ev?.start) continue;
    const start = new Date(ev.start);
    const minutes = start.getHours() * 60 + start.getMinutes();
    let section = -1;
    for (let i = 0; i < TIMETABLE.length; i++) {
      const [h, m] = TIMETABLE[i][0].split(':').map(Number);
      if (minutes >= h * 60 + m) section = i;
    }
    if (section < 0) continue;
    const day = (start.getDay() + 6) % 7; // 0=周一
    const key = `${day}-${section}`;
    const list = cells.get(key) ?? [];
    list.push({
      event: ev,
      title: String(ev.title ?? '').replace(/^\[待办\]\s*/, ''),
      room: String(ev.extendedProps?.location ?? '').split(' - ').pop() ?? '',
      color: ev.backgroundColor || '#1890ff',
      mergedCount: ((ev.extendedProps?.mergedTodos as unknown[]) ?? []).length,
      isTodo: ev.extendedProps?.type === 'todo',
    });
    cells.set(key, list);
  }

  const border = `1px solid ${isDark ? '#303030' : '#ececec'}`;
  const cellBg = isDark ? '#1b1b1b' : '#fff';
  const headBg = isDark ? '#232323' : '#fafafa';

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, minmax(46px, 1fr))', border, borderRadius: 10, overflow: 'hidden', background: cellBg }}>
        {/* 表头：周几 + 日期 */}
        <div style={{ background: headBg, borderBottom: border }} />
        {Array.from({ length: 7 }, (_, i) => {
          const day = weekStart.add(i, 'day');
          const isToday = day.isSame(new Date(), 'day');
          return (
            <div key={i} style={{ background: headBg, borderBottom: border, borderLeft: border, padding: '6px 2px', textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: isToday ? '#1677ff' : (isDark ? '#ddd' : '#333') }}>
                {day.format('ddd')}
              </div>
              <div style={{ fontSize: 11, color: isToday ? '#1677ff' : secondaryTextColor(isDark) }}>{day.format('M.D')}</div>
            </div>
          );
        })}

        {TIMETABLE.map(([start, end], section) => (
          <React.Fragment key={section}>
            {/* 午休：插在第 3 大节之前（前两节是上午） */}
            {section === 2 && (
              <>
                <div style={{ gridColumn: '1 / -1', background: isDark ? '#242424' : '#f5f5f5', borderBottom: border, padding: '3px 8px', fontSize: 11, color: secondaryTextColor(isDark), textAlign: 'center' }}>
                  {t.calendar.lunchBreak}
                </div>
              </>
            )}
            <div style={{ borderBottom: border, padding: '6px 4px', fontSize: 11, color: secondaryTextColor(isDark), lineHeight: 1.35, whiteSpace: 'nowrap' }}>
              <div style={{ fontWeight: 600, color: isDark ? '#ddd' : '#333' }}>{section + 1}</div>
              <div>{start}</div>
              <div style={{ opacity: 0.7 }}>{end}</div>
            </div>
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const items = cells.get(`${dayIdx}-${section}`) ?? [];
              return (
                <div key={dayIdx} style={{ borderBottom: border, borderLeft: border, minHeight: TOUCH_TARGET + 28, padding: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {items.map((item, idx) => (
                    <button
                      key={`${item.title}-${idx}`}
                      type="button"
                      onClick={() => onSelectEvent(item.event)}
                      style={{
                        flex: 1,
                        minHeight: 42,
                        // 待办用虚线边框区分（和日历视图一致）
                        border: item.isTodo ? '1px dashed rgba(255,255,255,.85)' : 'none',
                        borderRadius: 6,
                        background: item.color,
                        color: '#fff',
                        padding: '4px 3px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 2, minWidth: 0 }}>
                        <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, wordBreak: 'break-word' }}>
                          {item.title}
                        </span>
                        {item.mergedCount > 0 && (
                          <span style={{
                            flexShrink: 0,
                            padding: '0 3px',
                            borderRadius: 6,
                            background: 'rgba(255,255,255,.92)',
                            color: '#333',
                            fontSize: 9,
                            lineHeight: '13px',
                          }}>
                            {item.mergedCount}
                          </span>
                        )}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                        {item.room && (
                          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 10.5, opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.room}
                          </span>
                        )}
                        {item.isTodo && <span style={{ fontSize: 9.5, opacity: 0.92 }}>{t.calendar.todoTag}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default TimetableGrid;
