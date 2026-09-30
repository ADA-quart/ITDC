// 给大模型的「当前时间」文本。
//
// 为什么不能只给 toISOString()：那串时间带 Z，模型往往把它当参考点，
// 却回一个**不带时区**的 "2026-09-30T07:00:00"。App 按本地时区解析这串裸时间，
// 在 UTC+8 的手机上就会得到已经过去的时段（排程排到几小时前）。
// 因此这里统一给出「带偏移量的本地时间 + 明确的偏移说明」。

export function formatNowForModel(now: Date): string {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + `T${pad(now.getHours())}:${pad(now.getMinutes())}:00${offset}`;

  return `${local}（本机时间，UTC 偏移 ${offset}，对应的 UTC 时刻 ${now.toISOString()}）`;
}

/** 把模板里的 {{current_time}} 占位符替换成上面那段文本 */
export function fillCurrentTime(template: string, now: Date): string {
  return template.replace(/\{\{current_time\}\}/g, formatNowForModel(now));
}
