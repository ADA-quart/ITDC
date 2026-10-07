/**
 * 课表视图：照课程表小程序那种「按大节排的格子」来渲染。
 *
 * 左边是节次与上下课时间，右边七列是周一到周日；
 * 课程块显示课名 + 教室，颜色沿用课程配色。数据直接复用日历事件，
 * 所以点击课程走的还是同一套详情弹窗。
 */
import React from 'react';
import dayjs, { type Dayjs } from 'dayjs';
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

  // 把事件按「星期 + 大节」放进格子：取与该节次窗口重叠最多的一节。
  // 完全不与任何节次重叠的（18:00-19:10 的空档、20:45 之后、午休等）放进「课外」兜底行，
  // 不能按"开始时间 ≥ 某节开始"归到上一节，否则 18:00 的待办会和 16:25 的课叠在同一格。
  const cells = new Map<string, GridItem[]>();
  const extraCells = new Map<string, GridItem[]>();
  for (const ev of events) {
    if (!ev?.start) continue;
    const start = dayjs(ev.start);
    const day = start.startOf('day').diff(weekStart.startOf('day'), 'day');
    // 只渲染当前这一周。事件表里保存的是整学期逐周事件，
    // 不过滤的话同一门课会从所有周次堆进同一个格子。
    if (day < 0 || day > 6) continue;
    const startMinutes = start.hour() * 60 + start.minute();
    const endMinutes = startMinutes + Math.max(1, dayjs(ev.end).diff(start, 'minute'));
    let section = -1;
    let bestOverlap = 0;
    for (let i = 0; i < TIMETABLE.length; i++) {
      const [sh, sm] = TIMETABLE[i][0].split(':').map(Number);
      const [eh, em] = TIMETABLE[i][1].split(':').map(Number);
      const overlap = Math.min(endMinutes, eh * 60 + em) - Math.max(startMinutes, sh * 60 + sm);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        section = i;
      }
    }
    const item: GridItem = {
      event: ev,
      title: String(ev.title ?? '').replace(/^\[待办\]\s*/, ''),
      room: String(ev.extendedProps?.location ?? '').split(' - ').pop() ?? '',
      color: ev.backgroundColor || '#1890ff',
      mergedCount: ((ev.extendedProps?.mergedTodos as unknown[]) ?? []).length,
      isTodo: ev.extendedProps?.type === 'todo',
    };
    const bucket = section >= 0 ? cells : extraCells;
    const key = section >= 0 ? `${day}-${section}` : String(day);
    const list = bucket.get(key) ?? [];
    list.push(item);
    bucket.set(key, list);
  }
  // 同格内按开始时间排序，避免渲染顺序随机
  for (const list of [...cells.values(), ...extraCells.values()]) {
    list.sort((a, b) => String(a.event.start).localeCompare(String(b.event.start)));
  }

  const border = `1px solid var(--itdc-border, ${isDark ? '#303030' : '#ececec'})`;
  const cellBg = `var(--itdc-cell-bg, ${isDark ? '#1b1b1b' : '#fff'})`;
  const headBg = `var(--itdc-head-bg, ${isDark ? '#232323' : '#fafafa'})`;

  const renderBlock = (item: GridItem, key: string) => (
    <button
      key={key}
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
  );

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
            <div style={{ borderBottom: border, padding: '6px 4px', fontSize: 11, color: secondaryTextColor(isDark), lineHeight: 1.35, whiteSpace: 'nowrap' }}>
              <div style={{ fontWeight: 600, color: isDark ? '#ddd' : '#333' }}>{section + 1}</div>
              <div>{start}</div>
              <div style={{ opacity: 0.7 }}>{end}</div>
            </div>
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const items = cells.get(`${dayIdx}-${section}`) ?? [];
              return (
                <div key={dayIdx} style={{ borderBottom: border, borderLeft: border, minHeight: TOUCH_TARGET + 28, padding: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {items.map((item, idx) => renderBlock(item, `${item.title}-${idx}`))}
                </div>
              );
            })}
          </React.Fragment>
        ))}

        {/* 非课节时间（课间空档、晚间等）：单独一行，避免和上一节课叠在同一格 */}
        {extraCells.size > 0 && (
          <React.Fragment>
            <div style={{ borderBottom: border, padding: '6px 4px', fontSize: 11, color: secondaryTextColor(isDark), lineHeight: 1.35, whiteSpace: 'nowrap' }}>
              <div style={{ fontWeight: 600, color: isDark ? '#ddd' : '#333' }}>{t.calendar.extraTime}</div>
            </div>
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const items = extraCells.get(String(dayIdx)) ?? [];
              return (
                <div key={`extra-${dayIdx}`} style={{ borderBottom: border, borderLeft: border, minHeight: TOUCH_TARGET + 28, padding: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {items.map((item, idx) => renderBlock(item, `extra-${item.title}-${idx}`))}
                </div>
              );
            })}
          </React.Fragment>
        )}
      </div>
    </div>
  );
};

export default TimetableGrid;
