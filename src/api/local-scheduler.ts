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
const HORIZON_DAYS = 30;

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
  deadline: Date | null
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
        conflict = true;
        start = advanceToWorkHours(new Date(Math.max(start.getTime(), slotEnd.getTime())));
        break;
      }
    }

    if (!conflict) return start;
  }

  return null;
}

/** 依据本地待办与日程生成排程方案；纯函数，便于测试 */
export function generateScheduleLocally(todos: Todo[], events: CalendarEvent[]): ScheduledItem[] {
  const now = new Date();
  const scheduleEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const pending = todos
    .filter((t) => t.status === 'pending')
    .sort((a, b) => {
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

  const result: ScheduledItem[] = [];
  const newBusySlots: BusySlot[] = [...busySlots];
  let continuousWorkMinutes = 0;

  for (const todo of pending) {
    const searchStart = new Date(now.getTime());
    const deadline = todo.deadline ? new Date(todo.deadline) : null;

    const segmentMinutes =
      todo.estimated_minutes > MAX_SEGMENT_MINUTES
        ? splitIntoSegments(todo.estimated_minutes, MAX_SEGMENT_MINUTES)
        : [todo.estimated_minutes];
    const totalSegments = segmentMinutes.length;

    if (continuousWorkMinutes >= BREAK_AFTER_MINUTES && newBusySlots.length > 0) {
      const breakStart = findNextFreeSlot(
        new Date(
          Math.max(
            ...newBusySlots.map((s) => new Date(s.end).getTime()),
            searchStart.getTime()
          )
        ),
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

    const firstSlotStart = findNextFreeSlot(searchStart, segmentMinutes[0], newBusySlots, deadline);
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
    continuousWorkMinutes += segmentMinutes[0];

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
        deadline
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
      continuousWorkMinutes += segmentMinutes[i];
    }
  }

  return result;
}

/** 校验排程方案：时间冲突、超出工作时段、越过截止时间 */
export function validateScheduleLocally(
  items: ScheduledItem[],
  todos: Todo[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const todoById = new Map(todos.map((t) => [t.id, t]));

  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      errors.push(`时间冲突：${sorted[i - 1].title} 与 ${sorted[i].title} 重叠`);
    }
  }

  for (const item of items) {
    const start = new Date(item.start);
    const end = new Date(item.end);
    if (start.getHours() < WORK_START_HOUR || end.getHours() > WORK_END_HOUR) {
      errors.push(`超出工作时段：${item.title}`);
    }
    // 大模型偶尔会返回已经过去的时段（尤其是没带时区偏移时），
    // 这种安排写进数据库就等于「排了但永远做不了」，必须拦下来
    if (end.getTime() < Date.now() - 5 * 60 * 1000) {
      errors.push(`时间已过去：${item.title}`);
    }
    const todo = todoById.get(item.todo_id);
    if (todo?.deadline && end > new Date(todo.deadline)) {
      errors.push(`超过截止时间：${item.title}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
