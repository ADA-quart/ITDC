import db from '../db/index.js';

export interface ScheduledItem {
  todo_id: number;
  title: string;
  start: string;
  end: string;
  priority: string;
}

interface BusySlot {
  start: string;
  end: string;
}

interface TodoItem {
  id: number;
  title: string;
  estimated_minutes: number;
  priority: string;
  urgency: number;
  importance: number;
  can_do_in_class: number | null;
  deadline: string | null;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
}

const WORK_START_HOUR = 7;
const WORK_END_HOUR = 23;
const BREAK_AFTER_MINUTES = 120;
const BREAK_DURATION_MINUTES = 15;
const MAX_SEGMENT_MINUTES = 90;
const MIN_SEGMENT_MINUTES = 15;

/** 课程判定：source 为学校 id（如 cdut）的是教务课表，manual/ical 不是课程 */
export function isClassSource(source: string | null | undefined): boolean {
  const s = (source || '').toLowerCase();
  return !!s && s !== 'manual' && s !== 'ical';
}

function getBusySlots(startDate: Date, endDate: Date): BusySlot[] {
  const events = db.prepare(
    'SELECT start_time, end_time FROM events WHERE start_time < ? AND end_time > ?'
  ).all(endDate.toISOString(), startDate.toISOString()) as { start_time: string; end_time: string }[];

  const scheduledTodos = db.prepare(
    "SELECT scheduled_start, scheduled_end FROM todos WHERE status = 'scheduled' AND scheduled_start IS NOT NULL AND scheduled_start < ? AND scheduled_end > ?"
  ).all(endDate.toISOString(), startDate.toISOString()) as { scheduled_start: string; scheduled_end: string }[];

  const busy: BusySlot[] = [
    ...events.map(e => ({ start: e.start_time, end: e.end_time })),
    ...scheduledTodos.map(t => ({ start: t.scheduled_start!, end: t.scheduled_end! })),
  ];

  return busy.sort((a, b) => a.start.localeCompare(b.start));
}

function getCourseSlots(startDate: Date, endDate: Date): BusySlot[] {
  const events = db.prepare(
    'SELECT start_time, end_time, source FROM events WHERE start_time < ? AND end_time > ?'
  ).all(endDate.toISOString(), startDate.toISOString()) as { start_time: string; end_time: string; source: string | null }[];
  return events
    .filter((e) => isClassSource(e.source))
    .map((e) => ({ start: e.start_time, end: e.end_time }));
}

/**
 * 排程开始前已经连续忙了多久（课程/日程也计入）。
 * 只看刚结束 30 分钟内、最近 6 小时的忙碌串；间隔 ≥15 分钟视为已经休息。
 */
function workStreakBefore(busySlots: BusySlot[], now: Date): { minutes: number; end: Date | null } {
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

/** Insert a busy slot into sorted array using binary search — O(n) instead of O(n log n) per insert */
function insertBusySlot(slots: BusySlot[], slot: BusySlot): void {
  let lo = 0, hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid].start < slot.start) lo = mid + 1;
    else hi = mid;
  }
  slots.splice(lo, 0, slot);
}

function getPendingTodos(): TodoItem[] {
  return db.prepare(
    "SELECT * FROM todos WHERE status = 'pending' ORDER BY CASE priority WHEN 'urgent-important' THEN 1 WHEN 'important' THEN 2 WHEN 'urgent' THEN 3 WHEN 'normal' THEN 4 END, CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, created_at DESC"
  ).all() as TodoItem[];
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

export function findNextFreeSlot(
  currentStart: Date,
  durationMinutes: number,
  busySlots: BusySlot[],
  deadline: Date | null,
  flexibleSlots: BusySlot[] = []
): Date | null {
  let start = new Date(currentStart);
  start = advanceToWorkHours(start);

  const maxDate = deadline || new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);

  let attempts = 0;
  const maxAttempts = 500;

  while (start < maxDate && attempts < maxAttempts) {
    attempts++;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    if (end.getHours() >= WORK_END_HOUR || !isWithinWorkHours(start)) {
      start = new Date(start);
      start.setDate(start.getDate() + 1);
      start.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }

    if (deadline && end > deadline) {
      return null;
    }

    let conflict = false;
    for (const slot of busySlots) {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      if (start < slotEnd && end > slotStart) {
        // can_do_in_class 的待办允许整段落在课程里（之后会融合进课程）
        const insideFlexible = flexibleSlots.some((f) => {
          const fStart = new Date(f.start);
          const fEnd = new Date(f.end);
          return start >= fStart && end <= fEnd;
        });
        if (insideFlexible) continue;
        conflict = true;
        start = new Date(Math.max(start.getTime(), slotEnd.getTime()));
        start = advanceToWorkHours(start);
        break;
      }
    }

    if (!conflict) {
      return start;
    }
  }

  return null;
}

