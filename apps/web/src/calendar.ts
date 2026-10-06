export function addCalendarDays(date: string, days: number): string {
  const cursor = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()))
    throw new RangeError('Invalid calendar date');
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

export function weekRange(date: string, offset = 0) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const from = addCalendarDays(date, -(day === 0 ? 6 : day - 1) + offset * 7);
  return { from, to: addCalendarDays(from, 6) };
}

export function weekDates(from: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(from, index));
}

export function monthRange(date: string, offset = 0) {
  const cursor = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() + offset);
  const from = cursor.toISOString().slice(0, 10);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  cursor.setUTCDate(0);
  return { from, to: cursor.toISOString().slice(0, 10) };
}

export function rangeDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function readableDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    ...options,
  }).format(new Date(`${date}T00:00:00Z`));
}
