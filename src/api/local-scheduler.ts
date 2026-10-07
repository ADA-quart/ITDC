// 本地排程引擎：算法调度完整跑在客户端，无需服务器。
// 与 server/services/scheduler.ts 保持同一策略：按优先级+截止时间贪心，避开已有安排，
// 工作时段 7:00-23:00，每连续 2 小时插入 15 分钟休息，单段上限 90 分钟。
import type { CalendarEvent, Priority, Todo } from '../types';

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
}

const WORK_START_HOUR = 7;
const WORK_END_HOUR = 23;
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
  const source = (event.source || '').toLowerCase();
  return !!source && source !== 'manual' && source !== 'ical';
}

export function isWithinWorkHours(dt: Date): boolean {
  const h = dt.getHours();
  return h >= WORK_START_HOUR && h < WORK_END_HOUR;
}

export function advanceToWorkHours(dt: Date): Date {
  const result = new Date(dt);
  if (result.getHours() >= WORK_END_HOUR) {
    result.setDate(result.getDate() + 1);
    result.setHours(WORK_START_HOUR, 0, 0, 0);
  } else if (result.getHours() < WORK_START_HOUR) {
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
  /** 允许"整段落在里面"的弹性时段（can_do_in_class 的课程） */
  flexibleSlots: BusySlot[] = []
): Date | null {
  let start = advanceToWorkHours(new Date(currentStart));
  const maxDate = deadline || new Date(start.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  let attempts = 0;
  const maxAttempts = 500;

  while (start < maxDate && attempts < maxAttempts) {
    attempts++;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    if (end.getHours() >= WORK_END_HOUR || !isWithinWorkHours(start)) {
      start.setDate(start.getDate() + 1);
      start.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }

    if (deadline && end > deadline) return null;

    let conflict = false;
    for (const slot of busySlots) {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      if (start < slotEnd && end > slotStart) {
        // 课内可做的待办：整段落在同一节课里就不算冲突，
        // 这样排出来的时间段会被日历的"融合"逻辑挂到课程上。
        const insideFlexible = flexibleSlots.some((f) => {
          const fStart = new Date(f.start);
          const fEnd = new Date(f.end);
          return start >= fStart && end <= fEnd;
        });
        if (insideFlexible) continue;
        conflict = true;
        start = advanceToWorkHours(new Date(Math.max(start.getTime(), slotEnd.getTime())));
        break;
      }
    }

    if (!conflict) return start;
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
      .map((e) => ({ start: e.start_time, end: e.end_time })),
    ...todos
      .filter((t) => t.status === 'scheduled' && t.scheduled_start && t.scheduled_end)
      .map((t) => ({ start: t.scheduled_start as string, end: t.scheduled_end as string })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const courseSlots: BusySlot[] = events
    .filter((e) => isClassEvent(e) && new Date(e.start_time) < scheduleEnd && new Date(e.end_time) > now)
    .map((e) => ({ start: e.start_time, end: e.end_time }));

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
    const flexibleSlots = todo.can_do_in_class ? courseSlots : [];

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

    const firstSlotStart = findNextFreeSlot(searchStart, segmentMinutes[0], newBusySlots, deadline, flexibleSlots);
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

      const segStart = findNextFreeSlot(
        new Date(newBusySlots[newBusySlots.length - 1].end),
        segmentMinutes[i],
        newBusySlots,
        deadline,
        flexibleSlots
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
    if (start.getHours() < WORK_START_HOUR || end.getHours() > WORK_END_HOUR) {
      errors.push(`超出工作时段：${item.title}`);
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