export function generateSchedule(): ScheduledItem[] {
  const now = new Date();
  const scheduleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const todos = getPendingTodos();
  const busySlots = getBusySlots(now, scheduleEnd);
  const courseSlots = getCourseSlots(now, scheduleEnd);
  const result: ScheduledItem[] = [];
  const newBusySlots: BusySlot[] = [...busySlots];
  const streak = workStreakBefore(busySlots, now);
  let continuousWorkMinutes = streak.minutes;
  // 与客户端同一处修正：休息接在「刚干完的那一段」之后，
  // 而不是所有忙碌块里最晚的结束时间（日历有远期事件时会落到几天后）
  let lastWorkEnd: Date | null = streak.end;

  const noteWork = (start: Date, minutes: number) => {
    if (lastWorkEnd && start.getTime() - lastWorkEnd.getTime() >= BREAK_DURATION_MINUTES * 60 * 1000) {
      continuousWorkMinutes = 0;
    }
    continuousWorkMinutes += minutes;
    lastWorkEnd = new Date(start.getTime() + minutes * 60 * 1000);
  };

  for (const todo of todos) {
    const searchStart = new Date(now.getTime());
    const deadline = todo.deadline ? new Date(todo.deadline) : null;
    const flexibleSlots = todo.can_do_in_class ? courseSlots : [];

    const needsSplit = todo.estimated_minutes > MAX_SEGMENT_MINUTES;
    const segmentMinutes = needsSplit
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
        insertBusySlot(newBusySlots, { start: breakStart.toISOString(), end: breakEnd.toISOString() });
      }
      continuousWorkMinutes = 0;
    }

    const firstSlotStart = findNextFreeSlot(searchStart, segmentMinutes[0], newBusySlots, deadline, flexibleSlots);

    if (!firstSlotStart) continue;

    const firstSlotEnd = new Date(firstSlotStart.getTime() + segmentMinutes[0] * 60 * 1000);

    const segmentTitle = totalSegments > 1
      ? `${todo.title} (1/${totalSegments})`
      : todo.title;

    result.push({
      todo_id: todo.id,
      title: segmentTitle,
      start: firstSlotStart.toISOString(),
      end: firstSlotEnd.toISOString(),
      priority: todo.priority,
    });

    insertBusySlot(newBusySlots, { start: firstSlotStart.toISOString(), end: firstSlotEnd.toISOString() });
    noteWork(firstSlotStart, segmentMinutes[0]);

    for (let i = 1; i < segmentMinutes.length; i++) {
      const breakStart = findNextFreeSlot(
        new Date(newBusySlots[newBusySlots.length - 1].end),
        BREAK_DURATION_MINUTES,
        newBusySlots,
        deadline
      );
      if (breakStart) {
        const breakEnd = new Date(breakStart.getTime() + BREAK_DURATION_MINUTES * 60 * 1000);
        insertBusySlot(newBusySlots, { start: breakStart.toISOString(), end: breakEnd.toISOString() });
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

export function splitIntoSegments(totalMinutes: number, maxPerSegment: number): number[] {
  const segments: number[] = [];
  let remaining = totalMinutes;
  while (remaining > maxPerSegment) {
    const restAfterFull = remaining - maxPerSegment;
    if (restAfterFull < MIN_SEGMENT_MINUTES) {
      segments.push(maxPerSegment - (MIN_SEGMENT_MINUTES - restAfterFull));
      remaining = MIN_SEGMENT_MINUTES;
      break;
    }
    segments.push(maxPerSegment);
    remaining -= maxPerSegment;
  }
  if (remaining > 0) {
    segments.push(remaining);
  }
  return segments;
}
