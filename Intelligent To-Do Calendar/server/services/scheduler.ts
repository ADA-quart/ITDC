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

function isWithinWorkHours(dt: Date): boolean {
  const h = dt.getHours();
  return h >= WORK_START_HOUR && h < WORK_END_HOUR;
}

function advanceToWorkHours(dt: Date): Date {
  const result = new Date(dt);
  if (result.getHours() >= WORK_END_HOUR) {
    result.setDate(result.getDate() + 1);
    result.setHours(WORK_START_HOUR, 0, 0, 0);
  } else if (result.getHours() < WORK_START_HOUR) {
    result.setHours(WORK_START_HOUR, 0, 0, 0);
  }
  return result;
}

function findNextFreeSlot(
  currentStart: Date,
  durationMinutes: number,
  busySlots: BusySlot[],
  deadline: Date | null
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
  const result: ScheduledItem[] = [];
  const newBusySlots: BusySlot[] = [...busySlots];
  let continuousWorkMinutes = 0;

  for (const todo of todos) {
    const searchStart = new Date(now.getTime());
    const deadline = todo.deadline ? new Date(todo.deadline) : null;

    const needsSplit = todo.estimated_minutes > MAX_SEGMENT_MINUTES;
    const segmentMinutes = needsSplit
      ? splitIntoSegments(todo.estimated_minutes, MAX_SEGMENT_MINUTES)
      : [todo.estimated_minutes];
    const totalSegments = segmentMinutes.length;

    if (continuousWorkMinutes >= BREAK_AFTER_MINUTES) {
      const breakStart = findNextFreeSlot(
        new Date(Math.max(...newBusySlots.map(s => new Date(s.end).getTime()), searchStart.getTime())),
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

    const firstSlotStart = findNextFreeSlot(searchStart, segmentMinutes[0], newBusySlots, deadline);

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
    continuousWorkMinutes += segmentMinutes[0];

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

function splitIntoSegments(totalMinutes: number, maxPerSegment: number): number[] {
  const segments: number[] = [];
  let remaining = totalMinutes;
  while (remaining > maxPerSegment) {
    segments.push(maxPerSegment);
    remaining -= maxPerSegment;
  }
  if (remaining > 0) {
    segments.push(remaining);
  }
  return segments;
}
