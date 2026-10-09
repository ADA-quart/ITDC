/**
 * 课表视图：照课程表小程序那种「按大节排的格子」来渲染。
 *
 * 左边是节次与上下课时间，右边七列是周一到周日；
 * 课程块显示课名 + 教室，颜色沿用课程配色。数据直接复用日历事件，
 * 所以点击课程走的还是同一套详情弹窗。
 */
import React, { useRef, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { TIMETABLE } from '../../shared/cdut-parser';
import { useI18n } from '../i18n';
import { secondaryTextColor, TOUCH_TARGET } from './ui';

/**
 * 每大节的真实时长（分钟）：95 / 95 / 60 / 95 / 95 / 95 / 40。
 * 格子行高按它取比例——中午 1 小时的节不再和 1.5 小时的节一样高。
 */
const SECTION_MINUTES = TIMETABLE.map(([start, end]) => {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(1, toMin(end) - toMin(start));
});

/** 「课外」兜底行的权重：内容不可预知（可能叠多条），取和常规节相同的高度 */
const EXTRA_ROW_MINUTES = 95;

interface Props {
  /** 该周周一 */
  weekStart: Dayjs;
  /** FullCalendar 形状的事件（含 extendedProps） */
  events: any[];
  isDark: boolean;
  onSelectEvent: (event: any) => void;
  /** 拖到别的格子：按目标格子的节次时间给出新的起止（时长保持不变） */
  onMoveEvent: (event: any, start: Date, end: Date) => void;
  /** 长按不动：请求删除（课程/日程；待办不删） */
  onDeleteEvent: (event: any) => void;
  /** 拖动开始/结束：父容器据此决定是否要把横向手势当成翻页 */
  onDragStateChange?: (dragging: boolean) => void;
  /**
   * 固定高度模式：整张表撑满父容器，七节等分高度。
   * 手机端用它可以做到「一屏就是这一周」，不会这周长那周短。
   */
  fillHeight?: boolean;
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

const TimetableGrid: React.FC<Props> = ({
  weekStart,
  events,
  isDark,
  onSelectEvent,
  onMoveEvent,
  onDeleteEvent,
  onDragStateChange,
  fillHeight = false,
}) => {
  const { t } = useI18n();
  // 拖拽 / 长按：pointer 事件在 WebView 里触摸与鼠标都走
  const drag = useRef<{
    item: GridItem | null;
    startX: number;
    startY: number;
    /** 按住够久才允许拖动；快速横滑交给父容器翻页 */
    armed: boolean;
    armTimer: number | null;
    moved: boolean;
    longPressed: boolean;
    timer: number | null;
  }>({
    item: null,
    startX: 0,
    startY: 0,
    armed: false,
    armTimer: null,
    moved: false,
    longPressed: false,
    timer: null,
  });
  // 拖过或长按过之后紧跟着的 click 要吞掉，否则会弹出详情
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string } | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  const clearLongPress = () => {
    if (drag.current.timer !== null) {
      window.clearTimeout(drag.current.timer);
      drag.current.timer = null;
    }
  };

  const clearArm = () => {
    if (drag.current.armTimer !== null) {
      window.clearTimeout(drag.current.armTimer);
      drag.current.armTimer = null;
    }
  };

  const cellUnder = (x: number, y: number): { day: number; section: number } | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-cell]') as HTMLElement | null;
    const key = el?.dataset.cell;
    if (!key) return null;
    const [day, section] = key.split('-').map(Number);
    if (Number.isNaN(day) || Number.isNaN(section)) return null;
    return { day, section };
  };

  const onBlockPointerDown = (item: GridItem) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 新手势开始，先清掉上一轮的"别弹详情"标记。
    // 不清的话：在课程块上滑了一页（浏览器不会补 click）之后，
    // 紧接着点课程会被这条残留标记吞掉，详情打不开。
    suppressClick.current = false;
    drag.current = {
      item,
      startX: e.clientX,
      startY: e.clientY,
      armed: false,
      armTimer: null,
      moved: false,
      longPressed: false,
      timer: null,
    };
    // 先按住一小会儿才进入"可拖动"状态：直接横滑是翻页手势，不该把课拖走
    if (e.pointerType !== 'mouse') {
      drag.current.armTimer = window.setTimeout(() => {
        drag.current.armTimer = null;
        drag.current.armed = true;
      }, 180);
    } else {
      drag.current.armed = true;
    }
    // 长按不动 900ms = 删除（和日历视图一致）；待办不提供删除
    if (!item.isTodo) {
      drag.current.timer = window.setTimeout(() => {
        drag.current.timer = null;
        drag.current.longPressed = true;
        drag.current.item = null;
        onDeleteEvent(item.event);
      }, 900);
    }
  };

  const onBlockPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = drag.current;
    if (!st.item) return;
    const dist = Math.hypot(e.clientX - st.startX, e.clientY - st.startY);
    // 还没"按住够久"就移动了：这是滑动手势，直接放弃这次拖动/删除
    if (!st.armed && dist > 8) {
      clearArm();
      clearLongPress();
      st.item = null;
      suppressClick.current = true;
      return;
    }
    if (st.armed && !st.moved && dist > 8) {
      st.moved = true;
      clearLongPress();
      onDragStateChange?.(true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 某些 WebView 不支持 */ }
    }
    if (!st.moved) return;
    setGhost({ x: e.clientX, y: e.clientY, title: st.item.title });
    const cell = cellUnder(e.clientX, e.clientY);
    setHoverCell(cell ? `${cell.day}-${cell.section}` : null);
  };

  const endDrag = (x: number, y: number, commit: boolean) => {
    const st = drag.current;
    clearLongPress();
    clearArm();
    const item = st.item;
    const moved = st.moved;
    const longPressed = st.longPressed;
    drag.current = {
      item: null,
      startX: 0,
      startY: 0,
      armed: false,
      armTimer: null,
      moved: false,
      longPressed: false,
      timer: null,
    };
    setGhost(null);
    setHoverCell(null);
    if (moved || longPressed) suppressClick.current = true;
    if (!commit || !moved || !item) return;
    const cell = cellUnder(x, y);
    if (!cell) return;
    // 起点换成目标节次的开始时间，时长照旧（连堂课拖过去仍然连堂）
    const [sh, sm] = TIMETABLE[cell.section][0].split(':').map(Number);
    const start = weekStart.add(cell.day, 'day').hour(sh).minute(sm).second(0).millisecond(0);
    const minutes = Math.max(1, dayjs(item.event.end).diff(dayjs(item.event.start), 'minute'));
    onMoveEvent(item.event, start.toDate(), start.add(minutes, 'minute').toDate());
  };

  // 把事件按「星期 + 大节」放进格子：与哪几节有时间重叠，就画在哪几行。
  // 连上三节的晚课（19:10-21:35）因此会同时出现在第 6、7 行，和真实课表一致，
  // 而不是被塞进一格后看起来"九点半下课却只显示到 20:45"。
  // 完全不与任何节次重叠的（18:00-19:10 的空档、午休等）放进「课外」兜底行，
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
    const item: GridItem = {
      event: ev,
      title: String(ev.title ?? '').replace(/^\[待办\]\s*/, ''),
      room: String(ev.extendedProps?.location ?? '').split(' - ').pop() ?? '',
      color: ev.backgroundColor || '#1890ff',
      mergedCount: ((ev.extendedProps?.mergedTodos as unknown[]) ?? []).length,
      isTodo: ev.extendedProps?.type === 'todo',
    };
    let placed = false;
    for (let i = 0; i < TIMETABLE.length; i++) {
      const [sh, sm] = TIMETABLE[i][0].split(':').map(Number);
      const [eh, em] = TIMETABLE[i][1].split(':').map(Number);
      // 严格重叠（首尾相接不算），避免 18:00 的待办蹭进 16:25 那一格
      if (Math.min(endMinutes, eh * 60 + em) > Math.max(startMinutes, sh * 60 + sm)) {
        const key = `${day}-${i}`;
        cells.set(key, [...(cells.get(key) ?? []), item]);
        placed = true;
      }
    }
    if (!placed) {
      const key = String(day);
      extraCells.set(key, [...(extraCells.get(key) ?? []), item]);
    }
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
      onPointerDown={onBlockPointerDown(item)}
      onPointerMove={onBlockPointerMove}
      onPointerUp={(e) => endDrag(e.clientX, e.clientY, true)}
      onPointerCancel={(e) => endDrag(e.clientX, e.clientY, false)}
      onClick={() => {
        // 拖动或长按过之后，浏览器仍会补一个 click，这里吞掉
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onSelectEvent(item.event);
      }}
      style={{
        flex: 1,
        minHeight: fillHeight ? 0 : 38,
        // 待办用虚线边框区分（和日历视图一致）
        border: item.isTodo ? '1px dashed rgba(255,255,255,.85)' : 'none',
        borderRadius: 6,
        background: item.color,
        color: '#fff',
        padding: '3px 2px',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        touchAction: 'none',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 2, minWidth: 0 }}>
        {/* 课名最多三行：窄列下长课名会换到六七行，把整张表撑得很长 */}
        <span style={{
          flex: '1 1 auto',
          minWidth: 0,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.18,
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
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
          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 10, lineHeight: 1.15, opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.room}
          </span>
        )}
        {item.isTodo && <span style={{ fontSize: 9.5, opacity: 0.92 }}>{t.calendar.todoTag}</span>}
      </span>
    </button>
  );

  return (
    <div
      className="itdc-timetable-grid"
      style={{ overflowX: 'auto', height: fillHeight ? '100%' : undefined, display: fillHeight ? 'flex' : undefined, flexDirection: 'column' }}
    >
      {ghost && (
        <div
          style={{
            position: 'fixed',
            left: ghost.x,
            top: ghost.y,
            transform: 'translate(-50%, -50%)',
            padding: '4px 8px',
            borderRadius: 6,
            background: 'rgba(0,0,0,.72)',
            color: '#fff',
            fontSize: 11,
            pointerEvents: 'none',
            zIndex: 2000,
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ghost.title}
        </div>
      )}
      {/* 列宽要保证 7 天都塞得下：窄屏上以前是 52+7×46 直接把周六周日顶出屏幕，
          现在节次列收到 44，日期列允许压缩到 34，手机上一屏能看全周一到周日 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '44px repeat(7, minmax(34px, 1fr))',
          // 固定高度模式下：表头自适应，节次行高按真实时长分配（95/95/60/95/95/95/40），
          // 整张表正好一屏；中午 1 小时的节比 1.5 小时的节矮，占比不再失真
          gridTemplateRows: fillHeight
            ? `auto ${TIMETABLE.map((_, i) => `minmax(0, ${SECTION_MINUTES[i]}fr)`).join(' ')}${extraCells.size > 0 ? ` minmax(0, ${EXTRA_ROW_MINUTES}fr)` : ''}`
            : undefined,
          flex: fillHeight ? 1 : undefined,
          minHeight: 0,
          border,
          borderRadius: 10,
          overflow: 'hidden',
          background: cellBg,
        }}
      >
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

        {TIMETABLE.map(([start, end], section) => {
          // 40 分钟的晚课节行太矮放不下「节次号 + 起 + 止」三行，省掉结束时间防止叠字
          const tight = SECTION_MINUTES[section] < 60;
          return (
          <React.Fragment key={section}>
            <div style={{ borderBottom: border, padding: tight ? '2px 4px' : '6px 4px', fontSize: 11, color: secondaryTextColor(isDark), lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, color: isDark ? '#ddd' : '#333' }}>{section + 1}</div>
              <div>{start}</div>
              {!tight && <div style={{ opacity: 0.7 }}>{end}</div>}
            </div>
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const items = cells.get(`${dayIdx}-${section}`) ?? [];
              return (
                <div
                  key={dayIdx}
                  data-cell={`${dayIdx}-${section}`}
                  style={{
                    borderBottom: border,
                    borderLeft: border,
                    minHeight: fillHeight ? 0 : TOUCH_TARGET + 8,
                    padding: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    outline: hoverCell === `${dayIdx}-${section}` ? '2px solid #1677ff' : 'none',
                    outlineOffset: -2,
                  }}
                >
                  {items.map((item, idx) => renderBlock(item, `${item.title}-${idx}`))}
                </div>
              );
            })}
          </React.Fragment>
          );
        })}

        {/* 非课节时间（课间空档、晚间等）：单独一行，避免和上一节课叠在同一格 */}
        {extraCells.size > 0 && (
          <React.Fragment>
            <div style={{ borderBottom: border, padding: '6px 4px', fontSize: 11, color: secondaryTextColor(isDark), lineHeight: 1.35, whiteSpace: 'nowrap' }}>
              <div style={{ fontWeight: 600, color: isDark ? '#ddd' : '#333' }}>{t.calendar.extraTime}</div>
            </div>
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const items = extraCells.get(String(dayIdx)) ?? [];
              return (
                <div key={`extra-${dayIdx}`} style={{ borderBottom: border, borderLeft: border, minHeight: fillHeight ? 0 : TOUCH_TARGET + 8, padding: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
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


