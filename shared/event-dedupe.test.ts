import { describe, it, expect } from 'vitest';
import { dedupeEvents } from './event-dedupe';

const base = {
  title: '重磁勘探原理与方法',
  start_time: '2026-10-08T06:30:00.000Z',
  end_time: '2026-10-08T08:05:00.000Z',
  location: 'E1B205',
};

describe('dedupeEvents', () => {
  it('同一门课跨日历重复时只保留一条，教务优先', () => {
    const result = dedupeEvents([
      { ...base, source: 'ical' },
      { ...base, source: 'cdut' },
      { ...base, source: 'ical' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('cdut');
  });

  it('教室不同不合并（单双周不同教室）', () => {
    const result = dedupeEvents([
      { ...base, source: 'cdut' },
      { ...base, location: 'E1A310', source: 'cdut' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('时间不同不合并', () => {
    const result = dedupeEvents([
      { ...base, source: 'cdut' },
      { ...base, start_time: '2026-10-08T08:25:00.000Z', end_time: '2026-10-08T10:00:00.000Z', source: 'cdut' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('教室大小写与空格差异视为同一间', () => {
    const result = dedupeEvents([
      { ...base, location: ' e1b205 ', source: 'ical' },
      { ...base, location: 'E1B205', source: 'cdut' },
    ]);
    expect(result).toHaveLength(1);
  });

  it('「【东区1教】 - E1B205」与「E1B205」视为同一间教室', () => {
    const result = dedupeEvents([
      { ...base, location: '【东区1教】 - E1B205', source: 'cdut' },
      { ...base, location: 'E1B205', source: 'ical' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('cdut');
  });

  it('「E1B214(智慧)」与「E1B214」视为同一间教室', () => {
    const result = dedupeEvents([
      { ...base, location: 'E1B214(智慧)', source: 'cdut' },
      { ...base, location: 'E1B214', source: 'ical' },
    ]);
    expect(result).toHaveLength(1);
  });
});
