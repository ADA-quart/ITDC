import type { Priority } from '../types';

export function getPriorityFromUrgencyImportance(urgency: number, importance: number): Priority {
  if (urgency >= 3 && importance >= 3) return 'urgent-important';
  if (importance >= 3) return 'important';
  if (urgency >= 3) return 'urgent';
  return 'normal';
}

export function getQuadrantLabel(urgency: number, importance: number): string {
  const priority = getPriorityFromUrgencyImportance(urgency, importance);
  const labels: Record<Priority, string> = {
    'urgent-important': 'P1 紧急重要',
    'important': 'P2 重要不紧急',
    'urgent': 'P3 紧急不重要',
    'normal': 'P4 普通',
  };
  return labels[priority];
}

export function getDeadlineCountdown(deadline: string | null): string {
  if (!deadline) return '无截止时间';
  const now = Date.now();
  const dl = new Date(deadline).getTime();
  const diff = dl - now;
  if (diff < 0) return '已过期';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) return `剩余 ${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `剩余 ${days} 天`;
}
