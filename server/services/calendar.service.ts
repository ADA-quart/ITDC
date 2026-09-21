import db from '../db/index.js';
import { parseIcsFile } from './ical-parser.js';
import { debug } from '../utils/debug.js';

/** Calendar & event data access (no Express). */

// ---------------- Calendars ----------------

export function getCalendars(): any[] {
  return db.prepare('SELECT * FROM calendars ORDER BY created_at DESC').all();
}

export function createCalendar(name: string, color?: string): any {
  const result = db.prepare('INSERT INTO calendars (name, color) VALUES (?, ?)').run(name, color || '#1890ff');
  return db.prepare('SELECT * FROM calendars WHERE id = ?').get(result.lastInsertRowid);
}

export function findCalendar(id: number): any {
  return db.prepare('SELECT id FROM calendars WHERE id = ?').get(id);
}

/** Delete a calendar and all its events. Returns false if the calendar did not exist. */
export function deleteCalendar(id: number): boolean {
  const calendar = db.prepare('SELECT id FROM calendars WHERE id = ?').get(id);
  if (!calendar) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM events WHERE calendar_id = ?').run(id);
    db.prepare('DELETE FROM calendars WHERE id = ?').run(id);
  });
  // transaction() has already called markDirty(); explicit save ensures immediate persistence
  db.save();
  return true;
}

/** ---------------- Events ---------------- */

export function getEvents(start?: string, end?: string): any[] {
  if (start && end) {
    return db.prepare(
      'SELECT e.*, c.name as calendar_name, c.color as calendar_color FROM events e JOIN calendars c ON e.calendar_id = c.id WHERE e.start_time < ? AND e.end_time > ? ORDER BY e.start_time'
    ).all(end, start);
  }
  return db.prepare(
    'SELECT e.*, c.name as calendar_name, c.color as calendar_color FROM events e JOIN calendars c ON e.calendar_id = c.id ORDER BY e.start_time DESC'
  ).all();
}

export interface CreateEventInput {
  title: string;
  calendar_id: number;
  start_time: string;
  end_time: string;
  description?: string | null;
  rrule?: string | null;
  location?: string | null;
}

export function createEvent(input: CreateEventInput): any {
  const result = db.prepare(
    'INSERT INTO events (calendar_id, title, description, start_time, end_time, rrule, location) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    input.calendar_id,
    input.title,
    input.description ?? null,
    input.start_time,
    input.end_time,
    input.rrule ?? null,
    input.location ?? null
  );
  return db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  start_time?: string;
  end_time?: string;
  rrule?: string | null;
  location?: string | null;
  calendar_id?: number;
}

export function updateEvent(id: number, input: UpdateEventInput): any {
  const fields: string[] = [];
  const values: any[] = [];
  if (input.title !== undefined) { fields.push('title = ?'); values.push(input.title); }
  if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
  if (input.start_time !== undefined) { fields.push('start_time = ?'); values.push(input.start_time); }
  if (input.end_time !== undefined) { fields.push('end_time = ?'); values.push(input.end_time); }
  if (input.rrule !== undefined) { fields.push('rrule = ?'); values.push(input.rrule); }
  if (input.location !== undefined) { fields.push('location = ?'); values.push(input.location); }
  if (input.calendar_id !== undefined) { fields.push('calendar_id = ?'); values.push(input.calendar_id); }
  if (fields.length === 0) return db.prepare('SELECT * FROM events WHERE id = ?').get(id);

  // Validate that start time is before end time (merging with existing row when only one side is provided)
  if (input.start_time !== undefined || input.end_time !== undefined) {
    const current = db.prepare('SELECT start_time, end_time FROM events WHERE id = ?').get(id) as { start_time: string; end_time: string } | undefined;
    if (current) {
      const finalStart = input.start_time ?? current.start_time;
      const finalEnd = input.end_time ?? current.end_time;
      if (new Date(finalEnd) <= new Date(finalStart)) {
        throw new Error('结束时间必须晚于开始时间');
      }
    }
  }

  values.push(id);
  db.prepare(`UPDATE events SET ${fields.join(' , ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

export function deleteEvent(id: number): void {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

/** ---------------- iCal import ---------------- */

export interface ImportResult {
  calendar_id: number;
  imported_count: number;
}

/** Parse and persist an iCal buffer into a new dedicated calendar. Returns null if no valid events were found. */
export function importIcs(buffer: Buffer, calendarName: string, calendarColor: string): ImportResult | null {
  const icsContent = buffer.toString('utf-8');
  const parsedEvents = parseIcsFile(icsContent);

  if (parsedEvents.length === 0) {
    return null;
  }

  debug.info('iCal import', { calendarName, eventCount: parsedEvents.length });

  const calendarResult = db.prepare("INSERT INTO calendars (name, color, source) VALUES (?, ?, 'ical')").run(calendarName, calendarColor);

  const calendarId = calendarResult.lastInsertRowid;

  const insertStmt = db.prepare(
    'INSERT INTO events (calendar_id, title, description, start_time, end_time, rrule, location, source, uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const importedCount = db.transaction(() => {
    let count = 0;
    for (const ev of parsedEvents) {
      insertStmt.run(
        calendarId,
        ev.title,
        ev.description ?? null,
        ev.startTime,
        ev.endTime,
        ev.rrule ?? null,
        ev.location ?? null,
        'ical',
        ev.uid
      );
      count++;
    }
    return count;
  });

  db.save();
  debug.info('iCal import success', { importedCount });
  return { calendar_id: calendarId, imported_count: importedCount };
}
