import { describe, it, expect } from 'vitest';
import { parseTimetableHtml, parseSemesterOptions, expandWeeks, sectionTime, looksLikeCourse } from './cdut-parser';

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

  // 真实教务页面：一个格子里会并排多条课程记录（---------- 分隔），
  // 而且每条记录在「隐藏简版块」里还重复一遍（没有 [节次]，应当忽略）。
  // 老实现只取格子里第一条，导致同一时段其它课整门消失。
  it('parses every entry in a cell with multiple stacked courses', () => {
    const html = `
<table><tr><td width="123" height="28" align="center" valign='top'>
  <div id="X-2-1" style="display: none;position: relative" class="kbcontent1">
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)'>地球物理测井原理</font><br/>
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)' title='周次(节次)'>1-5(周)</font><br/>
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)' title='教室'>E1B203</font><br/>
    <br/>----------------------<br>
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)'>电法勘探原理与方法</font><br/>
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)' title='周次(节次)'>7(周)</font><br/>
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)' title='教室'>5113</font><br/>
  </div>
  <div id="X-2-2" style="display: none;position: relative" class="kbcontent">
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)'>地球物理测井原理</font><br/>
    <font title='教师' onmouseover='kbtc(this)' onmouseout='kbot(this)'>刘爱疆</font><br/>
    <font title='周次(节次)' onmouseover='kbtc(this)' onmouseout='kbot(this)' >1-5(周)[07-08节]</font><br/>
    <font title='教学楼' name='jxlmc' style='display:none;' onmouseover='kbtc(this)' onmouseout='kbot(this)' >【东区1教】</font><font title='教室' onmouseover='kbtc(this)' onmouseout='kbot(this)' >E1B203</font><br/>
    ---------------------<br>
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)'>电法勘探原理与方法</font><br/>
    <font title='教师' onmouseover='kbtc(this)' onmouseout='kbot(this)'>闵刚</font><br/>
    <font title='周次(节次)' onmouseover='kbtc(this)' onmouseout='kbot(this)' >7(周)[07-08节]</font><br/>
    <font title='教学楼' name='jxlmc' style='display:none;' onmouseover='kbtc(this)' onmouseout='kbot(this)' >【教学5楼】</font><font title='教室' onmouseover='kbtc(this)' onmouseout='kbot(this)' >5113</font><br/>
    ---------------------<br>
    <font onmouseover='kbtc(this)' onmouseout='kbot(this)'>电法勘探原理与方法</font><br/>
    <font title='教师' onmouseover='kbtc(this)' onmouseout='kbot(this)'>闵刚</font><br/>
    <font title='周次(节次)' onmouseover='kbtc(this)' onmouseout='kbot(this)' >10(周)[07-08节]</font><br/>
    <font title='教室' onmouseover='kbtc(this)' onmouseout='kbot(this)' >5417</font><br/>
  </div>
</td></tr></table>`;
    const courses = parseTimetableHtml(html);
    // 简版块被忽略（没有 [节次]），完整块里的三条都保留
    expect(courses.map((c) => `${c.name}@${c.weeks}`)).toEqual([
      '地球物理测井原理@1-5(周)',
      '电法勘探原理与方法@7(周)',
      '电法勘探原理与方法@10(周)',
    ]);
    expect(courses[0].teacher).toBe('刘爱疆');
    expect(courses[0].location).toBe('【东区1教】 - E1B203');
    expect(courses[1].location).toBe('【教学5楼】 - 5113');
    expect(courses[1].teacher).toBe('闵刚');
  });

  it('parses several week ranges inside one entry', () => {
    const html = `
<table><tr><td width="123" height="28" align="center" valign='top'>
  <font onmouseover='kbtc(this)' onmouseout='kbot(this)'>Matlab基础知识与应用</font>
  <font title='教师' onmouseover='kbtc(this)' onmouseout='kbot(this)'>刘炜</font>
  <font title='周次(节次)' onmouseover='kbtc(this)' onmouseout='kbot(this)' >9-11(周)[09-10节]</font>
  <font title='周次(节次)' onmouseover='kbtc(this)' onmouseout='kbot(this)' >12-14(周)[09-10节]</font>
  <font title='教室' onmouseover='kbtc(this)' onmouseout='kbot(this)'>E2B202</font>
</td></tr></table>`;
    const courses = parseTimetableHtml(html);
    expect(courses.map((c) => c.weeks)).toEqual(['9-11(周)', '12-14(周)']);
  });

  it('parses semester options', () => {
    const html = '<option value="">2024-2025-1</option><option value="2024-2025-1">2024-2025 第一学期</option><option value="2024-2025-2">2024-2025 第二学期</option>';
    expect(parseSemesterOptions(html)).toEqual(['2024-2025-1', '2024-2025-2']);
  });

  it('expands week ranges', () => {
    expect(expandWeeks('1-16周')).toEqual(Array.from({length:16},(_,i)=>i+1));
    expect(expandWeeks('1-8,10-16周')).toEqual([1,2,3,4,5,6,7,8,10,11,12,13,14,15,16]);
    expect(expandWeeks('1,3,5周')).toEqual([1,3,5]);
    expect(expandWeeks('3-5,7-16(周)')).toEqual([3,4,5,7,8,9,10,11,12,13,14,15,16]);
    expect(expandWeeks('12-15(周)')).toEqual([12,13,14,15]);
    expect(expandWeeks('')).toEqual([]);
  });

  it('computes section time', () => {
    const d = new Date(2025, 0, 6); // Monday
    const t = sectionTime(0, d);
    const start = new Date(t.start);
    const end = new Date(t.end);
    // 断言本地时间字段而非 UTC 字符串，跨时区 runner 一致
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(6);
    expect(start.getHours()).toBe(8);
    expect(start.getMinutes()).toBe(10);
    expect(end.getHours()).toBe(9);
    expect(end.getMinutes()).toBe(45);
  });

  it('教务事件与"带教室且对齐节次"的 iCal 事件算课程', () => {
    const cdut = { source: 'cdut', start_time: new Date(2026, 9, 8, 14, 30).toISOString(), end_time: new Date(2026, 9, 8, 16, 5).toISOString(), location: 'E1B205' };
    expect(looksLikeCourse(cdut)).toBe(true);

    const icalCourse = { source: 'ical', start_time: new Date(2026, 9, 8, 14, 30).toISOString(), end_time: new Date(2026, 9, 8, 16, 5).toISOString(), location: 'E1B205' };
    expect(looksLikeCourse(icalCourse)).toBe(true);

    // 普通 iCal 日程：没有教室，或时间不对齐节次，都不算课程
    expect(looksLikeCourse({ ...icalCourse, location: null })).toBe(false);
    expect(looksLikeCourse({ ...icalCourse, start_time: new Date(2026, 9, 8, 14, 10).toISOString() })).toBe(false);
    expect(looksLikeCourse({ ...icalCourse, source: 'manual' })).toBe(false);
  });
});
