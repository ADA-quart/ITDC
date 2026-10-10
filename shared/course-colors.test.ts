import { describe, it, expect } from 'vitest';
import { assignCourseColors, COURSE_PALETTE, colorForCourse, textColorFor } from './course-colors';

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

  it('亮底配深字、深底配白字（亮色课块也能看清字）', () => {
    expect(textColorFor('#ffd666')).not.toBe('#ffffff'); // 浅金
    expect(textColorFor('#69c0ff')).not.toBe('#ffffff'); // 浅蓝
    expect(textColorFor('#ffadd2')).not.toBe('#ffffff'); // 浅粉
    expect(textColorFor('#bae637')).not.toBe('#ffffff'); // 黄绿
    expect(textColorFor('#2f54eb')).toBe('#ffffff');      // 深蓝
    expect(textColorFor('#722ed1')).toBe('#ffffff');      // 深紫
    expect(textColorFor('不是颜色')).toBe('#ffffff');      // 兜底
  });
});
