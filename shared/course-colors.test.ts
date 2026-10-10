import { describe, it, expect } from 'vitest';
import {
  assignCourseColors,
  COURSE_INK,
  COURSE_PALETTE,
  colorForCourse,
  contrastRatio,
  courseTextColor,
  readableTextColor,
} from './course-colors';

describe('assignCourseColors（一套课表内不撞色）', () => {
  // 实测撞过色的两组：电法/法治 都是橙色，工程勘察/地震勘探 都是蓝色
  const courses = [
    '电法勘探原理与方法',
    '法治思维与法律行为',
    '工程勘察与检测',
    '地震勘探原理与方法',
    '重磁勘探原理与方法',
    '地球物理测井原理',
  ];

  it('调色板够用时，不同课程颜色互不相同', () => {
    const map = assignCourseColors(courses);
    const colors = [...map.values()];
    expect(new Set(colors).size).toBe(courses.length);
  });

  it('顺序打乱不影响结果（同名稳定、跨周稳定）', () => {
    const a = assignCourseColors(courses);
    const b = assignCourseColors([...courses].reverse());
    for (const name of courses) expect(b.get(name)).toBe(a.get(name));
  });

  it('课程数超过调色板时也不崩：全部有颜色，重复次数最小', () => {
    const many = Array.from({ length: COURSE_PALETTE.length + 5 }, (_, i) => `课程${i}`);
    const map = assignCourseColors(many);
    expect(map.size).toBe(many.length);
    expect(new Set(map.values()).size).toBe(COURSE_PALETTE.length);
  });

  it('空名/重复名不会占色', () => {
    const map = assignCourseColors(['', '  ', '高数', '高数']);
    expect([...map.keys()]).toEqual(['高数']);
  });

  it('单独取色仍是稳定哈希（不依赖整套课表的地方继续可用）', () => {
    expect(colorForCourse('高数')).toBe(colorForCourse('高数'));
  });

  it('课程色 18 种起步，且每一种配自动字色都达 WCAG AA 正文（≥4.5:1）', () => {
    expect(COURSE_PALETTE.length).toBeGreaterThanOrEqual(18);
    for (const hex of COURSE_PALETTE) {
      const ink = readableTextColor(hex);
      const ratio = contrastRatio(hex, ink);
      expect(ratio, `${hex} 配 ${ink} 只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('明亮底色用石墨灰字，深色底自动回白字', () => {
    expect(readableTextColor('#ffccc7')).toBe(COURSE_INK);
    expect(readableTextColor('#1d4ed8')).toBe('#fff');
  });

  it('字色档位：白/黑档直出，灰档保留智能兜底', () => {
    expect(courseTextColor('#facc15', 'white')).toBe('#ffffff');
    expect(courseTextColor('#facc15', 'black')).toBe('#000000');
    expect(courseTextColor('#facc15', 'ink')).toBe(COURSE_INK);
    // 灰档遇到用户自选的深色底仍然自动切白，不会把灰字压上去
    expect(courseTextColor('#1d4ed8', 'ink')).toBe('#fff');
  });
});
