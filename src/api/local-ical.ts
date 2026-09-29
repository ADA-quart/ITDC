// 本地 iCal 解析：导入 .ics 不再依赖服务器。
// 与 server/services/ical-parser.ts 保持一致的字段与过滤规则。
import ICAL from 'ical.js';

const ICALModule = (ICAL as any).default || ICAL;

export interface ParsedEvent {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  rrule: string | null;
  location: string | null;
  uid: string | null;
}

export function parseIcsFile(icsContent: string): ParsedEvent[] {
  const jcalData = ICALModule.parse(icsContent);
  const vcalendar = new ICALModule.Component(jcalData);
  const vevents = vcalendar.getAllSubcomponents('vevent');
  const events: ParsedEvent[] = [];

  for (const vevent of vevents) {
    const event = new ICALModule.Event(vevent);

    const title = event.summary || '未命名事件';
    const description = event.description || '';
    const location = event.location || null;
    const uid = event.uid || null;

    let startTime = '';
    let endTime = '';
    if (event.startDate) startTime = event.startDate.toJSDate().toISOString();
    if (event.endDate) endTime = event.endDate.toJSDate().toISOString();

    let rrule: string | null = null;
    if (event.isRecurring()) {
      const rruleProp = vevent.getFirstProperty('rrule');
      if (rruleProp) {
        rruleProp.removeParameter('tzid');
        rrule = rruleProp.getFirstValue()?.toString() || null;
      }
    }

    // 必须有有效的开始和结束时间才视为有效事件，否则跳过
    if (!startTime || !endTime) continue;

    events.push({ title, description, startTime, endTime, rrule, location, uid });
  }

  return events;
}

export interface IcalExportInput {
  title: string;
  description?: string | null;
  location?: string | null;
  rrule?: string | null;
  uid?: string | null;
  startTime: string;
  endTime: string;
}

function escapeIcal(text: string): string {
  return text.replace(/[\\;,\n]/g, (match) => (match === '\n' ? '\\n' : '\\' + match));
}

function dateToIcal(dt: Date): string {
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 生成 .ics 文本；待办条目由调用方以 TODO_PREFIX 标题传入 */
export function buildIcs(items: IcalExportInput[]): string {
  let ics = 'BEGIN:VCALENDAR\r\n';
  ics += 'VERSION:2.0\r\n';
  ics += 'PRODID:-//Smart Calendar//EN\r\n';
  ics += 'CALSCALE:GREGORIAN\r\n';
  ics += 'METHOD:PUBLISH\r\n';

  for (const ev of items) {
    if (!ev.startTime || !ev.endTime) continue;
    ics += 'BEGIN:VEVENT\r\n';
    ics += `UID:${ev.uid || `itdc-${Math.random().toString(36).slice(2)}@local`}\r\n`;
    ics += `DTSTART:${dateToIcal(new Date(ev.startTime))}\r\n`;
    ics += `DTEND:${dateToIcal(new Date(ev.endTime))}\r\n`;
    ics += `SUMMARY:${escapeIcal(ev.title)}\r\n`;
    if (ev.description) ics += `DESCRIPTION:${escapeIcal(ev.description)}\r\n`;
    if (ev.location) ics += `LOCATION:${escapeIcal(ev.location)}\r\n`;
    if (ev.rrule) ics += `RRULE:${ev.rrule}\r\n`;
    ics += 'END:VEVENT\r\n';
  }

  ics += 'END:VCALENDAR\r\n';
  return ics;
}

/** 触发浏览器/WebView 下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}