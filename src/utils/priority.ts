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

export function getDeadlineCountdown(deadline: string | null, t: { noDeadline: string; expired: string; remainingHours: string; remainingDays: string }): string {
  if (!deadline) return t.noDeadline;
  const now = Date.now();
  const dl = new Date(deadline).getTime();
  const diff = dl - now;
  if (diff < 0) return t.expired;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) return t.remainingHours.replaceAll('{n}', String(hours));
  const days = Math.floor(hours / 24);
  return t.remainingDays.replaceAll('{n}', String(days));
}
