import { describe, it, expect } from 'vitest';
import { COURSE_PALETTE, colorForCourse } from './course-colors';

describe('colorForCourse', () => {
  it('同一门课每次取到同一个颜色', () => {
    expect(colorForCourse('电法勘探原理与方法')).toBe(colorForCourse('电法勘探原理与方法'));
  });

  it('颜色取自调色板', () => {
    expect(COURSE_PALETTE).toContain(colorForCourse('高等数学'));
  });

  it('不同课程能分到不同颜色（不是全挤在一个色）', () => {
    const courses = [
      '电法勘探原理与方法',
      '法治思维与法律行为',
      '地球物理测井原理',
      '重磁勘探原理与方法',
      '地震勘探原理与方法',
      'Matlab基础知识与应用',
    ];
    const used = new Set(courses.map(colorForCourse));
    expect(used.size).toBeGreaterThanOrEqual(4);
  });
});
