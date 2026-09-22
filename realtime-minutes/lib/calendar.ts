/** カレンダー連携: 日付は必ずユーザーが自分で選んだものだけを使う(AIが日付を捏造しない)。 */

function toCompactDate(dateStr: string): string {
  // "2026-10-05" -> "20261005"
  return dateStr.replaceAll("-", "");
}

/** Googleカレンダーの「予定を追加」画面をプリフィルして開くURL(終日予定)。 */
export function buildGoogleCalendarUrl(title: string, dateStr: string, details?: string): string {
  const compact = toCompactDate(dateStr);
  // 終日予定はdtend排他的なので翌日を計算する
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const endCompact = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, "0")}${String(end.getDate()).padStart(2, "0")}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${compact}/${endCompact}`,
  });
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** 汎用カレンダーアプリ(Apple/Outlook等)向けの.icsファイルをdata URLとして生成する。 */
export function buildIcsDataUrl(title: string, dateStr: string, details?: string): string {
  const compact = toCompactDate(dateStr);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}@realtime-minutes`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//realtime-minutes//karte//JA",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact}`,
    `SUMMARY:${escapeIcsText(title)}`,
  ];
  if (details) lines.push(`DESCRIPTION:${escapeIcsText(details)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  const ics = lines.join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function escapeIcsText(text: string): string {
  return text.replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
}
