// 本地排程引擎：算法调度完整跑在客户端，无需服务器。
// 与 server/services/scheduler.ts 保持同一策略（数值都在 shared/schedule-policy.ts）：
// 按优先级+截止时间贪心、避开已有安排；工作时段 8:00-22:00，21:00 之后不新开任务，
// 课间不足 30 分钟不用、与下一日程留 5 分钟缓冲，午饭 11:50-13:00、晚饭 18:00-19:00 保护。
import type { CalendarEvent, Priority, Todo } from '../types';
import { looksLikeCourse } from '../../shared/cdut-parser';
import {
  WORK_START_HOUR,
  WORK_END_HOUR,
  LATE_START_HOUR,
  MIN_USABLE_GAP_MINUTES,
  SLOT_BUFFER_MINUTES,
  canUseLateNightWindow,
  dayEndMinutes,
  latestStartMinutes,
  findProtectedWindow,
  atMinutesOfDay,
} from '../../shared/schedule-policy';

export interface ScheduledItem {
  todo_id: number;
  title: string;
  start: string;
  end: string;
  priority: Priority;
}

interface BusySlot {
  start: string;
  end: string;
  /** 是否是课程事件：只有课内可做的待办才允许与它重叠 */
  isClass?: boolean;
}

const BREAK_AFTER_MINUTES = 120;
const BREAK_DURATION_MINUTES = 15;
const MAX_SEGMENT_MINUTES = 90;
/** 分段下限：避免把 95 分钟拆成 90+5 这种没有意义、还没进入状态就结束的碎片 */
const MIN_SEGMENT_MINUTES = 15;
const HORIZON_DAYS = 30;

/**
 * 判断一条事件是不是"课程"。
 * 教务导入的日历 source 是学校 id（如 cdut），iCal 是 ical，手动事件是 manual；
 * 只有课程才允许"课内可做"的待办排进去。
 */
export function isClassEvent(event: Pick<CalendarEvent, 'source'>): boolean {
  return looksLikeCourse(event as CalendarEvent);
}

export function isWithinWorkHours(dt: Date): boolean {
  const h = dt.getHours();
  return h >= WORK_START_HOUR && h < WORK_END_HOUR;
}

export function advanceToWorkHours(dt: Date, allowLateNight = false): Date {
  const result = new Date(dt);
  // 超过当天可排终点（普通 22:00 / 紧急重要 22:30）才顺延到次日 08:00
  const limit = dayEndMinutes(allowLateNight);
  const minutes = result.getHours() * 60 + result.getMinutes();
  if (minutes >= limit) {
    result.setDate(result.getDate() + 1);
    result.setHours(WORK_START_HOUR, 0, 0, 0);
  } else if (minutes < WORK_START_HOUR * 60) {
    result.setHours(WORK_START_HOUR, 0, 0, 0);
  }
  return result;
}

export function splitIntoSegments(totalMinutes: number, maxPerSegment: number): number[] {
  const segments: number[] = [];
  let remaining = totalMinutes;
  while (remaining > maxPerSegment) {
    const restAfterFull = remaining - maxPerSegment;
    if (restAfterFull < MIN_SEGMENT_MINUTES) {
      // 从上一段借时间给尾段，保证每段都 ≥15 分钟
      segments.push(maxPerSegment - (MIN_SEGMENT_MINUTES - restAfterFull));
      remaining = MIN_SEGMENT_MINUTES;
      break;
    }
    segments.push(maxPerSegment);
    remaining -= maxPerSegment;
  }
  if (remaining > 0) segments.push(remaining);
  return segments;
}

/** 二分插入，保持 busy 列表按开始时间有序 */
function insertBusySlot(slots: BusySlot[], slot: BusySlot): void {
  let lo = 0;
  let hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid].start < slot.start) lo = mid + 1;
    else hi = mid;
  }
  slots.splice(lo, 0, slot);
}

