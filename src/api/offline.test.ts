import { describe, it, expect } from 'vitest';
import type { Todo } from '../types';
import {
  localCreate,
  localUpdate,
  localSplit,
  localDelete,
  isOnline,
} from './offline';

function makeTodo(overrides?: Partial<Todo>): Todo {
  return {
    id: 1,
    title: 'test',
    description: null,
    estimated_minutes: 30,
    priority: 'normal' as any,
    urgency: 2,
    importance: 2,
    deadline: null,
    status: 'pending' as any,
    scheduled_start: null,
    scheduled_end: null,
    color: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('localCreate', () => {
  it('fills defaults for missing fields', () => {
    const todo = localCreate({ title: '买牛奶' });
    expect(todo.title).toBe('买牛奶');
    expect(todo.estimated_minutes).toBe(30);
    expect(todo.status).toBe('pending');
    expect(todo.priority).toBe('normal');
    expect(typeof todo.id).toBe('number');
  });

  it('respects provided fields', () => {
    const todo = localCreate({ title: 'x', estimated_minutes: 90, urgency: 2, importance: 3 });
    expect(todo.estimated_minutes).toBe(90);
    expect(todo.priority).toBe('important'); // urgency<3 so important (importance>=3)
  });
});

describe('localUpdate', () => {
  it("sets completed_at when status becomes done", () => {
    const todo = localUpdate(makeTodo(), { status: 'done' as any });
    expect(todo.status).toBe('done');
    expect(todo.completed_at).not.toBeNull();
    expect(new Date(todo.completed_at!).getTime() > Date.now() - 5000).toBe(true);
  });

  it("resets completed_at to null when reopened", () => {
    const doneTodo = localUpdate(makeTodo(), { status: 'done' as any });
    const reopened = localUpdate(doneTodo, { status: 'pending' as any });
    expect(reopened.completed_at).toBeNull();
  });

  it('merges other fields without clobbering', () => {
    const todo = localUpdate(makeTodo(), { title: 'updated', color: '#ff0000' });
    expect(todo.title).toBe('updated');
    expect(todo.color).toBe('#ff0000');
    expect(todo.id).toBe(1);
  });
});

describe('localSplit', () => {
  it('replaces one todo with original + N-1 split todos', () => {
    const todo = makeTodo();
    const result = localSplit(todo, [
      { start: '2026-09-23T09:00:00Z', end: '2026-09-23T10:00:00Z' },
      { start: '2026-09-23T10:15:00Z', end: '2026-09-23T11:00:00Z' },
    ]);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(todo.id);
    expect(result[0].status).toBe('scheduled');
    expect(result[1].title).toContain('(2/2)');
    expect(result[1].estimated_minutes).toBe(45);
  });

  it('single segment just schedules the original', () => {
    const todo = makeTodo();
    const result = localSplit(todo, [
      { start: '2026-09-23T09:00:00Z', end: '2026-09-23T10:00:00Z' },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(todo.id);
  });
});

describe('localDelete', () => {
  it('removes the matching todo', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })];
    const result = localDelete(todos, 1);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(2);
  });
});

describe('isOnline', () => {
  it('returns true when navigator undefined (node env)', () => {
    expect(isOnline()).toBe(true);
  });
});
