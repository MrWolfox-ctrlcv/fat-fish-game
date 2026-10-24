const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Weeks start Monday 00:00 in UTC+8. */
export function weekFor(timestamp) {
  const local = new Date(timestamp + SHANGHAI_OFFSET);
  const weekday = local.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - daysSinceMonday * DAY - SHANGHAI_OFFSET;
  const end = start + 7 * DAY;
  const id = utcDate(start + SHANGHAI_OFFSET);
  const endLocal = new Date(end + SHANGHAI_OFFSET);
  return {
    id, start, end,
    start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(),
    label: `${id} 至 ${utcDate(endLocal.getTime() - DAY)}`,
  };
}

export function previousWeek(timestamp) {
  return weekFor(weekFor(timestamp).start - 1);
}

export function publicName(name, userId) {
  const value = String(name || '').trim();
  if (!value) return `鱼友${String(userId).slice(-2)}`;
  const local = value.includes('@') ? value.slice(0, value.indexOf('@')) : value;
  const chars = [...local];
  if (chars.length <= 1) return `${chars[0] || '鱼'}***`;
  return `${chars[0]}***${chars.at(-1)}`;
}
