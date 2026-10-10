/**
 * 课表视图：照课程表小程序那种「按大节排的格子」来渲染。
 *
 * 左边是节次与上下课时间，右边七列是周一到周日；
 * 课程块显示课名 + 教室，颜色沿用课程配色。数据直接复用日历事件，
 * 所以点击课程走的还是同一套详情弹窗。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { TIMETABLE } from '../../shared/cdut-parser';
import { assignCourseColors, courseTextColor } from '../../shared/course-colors';
import { getCourseColorOverrides } from '../api/course-color-overrides';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';
import { secondaryTextColor, TOUCH_TARGET } from './ui';

/**
 * 每大节的真实时长（分钟）：95 / 95 / 60 / 95 / 95 / 95 / 40。
 * 格子行高按它取比例——中午 1 小时的节不再和 1.5 小时的节一样高。
 */
/**
 * 表格行 = 教务的前 6 个大节 + 一节把「第 7 节（20:55–21:35）」与「夜间（21:35–22:30）」
 * 合并后的第 7 行（20:55–22:30，95 分钟）。
 *
 * 分两行时那 40 分钟的尾巴看起来像被截断，也让人以为「九点半的课只画了一半」；
 * 合并成一行后课程块按真实时长等比占位，晚课与「在图书馆待到十点半」的排期都落进同一格。
 * 只影响课表渲染，不动 TIMETABLE——导入解析仍按教务的 7 节来。
 */
const GRID_SECTIONS: readonly [string, string][] = [...TIMETABLE.slice(0, 6), ['20:55', '22:30']];

