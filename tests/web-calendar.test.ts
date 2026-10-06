import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  monthRange,
  rangeDates,
  weekDates,
  weekRange,
} from '../apps/web/src/calendar.ts';

test('weekly browsing keeps Monday starts across month and year boundaries', () => {
  assert.deepEqual(weekRange('2026-01-01'), {
    from: '2025-12-29',
    to: '2026-01-04',
  });
  assert.deepEqual(weekRange('2026-01-01', -1), {
    from: '2025-12-22',
    to: '2025-12-28',
  });
  assert.equal(weekDates('2025-12-29').length, 7);
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
});

test('month grid covers exactly the selected calendar month', () => {
  assert.deepEqual(monthRange('2024-01-31', 1), {
    from: '2024-02-01',
    to: '2024-02-29',
  });
  assert.equal(rangeDates('2024-02-01', '2024-02-29').length, 29);
});
