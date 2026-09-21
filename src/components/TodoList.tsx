import React, { useEffect, useState, useCallback } from 'react';
import { List, Tag, Button, Modal, message, Badge, Empty, Spin, ColorPicker } from 'antd';
import { DeleteOutlined, EditOutlined, SplitCellsOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { todoApi, scheduleApi } from '../api/client';
import type { Todo, Priority, TodoStatus } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, TODO_PALETTE } from '../types';
import { getDeadlineCountdown } from '../utils/priority';
import TodoForm from './TodoForm';
import TodoSplitModal from './TodoSplitModal';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';

const STATUS_KEYS: Record<string, string> = {
  pending: 'pending',
  scheduled: 'scheduled',
  done: 'done',
};

const TodoList: React.FC = () => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [filterStatus, setFilterStatus] = useState<TodoStatus | undefined>(undefined);
  const [splitTodo, setSplitTodo] = useState<Todo | null>(null);

  const statusLabels: Record<TodoStatus, string> = {
    pending: t.todo.pending,
    scheduled: t.todo.scheduled,
    done: t.todo.done,
  };

  const priorityLabels: Record<Priority, string> = {
    'urgent-important': t.priority.urgentImportant,
    'important': t.priority.important,
    'urgent': t.priority.urgent,
    'normal': t.priority.normal,
  };

  const loadTodos = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterStatus) params.status = filterStatus;
      const data = await todoApi.getAll(params);
      setTodos(data);
    } catch {
      message.error(t.todo.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: t.todo.deleteTodo,
      content: t.todo.confirmDelete,
      okText: t.todo.delete,
      cancelText: t.todo.cancel,
      onOk: async () => {
        await todoApi.delete(id);
        message.success(t.todo.deleted);
        loadTodos();
      },
    });
  };

  const handleToggleDone = async (todo: Todo) => {
    const newStatus = todo.status === 'done' ? 'pending' : 'done';
    await todoApi.update(todo.id, { status: newStatus as TodoStatus });
    loadTodos();
  };

  const handleColorChange = async (todo: Todo, color: string) => {
    await todoApi.update(todo.id, { color });
    loadTodos();
  };

  const getTodoColor = (todo: Todo): string => {
    if (todo.color) return todo.color;
    return TODO_PALETTE[todo.id % TODO_PALETTE.length];
  };

  const groupByPriority = (list: Todo[]): Record<Priority, Todo[]> => {
    const groups: Record<Priority, Todo[]> = {
      'urgent-important': [],
      'important': [],
      'urgent': [],
      'normal': [],
    };
    for (const tItem of list) {
      groups[tItem.priority].push(tItem);
    }
    return groups;
  };

  const groups = groupByPriority(todos);

  const filterButtons: { key: TodoStatus | undefined; label: string }[] = [
    { key: undefined, label: t.todo.all },
    { key: 'pending', label: t.todo.pending },
    { key: 'scheduled', label: t.todo.scheduled },
    { key: 'done', label: t.todo.done },
  ];

  return (
    <div style={{ background: isDark ? '#1f1f1f' : '#fff', padding: 24, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {filterButtons.map(btn => (
            <Button
              key={String(btn.key)}
              type={filterStatus === btn.key ? 'primary' : 'default'}
              size="small"
              onClick={() => setFilterStatus(btn.key)}
            >
              {btn.label}
            </Button>
          ))}
        </div>
        <Button type="primary" onClick={() => { setEditingTodo(null); setFormVisible(true); }}>
          {t.todo.newTodo}
        </Button>
      </div>

      <Spin spinning={loading}>
        {todos.length === 0 ? (
          <Empty description={t.todo.noTodos} />
        ) : (
          Object.entries(groups).map(([priority, items]) => {
            if (items.length === 0) return null;
            return (
              <div key={priority} style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
                  <Badge color={PRIORITY_COLORS[priority as Priority]} text={priorityLabels[priority as Priority]} />
                  <span style={{ marginLeft: 8, color: isDark ? '#bbb' : '#999', fontWeight: 'normal', fontSize: 12 }}>({items.length})</span>
                </div>
                <List
                  dataSource={items}
                  renderItem={(todo) => (
                    <List.Item
                      actions={[
                        <Button
                          key="done"
                          type="link"
                          size="small"
                          onClick={() => handleToggleDone(todo)}
                        >
                          {todo.status === 'done' ? t.todo.cancelDone : t.todo.markDone}
                        </Button>,
                        <Button
                          key="split"
                          type="link"
                          size="small"
                          icon={<SplitCellsOutlined />}
                          onClick={() => setSplitTodo(todo)}
                          disabled={todo.status === 'done'}
                        >
                          {t.todo.split}
                        </Button>,
                        <Button
                          key="edit"
                          type="link"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => { setEditingTodo(todo); setFormVisible(true); }}
                        />,
                        <Button
                          key="delete"
                          type="link"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDelete(todo.id)}
                        />,
                      ]}
                      style={{ opacity: todo.status === 'done' ? 0.5 : 1 }}
                    >
                      <List.Item.Meta
                        title={
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: getTodoColor(todo),
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ textDecoration: todo.status === 'done' ? 'line-through' : 'none' }}>
                              {todo.title}
                            </span>
                            <ColorPicker
                              size="small"
                              value={getTodoColor(todo)}
                              onChangeComplete={(color) => {
                                const hex = typeof color === 'string' ? color : color.toHexString?.() || '#1890ff';
                                handleColorChange(todo, hex);
                              }}
                            />
                          </div>
                        }
                        description={
                          <div>
                            <Tag>{todo.estimated_minutes} {t.todo.minutes}</Tag>
                            <Tag color={todo.status === 'done' ? 'green' : todo.status === 'scheduled' ? 'blue' : 'default'}>
                              {statusLabels[todo.status]}
                            </Tag>
                            {todo.deadline && (
                              <span style={{ fontSize: 12, color: todo.status === 'done' ? (isDark ? '#bbb' : '#999') : (new Date(todo.deadline) < new Date() ? '#f5222d' : (isDark ? '#bbb' : '#999')) }}>
                                {getDeadlineCountdown(todo.deadline, t.todo)}
                              </span>
                            )}
                            {todo.scheduled_start && (
                              <span style={{ fontSize: 12, color: '#1890ff', marginLeft: 8 }}>
                                {dayjs(todo.scheduled_start).format('MM/DD HH:mm')} - {dayjs(todo.scheduled_end!).format('HH:mm')}
                              </span>
                            )}
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            );
          })
        )}
      </Spin>

      <TodoForm
        visible={formVisible}
        todo={editingTodo}
        onClose={() => { setFormVisible(false); setEditingTodo(null); }}
        onSaved={loadTodos}
      />

      <TodoSplitModal
        todo={splitTodo}
        onClose={() => setSplitTodo(null)}
        onSaved={loadTodos}
      />
    </div>
  );
};

export default TodoList;