const SECTION_MINUTES = GRID_SECTIONS.map(([start, end]) => {
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
  /** 大课（跨多节 / 连堂）整体拖动：一次给出这一整条里每一段的新起止 */
  onMoveEvents?: (moves: Array<{ event: any; start: Date; end: Date }>) => void;
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
  /** 同格内与课程重叠、被折成角标的待办数（课程优先，不让待办把课挤矮） */
  overlapTodoCount?: number;
}

const TimetableGrid: React.FC<Props> = ({
  weekStart,
  events,
  isDark,
  onSelectEvent,
  onMoveEvent,
  onMoveEvents,
  onDeleteEvent,
  onDragStateChange,
  fillHeight = false,
}) => {
  const { t } = useI18n();
  const { appearance } = useTheme();
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
    /** 被拖卡片的实际宽度：浮层要保持同样的窄长比例，不能拉宽 */
    width: number;
    /** 被抓住的那一格（大课整体拖动时作为锚点） */
    day: number;
    section: number;
    /** 视觉上连在一起的整条大课：跨多节的事件 / 同课名同教室的连堂 */
    run: Array<{ day: number; section: number; item: GridItem }>;
    /** 整条大课在屏幕上的高度（浮层克隆整条，而不是只拎抓住的那半截） */
    height: number;
    /** 手指抓住的位置在整条里的偏移：浮层贴住手指，不跳位 */
    grabOffsetY: number;
  }>({
    item: null,
    startX: 0,
    startY: 0,
    armed: false,
    armTimer: null,
    moved: false,
    longPressed: false,
    timer: null,
    width: 0,
    day: 0,
    section: -1,
    run: [],
    height: 0,
    grabOffsetY: 0,
  });
  // 拖过或长按过之后紧跟着的 click 要吞掉，否则会弹出详情
  const suppressClick = useRef(false);
  /** 拖动预览：直接克隆被拖的课程卡片（同色 + 课名/教室），而不是另外画一个黑条 */
  const [ghost, setGhost] = useState<{
    x: number;
    y: number;
    title: string;
    room: string;
    color: string;
    id: string;
    width: number;
    height: number;
    grabOffsetY: number;
    /** 整条大课包含的事件 id：一起淡出原位置 */
    ids: string[];
  } | null>(null);
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

  const onBlockPointerDown = (
    item: GridItem,
    day: number,
    section: number,
    run: Array<{ day: number; section: number; item: GridItem }>,
  ) => (e: React.PointerEvent<HTMLButtonElement>) => {
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
      width: 0,
      day,
      section,
      run: run.length > 0 ? run : [{ day, section, item }],
      height: 0,
      grabOffsetY: 0,
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
      // 记住被拎起卡片的实际宽度：浮层保持课块那种窄长条，不横向拉宽
      st.width = e.currentTarget.getBoundingClientRect().width;
      // 一上午/一下午/一晚上的大课在视觉上是一条：量出整条高度，浮层一次拎起整条
      const runEls = st.run
        .map((r) => document.querySelector<HTMLElement>(`[data-cell="${r.day}-${r.section}"]`))
        .filter((el): el is HTMLElement => !!el);
      const fallback = e.currentTarget.getBoundingClientRect();
      const rects = runEls.length > 0 ? runEls.map((el) => el.getBoundingClientRect()) : [fallback];
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      st.height = Math.max(44, bottom - top - 4);
      st.grabOffsetY = Math.min(Math.max(e.clientY - top, 16), Math.max(16, st.height - 16));
    }
    if (!st.moved) return;
    // 拎起来的卡片不要被屏幕边缘裁掉：中心至少留出半宽 + 余量；
    // 纵向按"抓住的位置"对齐，整条大课浮层不会因为居中而跳位
    const half = (st.width || 64) / 2 + 6;
    const height = st.height || 64;
    const offset = st.grabOffsetY || height / 2;
    const minY = 8 + offset;
    const maxY = window.innerHeight - 8 - (height - offset);
    setGhost({
      x: Math.min(Math.max(e.clientX, half), Math.max(half, window.innerWidth - half)),
      y: Math.min(Math.max(e.clientY, minY), Math.max(minY, maxY)),
      title: st.item.title,
      room: st.item.room,
      color: st.item.color,
      id: String(st.item.event?.id ?? ''),
      width: st.width || 64,
      height,
      grabOffsetY: offset,
      ids: st.run.map((r) => String(r.item.event?.id ?? '')).filter(Boolean),
    });
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
    // 大课整条 + 抓住的那一格（作为整体拖动的锚点），要在清空 ref 之前取出来
    const run = st.run.length > 0 ? st.run : (item ? [{ day: st.day, section: st.section, item }] : []);
    const grabDay = st.day;
    const grabSection = st.section;
    drag.current = {
      item: null,
      startX: 0,
      startY: 0,
      armed: false,
      armTimer: null,
      moved: false,
      longPressed: false,
      timer: null,
      width: 0,
      day: 0,
      section: -1,
      run: [],
      height: 0,
      grabOffsetY: 0,
    };
    setGhost(null);
    setHoverCell(null);
    if (moved || longPressed) suppressClick.current = true;
    if (!commit || !moved || !item) return;
    const cell = cellUnder(x, y);
    if (!cell) return;
    // 目标格的开始时间
    const [sh, sm] = GRID_SECTIONS[cell.section][0].split(':').map(Number);
    const dropStart = weekStart.add(cell.day, 'day').hour(sh).minute(sm).second(0).millisecond(0);

    // 一上午/一下午/一晚上的那种大课：只要视觉上连成一条（跨多节的事件、或同课名同教室
    // 且间隔很小的连堂），就抓住哪一节、整体按同一时间差平移——不会只拖走半截，
    // 也不会因为抓的是尾巴而让整条课往下跳一节
    if (run.length > 1 && grabSection >= 0) {
      const [gsh, gsm] = GRID_SECTIONS[grabSection][0].split(':').map(Number);
      const grabStart = weekStart.add(grabDay, 'day').hour(gsh).minute(gsm).second(0).millisecond(0);
      const delta = dropStart.diff(grabStart, 'minute');
      // 同一条事件跨多节时会出现多段：按事件 id 去重，只移动一次；
      // 没有 id 的（极少）按引用标识去重，避免误合并成一条
      const seen = new Set<string>();
      const unique: GridItem[] = [];
      for (const r of run) {
        const id = r.item.event?.id;
        const key = id != null ? `id:${id}` : `ref:${String(r.item.event?.start ?? '')}|${r.item.title}|${r.day}-${r.section}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(r.item);
      }
      const moves = unique.map((it) => ({
        event: it.event,
        start: dayjs(it.event.start).add(delta, 'minute').toDate(),
        end: dayjs(it.event.end).add(delta, 'minute').toDate(),
      }));
      if (onMoveEvents) onMoveEvents(moves);
      else for (const m of moves) onMoveEvent(m.event, m.start, m.end);
      return;
    }

    // 单块（普通课/待办）：落在哪一节就以哪一节的开始为起点，保持原来的手感
    const minutes = Math.max(1, dayjs(item.event.end).diff(dayjs(item.event.start), 'minute'));
    onMoveEvent(item.event, dropStart.toDate(), dropStart.add(minutes, 'minute').toDate());
  };

  /**
   * 拖动兜底收尾：WebView 里 setPointerCapture 可能失败，手指抬起、被系统打断或
   * 切到后台时按钮上的 pointerup 不一定送达——不兜底的话，浮起的课名和蓝色落点框
   * 会一直留在课表上。这里在 window 层收尾：
   *   - pointerup → 按落点正常提交（按钮已处理过时是空操作）
   *   - pointercancel / 失焦 / 切后台 → 直接清掉，不提交
   */
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;
  useEffect(() => {
    const onUp = (e: PointerEvent) => { endDragRef.current(e.clientX, e.clientY, true); };
    const onCancel = (e: PointerEvent) => { endDragRef.current(e.clientX, e.clientY, false); };
    const onAbort = () => { endDragRef.current(-1, -1, false); };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onAbort);
    document.addEventListener('visibilitychange', onAbort);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onAbort);
      document.removeEventListener('visibilitychange', onAbort);
    };
  }, []);

  // 把事件按「星期 + 大节」放进格子：与哪几节有时间重叠，就画在哪几行。
  // 连上三节的晚课（19:10-21:35）因此会同时出现在第 6、7 行，和真实课表一致，
  // 而不是被塞进一格后看起来"九点半下课却只显示到 20:45"。
  // 完全不与任何节次重叠的（18:00-19:10 的空档、午休等）放进「课外」兜底行，
  // 不能按"开始时间 ≥ 某节开始"归到上一节，否则 18:00 的待办会和 16:25 的课叠在同一格。
  /**
   * 每格记一条 entry：除了课程本身，还带上它跟这一节的重叠时长。
   *   spill = 这节课不是在本节开始，而是从上一节延续下来的「尾巴」
   *           （例如 19:10–21:35 的课蹭到 20:55 那节的 40 分钟）。
   * 尾巴按重叠比例画一小截纯色块，不再因为"不满半格"被整段丢掉。
   */
  interface CellEntry {
    item: GridItem;
    overlap: number;
    sectionMinutes: number;
    spill: boolean;
  }
  const cells = new Map<string, CellEntry[]>();
  const extraCells = new Map<string, GridItem[]>();
  // 整套课表（不只这一周）一起算色：同一门课跨周稳定，不同课尽量不撞色。
  // 用渲染时现算而不是只认事件里存的颜色，存量数据（早先哈希撞色的）也能自动纠正。
  const courseColors = assignCourseColors(
    events
      .filter((e) => e?.extendedProps?.type !== 'todo')
      .map((e) => String(e?.title ?? '')),
    getCourseColorOverrides(),
  );
  for (const ev of events) {
    if (!ev?.start) continue;
    const start = dayjs(ev.start);
    const day = start.startOf('day').diff(weekStart.startOf('day'), 'day');
    // 只渲染当前这一周。事件表里保存的是整学期逐周事件，
    // 不过滤的话同一门课会从所有周次堆进同一个格子。
    if (day < 0 || day > 6) continue;
    const startMinutes = start.hour() * 60 + start.minute();
    const endMinutes = startMinutes + Math.max(1, dayjs(ev.end).diff(start, 'minute'));
    const isTodo = ev.extendedProps?.type === 'todo';
    const item: GridItem = {
      event: ev,
      title: String(ev.title ?? '').replace(/^\[待办\]\s*/, ''),
      room: String(ev.extendedProps?.location ?? '').split(' - ').pop() ?? '',
      // 课程用整套课表算出来的不撞色配色；待办仍用它自己的颜色
      color: (isTodo ? null : courseColors.get(String(ev.title ?? ''))) ?? ev.backgroundColor ?? '#1890ff',
      mergedCount: ((ev.extendedProps?.mergedTodos as unknown[]) ?? []).length,
      isTodo,
    };
    let placed = false;
    for (let i = 0; i < GRID_SECTIONS.length; i++) {
      const [sh, sm] = GRID_SECTIONS[i][0].split(':').map(Number);
      const [eh, em] = GRID_SECTIONS[i][1].split(':').map(Number);
      const sectionStart = sh * 60 + sm;
      const sectionEnd = eh * 60 + em;
      // 严格重叠（首尾相接不算），避免 18:00 的待办蹭进 16:25 那一格
      const overlap = Math.min(endMinutes, sectionEnd) - Math.max(startMinutes, sectionStart);
      if (overlap <= 0) continue;
      // 重叠要有实质占比才画进这一格：至少占「事件与整节中较短者」的一半。
      // 95 分钟的课拖到中午（60 分钟的节）后结束在 14:35，与下午第一节只擦过
      // 5 分钟——以前会在这里再画一个满格块，看起来像凭空多出一节课。
      const needed = Math.min(sectionEnd - sectionStart, endMinutes - startMinutes) / 2;
      // 但「上一节就开始了、这一节才结束」的尾巴是另一回事：那是同一门课连着，
      // 丢掉会让 21:35 下课的课只显示到 20:45。尾巴按下上文的 spill 渲染成
      // 一小截纯色块（无文字、高度按比例），所以这里放行。
      const startsInSection = startMinutes >= sectionStart && startMinutes < sectionEnd;
      if (startsInSection && overlap < needed) continue;
      const key = `${day}-${i}`;
      const list = cells.get(key) ?? [];
      // 同一门课重复导入会在同一天留下多条（标题相同、时间段互相包含，
      // 例如 14:30–16:05 与 14:30–18:00），叠在一格里就是两块一样的课。
      // 只保留时间更长的那条：新条目被已有条目包住就跳过，反过来就替掉旧的。
      // 注意 ev.start 是 dayjs/Date 对象而不是 ISO 字符串，必须用 dayjs 解析
      const minuteOf = (v: unknown) => {
        const d = dayjs(v as dayjs.ConfigType);
        return d.isValid() ? d.hour() * 60 + d.minute() : NaN;
      };
      const sameCourse = list.filter((e) => e.item.title === item.title);
      const covered = sameCourse.some((e) => {
        const s = minuteOf(e.item.event?.start);
        const t = minuteOf(e.item.event?.end);
        return Number.isFinite(s) && Number.isFinite(t) && s <= startMinutes && t >= endMinutes;
      });
      if (!covered) {
        const rest = list.filter((e) => {
          if (e.item.title !== item.title) return true;
          const s = minuteOf(e.item.event?.start);
          const t = minuteOf(e.item.event?.end);
          return !(Number.isFinite(s) && Number.isFinite(t) && startMinutes <= s && endMinutes >= t);
        });
        rest.push({
          item,
          overlap,
          sectionMinutes: sectionEnd - sectionStart,
          spill: !startsInSection,
        });
        cells.set(key, rest);
      }
      placed = true;
    }
    if (!placed) {
      const key = String(day);
      extraCells.set(key, [...(extraCells.get(key) ?? []), item]);
    }
  }
  // 同格内按开始时间排序，避免渲染顺序随机
  const startOf = (x: GridItem) => {
    const d = dayjs(x.event?.start);
    return d.isValid() ? d.valueOf() : 0;
  };
  for (const list of cells.values()) {
    list.sort((a, b) => startOf(a.item) - startOf(b.item));
  }
  for (const list of extraCells.values()) {
    list.sort((a, b) => startOf(a) - startOf(b));
  }

  /**
   * 某一格最终会渲染哪些条目。
   * 规则：这一格自己就有课（不是从上一节延续来的）时，不画别人的尾巴——
   * 一节里塞两条会把先开始的那条挤成几像素，尾巴也自有它开始的那一格在显示。
   */
  const entriesFor = (dayIdx: number, section: number): CellEntry[] => {
    const list = cells.get(`${dayIdx}-${section}`) ?? [];
    const hasOwnCourse = list.some((e) => !e.spill);
    return hasOwnCourse ? list.filter((e) => !e.spill) : list;
  };

  /**
   * 上下两格算不算"连堂"。
   *   1) 同一条事件跨格（14:30–18:00 落在两节里）——id 相同；
   *   2) 课名 + 教室相同、且间隔很小（课间只有几分钟，导出的课表常把它拆成
   *      两条独立事件，例如 14:30–16:05 与 16:10–17:45）。
   * 同一天里上下午分开上的同一门课（间隔几小时）不算，会各自成块。
   */
  const CONTINUE_GAP_MIN = 30;
  const continuesFrom = (above: GridItem, below: GridItem): boolean => {
    if (above.event?.id != null && above.event.id === below.event?.id) return true;
    if (above.title !== below.title) return false;
    if ((above.room || '') !== (below.room || '')) return false;
    const aEnd = dayjs(above.event?.end);
    const bStart = dayjs(below.event?.start);
    if (!aEnd.isValid() || !bStart.isValid()) return false;
    const gap = bStart.diff(aEnd, 'minute');
    return gap >= -5 && gap <= CONTINUE_GAP_MIN;
  };

  /**
   * 一门"大课"（一上午/一下午/一晚上）在视觉上连成一条：既可能是一条跨多节的事件，
   * 也可能是教务拆成两条、但课名+教室相同且间隔很小的连堂。这里从抓住的那一格出发，
   * 上下把相连的格子都串起来，整条一起拖动。
   */
  const runFor = (
    day: number,
    section: number,
    item: GridItem,
  ): Array<{ day: number; section: number; item: GridItem }> => {
    const run: Array<{ day: number; section: number; item: GridItem }> = [{ day, section, item }];
    if (section < 0) return run;
    let cur = item;
    for (let s = section + 1; s < GRID_SECTIONS.length; s++) {
      const next = entriesFor(day, s).map((e) => e.item).find((n) => continuesFrom(cur, n));
      if (!next) break;
      run.push({ day, section: s, item: next });
      cur = next;
    }
    cur = item;
    for (let s = section - 1; s >= 0; s--) {
      const prev = entriesFor(day, s).map((e) => e.item).find((p) => continuesFrom(p, cur));
      if (!prev) break;
      run.unshift({ day, section: s, item: prev });
      cur = prev;
    }
    return run;
  };

  const border = `1px solid var(--itdc-border, ${isDark ? '#303030' : '#ececec'})`;
  const cellBg = `var(--itdc-cell-bg, ${isDark ? '#1b1b1b' : '#fff'})`;
  const headBg = `var(--itdc-head-bg, ${isDark ? '#232323' : '#fafafa'})`;

  /**
   * 课程块。continuation 表示这是同一门课在上一格之后的续格：
   * 同一门课颜色相同、上下连着，续格只留一块颜色，不再重复课名/教室——
   * 既避免文字被截成"地震勘探原理与方法 E1B…"，整门课看起来也更像一整块。
   * 接缝两侧的圆角同时拉平（上面那格去下半圆角、下面那格去上半圆角）。
   */
  const renderBlock = (
    item: GridItem,
    key: string,
    continuation?: {
      up: boolean;
      down: boolean;
      spillRatio?: number;
      joinDown?: boolean;
      day?: number;
      section?: number;
      run?: Array<{ day: number; section: number; item: GridItem }>;
    },
  ) => {
    // 续格 / 尾巴：不写文字（课名教室已在开始的那一格显示），只留同色的一块
    const plain = !!(continuation?.up || continuation?.spillRatio != null);
    // 连堂合并后块会变高：课名和教室要挨在一起排在上方，
    // 否则 space-between 会把教室顶到最底、中间空一大片，很难看
    const joined = !!(continuation?.up || continuation?.down);
    // 尾巴按真实时长占一小截：用 height 百分比而不是 flex-basis，
    // 这样同一格里还有别的课时候，对方仍能拿到剩下的空间（不会被挤成几像素）
    const spillHeight = continuation?.spillRatio != null
      ? `${Math.max(10, Math.round(continuation.spillRatio * 100))}%`
      : undefined;
    // 字色档位由外观设置决定：灰（智能兜底）/ 白 / 黑
    const textColor = courseTextColor(item.color, appearance.courseTextTone);
    return (
    <button
      key={key}
      type="button"
      onPointerDown={onBlockPointerDown(
        item,
        continuation?.day ?? 0,
        continuation?.section ?? -1,
        continuation?.run ?? [{ day: continuation?.day ?? 0, section: continuation?.section ?? -1, item }],
      )}
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
        flex: spillHeight ? '0 1 auto' : 1,
        height: spillHeight,
        // 连堂：把上半块向下延伸，盖掉两格之间的 padding 与（已去掉的）分隔线，
        // 上下两块就贴成一整块，中间不再留一条缝
        marginBottom: continuation?.joinDown ? -4 : undefined,
        minHeight: continuation?.spillRatio != null ? 10 : (fillHeight ? 0 : 38),
        // 待办用虚线边框区分（和日历视图一致）
        border: item.isTodo ? '1px dashed rgba(255,255,255,.85)' : 'none',
        borderRadius: 'var(--itdc-r-sm)',
        borderTopLeftRadius: continuation?.up ? 0 : undefined,
        borderTopRightRadius: continuation?.up ? 0 : undefined,
        borderBottomLeftRadius: continuation?.down ? 0 : undefined,
        borderBottomRightRadius: continuation?.down ? 0 : undefined,
        background: item.color,
        color: textColor,
        // 白字才加阴影兜一点抗锯齿边缘；黑字加阴影会发糊
        textShadow: textColor === '#fff' ? '0 1px 2px rgba(0,0,0,.28)' : 'none',
        // 被拎起来的那张卡：原位淡下去，让"卡片跟着手指走"更直观
        opacity: ghost && ghost.ids.includes(String(item.event?.id ?? '')) ? 0.35 : 1,
        transition: 'opacity .15s ease',
        padding: '3px 2px',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: joined ? 'flex-start' : 'space-between',
        gap: joined ? 2 : undefined,
        overflow: 'hidden',
        touchAction: 'none',
      }}
    >
      {/* 续格：纯色块，不重复文字（角标也不画，保持干净） */}
      {!plain && (
      <>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 2, minWidth: 0 }}>
        {/* 课名最多三行：窄列下长课名会换到六七行，把整张表撑得很长 */}
        <span style={{
          flex: '1 1 auto',
          minWidth: 0,
          // 中文点名等主信息：12px 起步（Material body small；简体中文手机阅读研究里
          // 10pt 明显偏小，12pt 是可读下限，14pt 更舒服——窄列折中取 12）
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.22,
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
            borderRadius: 'var(--itdc-r-sm)',
            background: 'rgba(255,255,255,.92)',
            color: '#333',
            // 角标是唯一允许低于 11 的层级，10px 是下限
            fontSize: 10,
            lineHeight: '14px',
          }}>
            {item.mergedCount}
          </span>
        )}
        {!!item.overlapTodoCount && (
          <span style={{
            flexShrink: 0,
            padding: '0 3px',
            borderRadius: 'var(--itdc-r-sm)',
            background: 'rgba(0,0,0,.45)',
            color: '#fff',
            fontSize: 10,
            lineHeight: '14px',
          }}>
            {t.calendar.todoTag} {item.overlapTodoCount}
          </span>
        )}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
        {item.room && (
          // 次要信息 11px（Apple HIG 最小字号 11pt / Material label small 11sp）
          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11, lineHeight: 1.2, opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.room}
          </span>
        )}
        {item.isTodo && <span style={{ fontSize: 10.5, opacity: 0.92 }}>{t.calendar.todoTag}</span>}
      </span>
      </>
      )}
    </button>
    );
  };

  return (
    <div
      className="itdc-timetable-grid"
      style={{ overflowX: 'auto', height: fillHeight ? '100%' : undefined, display: fillHeight ? 'flex' : undefined, flexDirection: 'column' }}
    >
      {ghost && createPortal(
        <div
          style={{
            position: 'fixed',
            left: ghost.x,
            top: ghost.y,
            // 和课表里的课块同款：同色、同圆角、课名 + 教室；整条大课一次拎起来
            transform: `translate(-50%, -${ghost.grabOffsetY}px)`,
            // 宽度保持被拎卡片的原始窄条；高度 = 视觉上连起来的整条高度
            width: ghost.width,
            height: ghost.height,
            padding: '4px 3px',
            borderRadius: 'var(--itdc-r-sm)',
            background: ghost.color,
            color: courseTextColor(ghost.color, appearance.courseTextTone),
            boxShadow: '0 8px 20px rgba(0,0,0,.28)',
            opacity: 0.95,
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.22,
            pointerEvents: 'none',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflow: 'hidden',
          }}
        >
          <span style={{ wordBreak: 'break-word' }}>
            {ghost.title}
          </span>
          {ghost.room && (
            <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ghost.room}
            </span>
          )}
        </div>,
        document.body,
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
            ? `auto ${GRID_SECTIONS.map((_, i) => `minmax(0, ${SECTION_MINUTES[i]}fr)`).join(' ')}${extraCells.size > 0 ? ` minmax(0, ${EXTRA_ROW_MINUTES}fr)` : ''}`
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
              <div style={{ fontSize: 12, fontWeight: 600, color: isToday ? appearance.accent : (isDark ? '#ddd' : '#333') }}>
                {day.format('ddd')}
              </div>
              <div style={{ fontSize: 11, color: isToday ? appearance.accent : secondaryTextColor(isDark) }}>{day.format('M.D')}</div>
            </div>
          );
        })}

        {GRID_SECTIONS.map(([start, end], section) => {
          // 40 分钟的晚课节行最矮，藏掉结束时间会让人以为"这节被渲染短了"，
          // 所以三行都保留，只把字号和行距压小，保证 45px 的行也放得下
          const tight = SECTION_MINUTES[section] < 60;
          return (
          <React.Fragment key={section}>
            <div style={{ borderBottom: border, padding: tight ? '1px 4px' : '6px 4px', fontSize: 11, color: secondaryTextColor(isDark), lineHeight: tight ? 1.2 : 1.35, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, color: isDark ? '#ddd' : '#333' }}>{section + 1}</div>
              <div>{start}</div>
              <div style={{ opacity: 0.7 }}>{end}</div>
            </div>
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const visibleEntries = entriesFor(dayIdx, section);
              const items = visibleEntries.map((e) => e.item);
              // 课程优先：同格既有课又有待办时，待办不再平分格高（会把课挤掉一半），
              // 只折成角标；整格只有待办时才照旧平铺
              const courses = items.filter((i) => !i.isTodo);
              const todos = items.filter((i) => i.isTodo);
              const shown = courses.length
                ? courses.map((c, idx) => (idx === 0 ? { ...c, overlapTodoCount: todos.length } : c))
                : todos;
              return (
                <div
                  key={dayIdx}
                  data-cell={`${dayIdx}-${section}`}
                  style={{
                    // 下一格是本节的续块时，两格之间的横线去掉（块本身会连过去）
                    borderBottom: visibleEntries.some((e) => (entriesFor(dayIdx, section + 1)).some((n) => continuesFrom(e.item, n.item)))
                      ? 'none'
                      : border,
                    borderLeft: border,
                    minHeight: fillHeight ? 0 : TOUCH_TARGET + 8,
                    padding: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    outline: hoverCell === `${dayIdx}-${section}` ? `2px solid ${appearance.accent}` : 'none',
                    outlineOffset: -2,
                  }}
                >
                  {shown.map((item, idx) => {
                    const entry = visibleEntries.find((e) => e.item.event.id === item.event.id);
                    // 同一门课（或同一条事件）落在相邻格时，下面的格子只当"续块"渲染
                    const prevRow = section > 0 ? entriesFor(dayIdx, section - 1) : [];
                    const nextRow = entriesFor(dayIdx, section + 1);
                    const up = prevRow.some((p) => continuesFrom(p.item, item));
                    const down = nextRow.some((n) => continuesFrom(item, n.item));
                    // 尾巴（本节才结束的溢出部分）按真实时长占一小截，且不写文字
                    const spillRatio = entry?.spill ? entry.overlap / entry.sectionMinutes : undefined;
                    // 连堂时把上块向下延伸、并去掉两格之间的分隔线，贴成一整块
                    return renderBlock(item, `${item.title}-${idx}`, {
                      up,
                      down,
                      spillRatio,
                      joinDown: down,
                      day: dayIdx,
                      section,
                      // 整条大课（跨多节 / 连堂），拖动时一起走
                      run: runFor(dayIdx, section, item),
                    });
                  })}
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
                  {items.map((item, idx) => renderBlock(item, `extra-${item.title}-${idx}`, {
                    up: false,
                    down: false,
                    day: dayIdx,
                    section: -1,
                    run: [{ day: dayIdx, section: -1, item }],
                  }))}
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


