import { describe, it, expect } from 'vitest';
import { parseTimetableHtml, parseSemesterOptions, expandWeeks, sectionTime } from './cdut-parser';

const SAMPLE_HTML = `
<table>
<tr>
<td width="123" height="28" align="center" valign='top'>
  <div><font onmouseover='kbtc(this)' onmouseout='kbot(this)'>高等数学</font></div>
  <font title='教师' onmouseover='kbtc(this)' onmouseout='kbot(this)'>张三</font>
  <font title='周次(节次)' onmouseover='kbtc(this)' onmouseout='kbot(this)'>1-16周[1-2节]</font>
  <font title='教学楼' name='jxlmc' style='display:none;' onmouseover='kbtc(this)' onmouseout='kbot(this)'>六教</font>
  <font title='教室' onmouseover='kbtc(this)' onmouseout='kbot(this)'>A201</font>
</td>
<td width="123" height="28" align="center" valign='top'></td>
<td width="123" height="28" align="center" valign='top'>
  <div><font onmouseover='kbtc(this)' onmouseout='kbot(this)'>大学英语</font></div>
  <font title='教师' onmouseover='kbtc(this)' onmouseout='kbot(this)'>李四</font>
  <font title='周次(节次)' onmouseover='kbtc(this)' onmouseout='kbot(this)'>2-8,10-16周[3-4节]</font>
  <font title='教学楼' name='jxlmc' style='display:none;' onmouseover='kbtc(this)' onmouseout='kbot(this)'>五教</font>
  <font title='教室' onmouseover='kbtc(this)' onmouseout='kbot(this)'>B301</font>
</td>
</tr>
</table>
`;

describe('cdut-parser', () => {
  it('parses two courses from sample HTML', () => {
    const courses = parseTimetableHtml(SAMPLE_HTML);
    expect(courses).toHaveLength(2);
    expect(courses[0].name).toBe('高等数学');
    expect(courses[0].teacher).toBe('张三');
    expect(courses[0].weeks).toBe('1-16周');
    expect(courses[0].sections).toBe('1-2节');
    expect(courses[0].location).toBe('六教 - A201');
    expect(courses[0].dayOfWeek).toBe(1);
    expect(courses[0].sectionIndex).toBe(0);
    expect(courses[1].name).toBe('大学英语');
    expect(courses[1].dayOfWeek).toBe(3);
    expect(courses[1].sectionIndex).toBe(0);
  });

  it('returns empty for empty HTML', () => {
    expect(parseTimetableHtml('')).toHaveLength(0);
  });

  it('parses semester options', () => {
    const html = '<option value="">2024-2025-1</option><option value="2024-2025-1">2024-2025 第一学期</option><option value="2024-2025-2">2024-2025 第二学期</option>';
    expect(parseSemesterOptions(html)).toEqual(['2024-2025-1', '2024-2025-2']);
  });

  it('expands week ranges', () => {
    expect(expandWeeks('1-16周')).toEqual(Array.from({length:16},(_,i)=>i+1));
    expect(expandWeeks('1-8,10-16周')).toEqual([1,2,3,4,5,6,7,8,10,11,12,13,14,15,16]);
    expect(expandWeeks('1,3,5周')).toEqual([1,3,5]);
    expect(expandWeeks('')).toEqual([]);
  });

  it('computes section time', () => {
    const d = new Date(2025, 0, 6); // Monday
    const t = sectionTime(0, d);
    expect(t.start).toContain('T00:10:00');
    expect(t.end).toContain('T01:45:00');
  });
});
