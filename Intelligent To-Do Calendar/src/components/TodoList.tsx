import React, { useEffect, useState, useCallback } from 'react';
import { List, Tag, Button, Modal, message, Badge, Empty, Spin } from 'antd';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { todoApi } from '../api/client';
import type { Todo, Priority, TodoStatus } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '../types';
import { getDeadlineCountdown } from '../utils/priority';
import TodoForm from './TodoForm';

const STATUS_LABELS: Record<TodoStatus, string> = {
  pending: '待办',
  scheduled: '已排程',
  done: '已完成',
};

const TodoList: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [filterStatus, setFilterStatus] = useState<TodoStatus | undefined>(undefined);

  const loadTodos = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterStatus) params.status = filterStatus;
      const data = await todoApi.getAll(params);
      setTodos(data);
    } catch {
      message.error('加载待办失败');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '删除待办',
      content: '确定要删除这个待办吗？',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        await todoApi.delete(id);
        message.success('已删除');
        loadTodos();
      },
    });
  };

  const handleToggleDone = async (todo: Todo) => {
    const newStatus = todo.status === 'done' ? 'pending' : 'done';
    await todoApi.update(todo.id, { status: newStatus as TodoStatus });
    loadTodos();
  };

  const groupByPriority = (list: Todo[]): Record<Priority, Todo[]> => {
    const groups: Record<Priority, Todo[]> = {
      'urgent-important': [],
      'important': [],
      'urgent': [],
      'normal': [],
    };
    for (const t of list) {
      groups[t.priority].push(t);
    }
    return groups;
  };

  const groups = groupByPriority(todos);

  return (
    <div style={{ background: '#fff', padding: 24, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            type={filterStatus === undefined ? 'primary' : 'default'}
            size="small"
            onClick={() => setFilterStatus(undefined)}
          >
            全部
          </Button>
          <Button
            type={filterStatus === 'pending' ? 'primary' : 'default'}
            size="small"
            onClick={() => setFilterStatus('pending')}
          >
            待办
          </Button>
          <Button
            type={filterStatus === 'scheduled' ? 'primary' : 'default'}
            size="small"
            onClick={() => setFilterStatus('scheduled')}
          >
            已排程
          </Button>
          <Button
            type={filterStatus === 'done' ? 'primary' : 'default'}
            size="small"
            onClick={() => setFilterStatus('done')}
          >
            已完成
          </Button>
        </div>
        <Button type="primary" onClick={() => { setEditingTodo(null); setFormVisible(true); }}>
          新建待办
        </Button>
      </div>

      <Spin spinning={loading}>
        {todos.length === 0 ? (
          <Empty description="暂无待办" />
        ) : (
          Object.entries(groups).map(([priority, items]) => {
            if (items.length === 0) return null;
            return (
              <div key={priority} style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
                  <Badge color={PRIORITY_COLORS[priority as Priority]} text={PRIORITY_LABELS[priority as Priority]} />
                  <span style={{ marginLeft: 8, color: '#999', fontWeight: 'normal', fontSize: 12 }}>({items.length})</span>
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
                          {todo.status === 'done' ? '取消完成' : '标记完成'}
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
                          <span style={{ textDecoration: todo.status === 'done' ? 'line-through' : 'none' }}>
                            {todo.title}
                          </span>
                        }
                        description={
                          <div>
                            <Tag>{todo.estimated_minutes} 分钟</Tag>
                            <Tag color={todo.status === 'done' ? 'green' : todo.status === 'scheduled' ? 'blue' : 'default'}>
                              {STATUS_LABELS[todo.status]}
                            </Tag>
                            {todo.deadline && (
                              <span style={{ fontSize: 12, color: todo.status === 'done' ? '#999' : (new Date(todo.deadline) < new Date() ? '#f5222d' : '#999') }}>
                                {getDeadlineCountdown(todo.deadline)}
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
    </div>
  );
};

export default TodoList;
