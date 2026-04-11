import ICAL from 'ical.js';
// ical.js 在 ESM 环境下可能有不同的导出方式，兼容默认导出和命名空间导出
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
    if (event.startDate) {
      startTime = event.startDate.toJSDate().toISOString();
    }
    if (event.endDate) {
      endTime = event.endDate.toJSDate().toISOString();
    }

    let rrule: string | null = null;
    if (event.isRecurring()) {
      const rruleProp = vevent.getFirstProperty('rrule');
      if (rruleProp) {
        rruleProp.removeParameter('tzid');
        rrule = rruleProp.getFirstValue()?.toString() || null;
      }
    }

    // 必须有有效的开始和结束时间才视为有效事件，否则跳过
    if (!startTime || !endTime) {
      continue;
    }

    events.push({
      title,
      description,
      startTime,
      endTime,
      rrule,
      location,
      uid,
    });
  }

  return events;
}