export function findNextFreeSlot(
  currentStart: Date,
  durationMinutes: number,
  busySlots: BusySlot[],
  deadline: Date | null,
  /** 该待办是否允许整段落在课程事件内（can_do_in_class） */
  allowClassOverlap = false,
  /** 「紧急重要」才允许用 22:00-22:30 的加时窗口 */
  allowLateNight = false
): Date | null {
  let start = advanceToWorkHours(new Date(currentStart), allowLateNight);
  const maxDate = deadline || new Date(start.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const startLimit = latestStartMinutes(allowLateNight);
  const endLimit = dayEndMinutes(allowLateNight);

  let attempts = 0;
  const maxAttempts = 500;

  while (start < maxDate && attempts < maxAttempts) {
    attempts++;
    // 21:00 之后不开始新任务（晚课 21:45 下课就更不该排）；紧急重要放宽到 22:30
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    if (startMinutes >= startLimit) {
      start.setDate(start.getDate() + 1);
      start.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    // 超出当天可排窗口（普通 22:00 / 紧急重要 22:30）或跨天：顺延到次日
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    if (
      end.getDate() !== start.getDate()
      || endMinutes > endLimit
      || startMinutes < WORK_START_HOUR * 60
    ) {
      start.setDate(start.getDate() + 1);
      start.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }

    if (deadline && end > deadline) return null;

    // 早饭/午饭/晚饭等保护时段：再空也不排
    const protectedWindow = findProtectedWindow(start, end);
    if (protectedWindow) {
      start = advanceToWorkHours(atMinutesOfDay(start, protectedWindow.end), allowLateNight);
      continue;
    }

    let conflict = false;
    let allowedWindowEnd: number | null = null;
    for (const slot of busySlots) {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      if (start < slotEnd && end > slotStart) {
        // 课内可做的待办：整段落在同一节课里就不算冲突（之后会融合到课程上）。
        // 注意必须判断冲突块本身是课程——否则第二条待办会借着"都在课内"与第一条重叠。
        const allowedInsideClass = allowClassOverlap && slot.isClass
          && start >= slotStart && end <= slotEnd;
        if (allowedInsideClass) {
          allowedWindowEnd = allowedWindowEnd === null
            ? slotEnd.getTime()
            : Math.min(allowedWindowEnd, slotEnd.getTime());
          continue;
        }
        conflict = true;
        start = advanceToWorkHours(new Date(Math.max(start.getTime(), slotEnd.getTime())), allowLateNight);
        break;
      }
    }

    if (!conflict) {
      // 可用的连续空档：到下一个忙碌块开始为止；课内可做则还要受课堂结束时间限制
      const nextBoundary = busySlots.find((s) => new Date(s.start).getTime() >= end.getTime());
      const dayEnd = atMinutesOfDay(start, endLimit);
      const nextBoundaryMs = nextBoundary ? new Date(nextBoundary.start).getTime() : dayEnd.getTime();
      const windowEndMs = Math.min(
        allowedWindowEnd === null ? Number.POSITIVE_INFINITY : allowedWindowEnd,
        nextBoundaryMs,
        dayEnd.getTime()
      );
      const availableMinutes = (windowEndMs - start.getTime()) / 60000;
      // 课间太短（<30 分钟）或放不下「任务 + 5 分钟缓冲」时，直接跳到空档结束
      if (availableMinutes < MIN_USABLE_GAP_MINUTES
        || availableMinutes < durationMinutes + SLOT_BUFFER_MINUTES) {
        start = advanceToWorkHours(new Date(windowEndMs), allowLateNight);
        continue;
      }
      return start;
    }
  }

  return null;
}

/**
 * 课内可做的待办：在所有课程窗口里找最早能完整放下的一段（不与已排待办等非课程块重叠）。
 * findNextFreeSlot 遇到"当前候选跨进下一节课"时会直接跳到下课，从而错过这节课本身；
 * 这个函数把课程当作候选窗口单独扫一遍，两者取更早的结果。
 */
export function findNextClassSlot(
  currentStart: Date,
  durationMinutes: number,
  busySlots: BusySlot[],
  deadline: Date | null,
  /** 「紧急重要」才允许用 22:00-22:30 的加时窗口 */
  allowLateNight = false
): Date | null {
  const classSlots = busySlots
    .filter((s) => s.isClass)
    .map((s) => ({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  const needMs = (durationMinutes + SLOT_BUFFER_MINUTES) * 60000;

  for (const cls of classSlots) {
    let cursor = new Date(Math.max(cls.start, advanceToWorkHours(new Date(currentStart), allowLateNight).getTime()));
    const startLimit = latestStartMinutes(allowLateNight);
    while (cursor.getTime() + needMs <= cls.end) {
      if (cursor.getHours() * 60 + cursor.getMinutes() >= startLimit) break;
      const end = new Date(cursor.getTime() + durationMinutes * 60000);
      if (deadline && end > deadline) return null;
      const protectedWindow = findProtectedWindow(cursor, end);
      if (protectedWindow) {
        cursor = advanceToWorkHours(atMinutesOfDay(cursor, protectedWindow.end), allowLateNight);
        continue;
      }
      const blockers = busySlots.filter((s) => {
        if (s.isClass) return false;
        const sStart = new Date(s.start).getTime();
        const sEnd = new Date(s.end).getTime();
        return cursor.getTime() < sEnd && end.getTime() > sStart;
      });
      if (blockers.length === 0) {
        const availableMinutes = (cls.end - cursor.getTime()) / 60000;
        if (availableMinutes >= MIN_USABLE_GAP_MINUTES) return cursor;
      } else {
        const latestEnd = Math.max(...blockers.map((s) => new Date(s.end).getTime()));
        cursor = advanceToWorkHours(new Date(latestEnd), allowLateNight);
        continue;
      }
      break;
    }
  }
  return null;
}

/**
 * 当前这次排程开始前，用户已经连续忙了多久。
 *
 * 以前只统计"本次排出来的待办"，刚上完两节课接着排任务不会触发休息；
 * 这里把课程/日程也算进连续工作。规则：向前看 6 小时，间隔 ≥15 分钟视为已经休息；
 * 只有当这段忙碌串刚结束（30 分钟内）才计入，避免把上午的课算到晚上。
 */
export function workStreakBefore(
  busySlots: BusySlot[],
  now: Date
): { minutes: number; end: Date | null } {
  const breakGapMs = BREAK_DURATION_MINUTES * 60 * 1000;
  const lookbackMs = 6 * 60 * 60 * 1000;
  const recent = busySlots
    .map((s) => ({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
    .filter((s) => !Number.isNaN(s.start) && !Number.isNaN(s.end)
      && s.end <= now.getTime() && s.end > now.getTime() - lookbackMs)
    .sort((a, b) => a.start - b.start);
  if (recent.length === 0) return { minutes: 0, end: null };

  const merged: { start: number; end: number }[] = [];
  for (const slot of recent) {
    const last = merged[merged.length - 1];
    if (!last || slot.start - last.end >= breakGapMs) merged.push({ ...slot });
    else last.end = Math.max(last.end, slot.end);
  }
  const last = merged[merged.length - 1];
  if (now.getTime() - last.end > 30 * 60 * 1000) return { minutes: 0, end: null };
  return { minutes: Math.round((last.end - last.start) / 60000), end: new Date(last.end) };
}

/** 依据本地待办与日程生成排程方案；纯函数，便于测试 */
export function generateScheduleLocally(
  todos: Todo[],
  events: CalendarEvent[],
  /** 仅测试用：固定"现在"，让排程结果可复现（不传则取真实时间） */
  options: { now?: Date } = {},
): ScheduledItem[] {
  const now = options.now ?? new Date();
  const scheduleEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const pending = todos
    .filter((t) => t.status === 'pending')
    .sort((a, b) => {
      // 先重要后紧急（P2 排在 P3 前）：这正是对 mere urgency effect 的纠偏——
      // 不让人/模型被短期截止的琐事拖走，重要不紧急的事要提前得到时间。
      const order: Record<string, number> = {
        'urgent-important': 1,
        important: 2,
        urgent: 3,
        normal: 4,
      };
      const pa = order[a.priority] ?? 9;
      const pb = order[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

  const busySlots: BusySlot[] = [
    ...events
      .filter((e) => new Date(e.start_time) < scheduleEnd && new Date(e.end_time) > now)
      .map((e) => ({ start: e.start_time, end: e.end_time, isClass: isClassEvent(e) })),
    ...todos
      .filter((t) => t.status === 'scheduled' && t.scheduled_start && t.scheduled_end)
      .map((t) => ({ start: t.scheduled_start as string, end: t.scheduled_end as string, isClass: false })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const result: ScheduledItem[] = [];
  const newBusySlots: BusySlot[] = [...busySlots];
  const streak = workStreakBefore(busySlots, now);
  let continuousWorkMinutes = streak.minutes;
  // 上一段工作的结束时间：连续工作满 2 小时后，休息要接在「刚干完的那一段」后面。
  // 以前这里取的是所有忙碌块里最晚的结束时间，日历里只要有远期课程，休息就会落到几天之后，
  // 结果既没让人休息，又在无关时间点挖了个 15 分钟的空洞。
  let lastWorkEnd: Date | null = streak.end;

  /** 记一段已排的工作，并在与上一段之间隔了一整段休息时重新计算连续时长 */
  const noteWork = (start: Date, minutes: number) => {
    if (lastWorkEnd && start.getTime() - lastWorkEnd.getTime() >= BREAK_DURATION_MINUTES * 60 * 1000) {
      continuousWorkMinutes = 0;
    }
    continuousWorkMinutes += minutes;
    lastWorkEnd = new Date(start.getTime() + minutes * 60 * 1000);
  };

  for (const todo of pending) {
    const searchStart = new Date(now.getTime());
    const deadline = todo.deadline ? new Date(todo.deadline) : null;
    const allowClassOverlap = !!todo.can_do_in_class;
    const allowLateNight = canUseLateNightWindow(todo.priority);
    /** 普通空闲窗口与课堂窗口取更早的一个；课内可做才查课堂 */
    const pickStart = (from: Date, minutes: number): Date | null => {
      const normal = findNextFreeSlot(from, minutes, newBusySlots, deadline, allowClassOverlap, allowLateNight);
      const inClass = allowClassOverlap
        ? findNextClassSlot(from, minutes, newBusySlots, deadline, allowLateNight)
        : null;
      if (normal && inClass) {
        return normal.getTime() <= inClass.getTime() ? normal : inClass;
      }
      return normal ?? inClass;
    };

    const segmentMinutes =
      todo.estimated_minutes > MAX_SEGMENT_MINUTES
        ? splitIntoSegments(todo.estimated_minutes, MAX_SEGMENT_MINUTES)
        : [todo.estimated_minutes];
    const totalSegments = segmentMinutes.length;

    if (continuousWorkMinutes >= BREAK_AFTER_MINUTES) {
      const breakSearchStart = new Date(Math.max(
        lastWorkEnd ? lastWorkEnd.getTime() : searchStart.getTime(),
        searchStart.getTime()
      ));
      const breakStart = findNextFreeSlot(
        breakSearchStart,
        BREAK_DURATION_MINUTES,
        newBusySlots,
        null
      );
      if (breakStart) {
        const breakEnd = new Date(breakStart.getTime() + BREAK_DURATION_MINUTES * 60 * 1000);
        insertBusySlot(newBusySlots, {
          start: breakStart.toISOString(),
          end: breakEnd.toISOString(),
        });
      }
      continuousWorkMinutes = 0;
    }

    const firstSlotStart = pickStart(searchStart, segmentMinutes[0]);
    if (!firstSlotStart) continue;

    const firstSlotEnd = new Date(firstSlotStart.getTime() + segmentMinutes[0] * 60 * 1000);
    result.push({
      todo_id: todo.id,
      title: totalSegments > 1 ? `${todo.title} (1/${totalSegments})` : todo.title,
      start: firstSlotStart.toISOString(),
      end: firstSlotEnd.toISOString(),
      priority: todo.priority,
    });

    insertBusySlot(newBusySlots, {
      start: firstSlotStart.toISOString(),
      end: firstSlotEnd.toISOString(),
    });
    noteWork(firstSlotStart, segmentMinutes[0]);

    for (let i = 1; i < segmentMinutes.length; i++) {
      const lastEnd = newBusySlots[newBusySlots.length - 1].end;
      const breakStart = findNextFreeSlot(new Date(lastEnd), BREAK_DURATION_MINUTES, newBusySlots, deadline);
      if (breakStart) {
        const breakEnd = new Date(breakStart.getTime() + BREAK_DURATION_MINUTES * 60 * 1000);
        insertBusySlot(newBusySlots, {
          start: breakStart.toISOString(),
          end: breakEnd.toISOString(),
        });
        continuousWorkMinutes = 0;
      }

      const segStart = pickStart(
        new Date(newBusySlots[newBusySlots.length - 1].end),
        segmentMinutes[i]
      );
      if (!segStart) break;

      const segEnd = new Date(segStart.getTime() + segmentMinutes[i] * 60 * 1000);
      result.push({
        todo_id: todo.id,
        title: `${todo.title} (${i + 1}/${totalSegments})`,
        start: segStart.toISOString(),
        end: segEnd.toISOString(),
        priority: todo.priority,
      });

      insertBusySlot(newBusySlots, { start: segStart.toISOString(), end: segEnd.toISOString() });
      noteWork(segStart, segmentMinutes[i]);
    }
  }

  return result;
}

/** 校验排程方案：时间冲突、超出工作时段、越过截止时间 */
export function validateScheduleLocally(
  items: ScheduledItem[],
  todos: Todo[],
  /** 已有日历事件；用于检查冲突，并放行"课内可做"的课内片段 */
  events: CalendarEvent[] = []
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const todoById = new Map(todos.map((t) => [t.id, t]));
  const classWindows = events
    .filter((e) => isClassEvent(e))
    .map((e) => ({ start: new Date(e.start_time), end: new Date(e.end_time) }));
  const fixedEvents = events.map((e) => ({
    start: new Date(e.start_time),
    end: new Date(e.end_time),
    isClass: isClassEvent(e),
  }));

  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      errors.push(`时间冲突：${sorted[i - 1].title} 与 ${sorted[i].title} 重叠`);
    }
  }

  for (const item of items) {
    const start = new Date(item.start);
    const end = new Date(item.end);
    const todo = todoById.get(item.todo_id);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    // 22:00-22:30 只允许「紧急重要」（口径与算法、服务端、提示词一致）
    const allowLateNight = canUseLateNightWindow(item.priority ?? todo?.priority);
    if (startMinutes < WORK_START_HOUR * 60 || endMinutes > dayEndMinutes(allowLateNight)) {
      errors.push(`超出工作时段：${item.title}`);
    }
    if (startMinutes >= latestStartMinutes(allowLateNight)) {
      errors.push(`安排在深夜时段：${item.title}`);
    }
    const protectedWindow = findProtectedWindow(start, end);
    if (protectedWindow) {
      errors.push(`安排在${protectedWindow.label}时段：${item.title}`);
    }
    // 大模型偶尔会返回已经过去的时段（尤其是没带时区偏移时），
    // 这种安排写进数据库就等于「排了但永远做不了」，必须拦下来
    if (end.getTime() < Date.now() - 5 * 60 * 1000) {
      errors.push(`时间已过去：${item.title}`);
    }
    if (todo?.deadline && end > new Date(todo.deadline)) {
      errors.push(`超过截止时间：${item.title}`);
    }
    const duration = Math.round((end.getTime() - start.getTime()) / 60000);
    if (duration > MAX_SEGMENT_MINUTES) {
      errors.push(`单段超过 ${MAX_SEGMENT_MINUTES} 分钟：${item.title}`);
    }
    // 与已有事件冲突；唯一例外是 can_do_in_class 且整段落在同一节课内
    for (const event of fixedEvents) {
      if (start < event.end && end > event.start) {
        const allowedInClass = !!todo?.can_do_in_class && event.isClass
          && classWindows.some((w) => start >= w.start && end <= w.end);
        if (!allowedInClass) {
          errors.push(`与已有事件冲突：${item.title}`);
          break;
        }
      }
    }
  }

  // 完成量校验：拆出的分段总和必须接近 estimated_minutes，避免"排了一半"却显示成功
  const scheduledMinutes = new Map<number, number>();
  for (const item of items) {
    const minutes = Math.round(
      (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60000
    );
    scheduledMinutes.set(item.todo_id, (scheduledMinutes.get(item.todo_id) ?? 0) + minutes);
  }
  for (const [todoId, minutes] of scheduledMinutes) {
    const todo = todoById.get(todoId);
    if (!todo) continue;
    if (minutes < todo.estimated_minutes - 5) {
      errors.push(
        `拆分不完整：${todo.title} 只安排了 ${minutes} 分钟，预计需要 ${todo.estimated_minutes} 分钟`
      );
    } else if (minutes > todo.estimated_minutes + 5) {
      errors.push(
        `超出预计时长：${todo.title} 安排了 ${minutes} 分钟，预计 ${todo.estimated_minutes} 分钟`
      );
    }
  }
  // 完全没排上的待办也要提示：塞不下时算法会跳过，不能让用户以为全部安排好了
  for (const todo of todos) {
    if (todo.status === 'pending' && !scheduledMinutes.has(todo.id)) {
      errors.push(`未能安排：${todo.title}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
