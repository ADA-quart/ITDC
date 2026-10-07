import React, { useEffect, useState, useCallback } from 'react';
import { List, Tag, Button, Modal, message, Badge, Empty, Spin, ColorPicker, Input } from 'antd';
import { CheckOutlined, DeleteOutlined, EditOutlined, SplitCellsOutlined, UndoOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { todoApi, scheduleApi } from '../api/client';
import type { Todo, Priority, TodoStatus } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, TODO_PALETTE } from '../types';
import { getDeadlineCountdown } from '../utils/priority';
import { syncAllReminders } from '../api/reminders';
import TodoForm from './TodoForm';
import TodoSplitModal from './TodoSplitModal';
import { useI18n } from '../i18n';
import { cardStyle } from './ui';
import { useTheme } from '../contexts/ThemeContext';
import { useIsMobile } from '../hooks/useIsMobile';

const STATUS_KEYS: Record<string, string> = {
  pending: 'pending',
  scheduled: 'scheduled',
  done: 'done',
};

const TodoList: React.FC = () => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [filterStatus, setFilterStatus] = useState<TodoStatus | undefined>(undefined);
  const [splitTodo, setSplitTodo] = useState<Todo | null>(null);
  const [nlText, setNlText] = useState('');
  const [nlLoading, setNlLoading] = useState(false);

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
      // 本地通知排程：Android 端按最新数据重排提醒（不依赖服务器）
      void syncAllReminders(data);
    } catch {
      message.error(t.todo.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  // 监听全局数据变更：此前这段 effect 被误嵌进 handleNLAdd 内（只在点击“自然语言添加”时才注册），
  // 既违反 Hooks 规则，也让其它页面的数据变更无法刷新列表。移到组件顶层。
  useEffect(() => {
    const handler = () => loadTodos();
    window.addEventListener('todo-data-changed', handler);
    return () => window.removeEventListener('todo-data-changed', handler);
  }, [loadTodos]);

  const handleNLAdd = async () => {
    const text = nlText.trim();
    if (!text) return;
    setNlLoading(true);
    try {
      await todoApi.parseNL(text);
      message.success(t.todo.created);
      setNlText('');
      loadTodos();
    } catch (err: any) {
      message.error(err?.response?.data?.error || err.message || t.todo.loadFailed);
    } finally {
      setNlLoading(false);
    }
  };

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

  // 桌面：右侧一列文字按钮（信息量足）
  const desktopActions = (todo: Todo) => [
    <Button key="done" type="link" size="small" onClick={() => handleToggleDone(todo)}>
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
      aria-label={t.todo.editTodo}
      onClick={() => { setEditingTodo(todo); setFormVisible(true); }}
    />,
    <Button
      key="delete"
      type="link"
      size="small"
      danger
      icon={<DeleteOutlined />}
      aria-label={t.todo.delete}
      onClick={() => handleDelete(todo.id)}
    />,
  ];

  // 手机：排在内容下方的一排按钮。图标 + 短文字，高度 ≥40px，符合触控目标建议
  const mobileActions = (todo: Todo) => {
    const style: React.CSSProperties = { minHeight: 40, minWidth: 44, paddingInline: 10 };
    return [
      <Button
        key="done"
        size="small"
        style={style}
        icon={todo.status === 'done' ? <UndoOutlined /> : <CheckOutlined />}
        onClick={() => handleToggleDone(todo)}
      >
        {todo.status === 'done' ? t.todo.cancelDone : t.todo.markDone}
      </Button>,
      <Button
        key="split"
        size="small"
        style={style}
        icon={<SplitCellsOutlined />}
        onClick={() => setSplitTodo(todo)}
        disabled={todo.status === 'done'}
      >
        {t.todo.split}
      </Button>,
      <Button
        key="edit"
        size="small"
        style={style}
        icon={<EditOutlined />}
        aria-label={t.todo.editTodo}
        onClick={() => { setEditingTodo(todo); setFormVisible(true); }}
      />,
      <Button
        key="delete"
        size="small"
        danger
        style={style}
        icon={<DeleteOutlined />}
        aria-label={t.todo.delete}
        onClick={() => handleDelete(todo.id)}
      />,
    ];
  };

  const filterButtons: { key: TodoStatus | undefined; label: string }[] = [
    { key: undefined, label: t.todo.all },
    { key: 'pending', label: t.todo.pending },
    { key: 'scheduled', label: t.todo.scheduled },
    { key: 'done', label: t.todo.done },
  ];

  return (
    <div style={cardStyle(isDark, isMobile)}>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          placeholder={t.todo.nlPlaceholder}
          value={nlText}
          onChange={(e) => setNlText(e.target.value)}
          onPressEnter={() => handleNLAdd()}
          style={{ flex: 1 }}
        />
        <Button type="primary" loading={nlLoading} onClick={handleNLAdd}>
          {t.todo.nlButton}
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
                  <span style={{ marginLeft: 8, color: isDark ? '#a6a6a6' : '#666', fontWeight: 'normal', fontSize: 12 }}>({items.length})</span>
                </div>
                <List
                  dataSource={items}
                  renderItem={(todo) => (
                    <List.Item
                      actions={isMobile ? undefined : desktopActions(todo)}
                      style={{ opacity: todo.status === 'done' ? 0.5 : 1, alignItems: isMobile ? 'stretch' : undefined }}
                    >
                      {/* 手机上操作按钮排在内容下方，避免四个按钮把标题挤成一条缝 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
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
                              <span style={{ fontSize: 12, color: todo.status === 'done' ? (isDark ? '#a6a6a6' : '#666') : (new Date(todo.deadline) < new Date() ? '#f5222d' : (isDark ? '#a6a6a6' : '#666')) }}>
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
                        {isMobile && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            {mobileActions(todo)}
                          </div>
                        )}
                      </div>
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
