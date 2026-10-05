import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate as d,
  addDays,
  dateInTimezone,
  isScheduled,
  calculateStreak,
  validateCheckIn,
  completionRate,
  quantitativeGoal,
  carryOver,
  withinQuietHours,
  type HabitTimeline,
} from '../packages/domain/src/index.ts';
const daily: HabitTimeline = {
  startDate: d('2026-10-01'),
  revisions: [
    {
      effectiveFrom: d('2026-10-01'),
      schedule: { frequency: 'daily' },
      target: 1,
    },
  ],
};
test('calendar arithmetic handles leap years, year/month boundaries and rejects invalid dates', () => {
  assert.equal(addDays(d('2024-02-28'), 1), '2024-02-29');
  assert.equal(addDays(d('2023-02-28'), 1), '2023-03-01');
  assert.equal(addDays(d('2025-12-31'), 1), '2026-01-01');
  assert.throws(() => d('2026-02-30'));
  assert.throws(() => d('not a date'));
});
test('local dates remain stable across DST changes and differ from UTC at local midnight', () => {
  assert.equal(
    dateInTimezone(new Date('2026-03-08T06:59:00Z'), 'America/New_York'),
    '2026-03-08',
  );
  assert.equal(
    dateInTimezone(new Date('2026-03-08T07:01:00Z'), 'America/New_York'),
    '2026-03-08',
  );
  assert.equal(
    dateInTimezone(new Date('2026-11-01T05:59:00Z'), 'America/New_York'),
    '2026-11-01',
  );
  assert.equal(
    dateInTimezone(new Date('2026-11-01T06:01:00Z'), 'America/New_York'),
    '2026-11-01',
  );
  assert.equal(
    dateInTimezone(new Date('2026-10-01T18:31:00Z'), 'Asia/Kolkata'),
    '2026-10-02',
  );
  assert.equal(
    dateInTimezone(new Date('2026-10-01T18:29:00Z'), 'Asia/Kolkata'),
    '2026-10-01',
  );
});
test('weekly gaps and schedule revisions preserve history', () => {
  const habit: HabitTimeline = {
    ...daily,
    revisions: [
      ...daily.revisions,
      {
        effectiveFrom: d('2026-10-03'),
        schedule: { frequency: 'weekly', weekdays: [1, 3, 5] },
        target: 2,
      },
    ],
  };
  assert.equal(isScheduled(habit, d('2026-10-02')), true);
  assert.equal(isScheduled(habit, d('2026-10-03')), false);
  assert.equal(isScheduled(habit, d('2026-10-05')), true);
  const result = calculateStreak(
    habit,
    [
      { date: d('2026-10-01'), status: 'completed', value: 1 },
      { date: d('2026-10-02'), status: 'completed', value: 1 },
    ],
    d('2026-10-05'),
  );
  assert.equal(result.current, 2);
});
test('monthly 31 does not silently shift into February', () => {
  const habit: HabitTimeline = {
    startDate: d('2024-01-01'),
    revisions: [
      {
        effectiveFrom: d('2024-01-01'),
        schedule: { frequency: 'monthly', monthDays: [31] },
        target: 1,
      },
    ],
  };
  assert.equal(isScheduled(habit, d('2024-02-29')), false);
  assert.equal(isScheduled(habit, d('2024-03-31')), true);
});
test('freeze preserves count without adding completion and today pending does not reset', () => {
  const logs = [
    { date: d('2026-10-01'), status: 'completed' as const, value: 1 },
    { date: d('2026-10-02'), status: 'frozen' as const, value: 0 },
    { date: d('2026-10-03'), status: 'completed' as const, value: 1 },
  ];
  assert.deepEqual(calculateStreak(daily, logs, d('2026-10-04')), {
    current: 2,
    historicalBest: 2,
    bestEver: 2,
    scheduled: 4,
    completed: 2,
    frozen: 1,
  });
  assert.equal(calculateStreak(daily, logs, d('2026-10-05')).current, 0);
});
test('historical corrections replay deterministically; best achievement survives undo; duplicate logs rejected', () => {
  const one = { date: d('2026-10-01'), status: 'completed' as const, value: 1 };
  assert.equal(calculateStreak(daily, [one], d('2026-10-03'), 12).bestEver, 12);
  assert.equal(
    calculateStreak(
      daily,
      [one, { ...one, date: d('2026-10-02') }],
      d('2026-10-03'),
    ).current,
    2,
  );
  assert.throws(() => calculateStreak(daily, [one, one], d('2026-10-03')));
});
test('start/end and archive boundaries exclude future scheduling without deleting history', () => {
  assert.equal(isScheduled(daily, d('2026-09-30')), false);
  assert.equal(
    isScheduled({ ...daily, endDate: d('2026-10-02') }, d('2026-10-03')),
    false,
  );
  assert.equal(
    isScheduled({ ...daily, archivedOn: d('2026-10-03') }, d('2026-10-02')),
    true,
  );
  assert.equal(
    isScheduled({ ...daily, archivedOn: d('2026-10-03') }, d('2026-10-03')),
    false,
  );
});
test('check-in window rejects future, stale and unscheduled dates', () => {
  validateCheckIn(daily, d('2026-10-01'), d('2026-10-08'));
  assert.throws(() => validateCheckIn(daily, d('2026-10-01'), d('2026-10-09')));
  assert.throws(() => validateCheckIn(daily, d('2026-10-10'), d('2026-10-09')));
});
test('analytics no-data and partial quantitative goal values are honest', () => {
  assert.equal(completionRate(0, 0), null);
  assert.equal(completionRate(3, 4), 75);
  assert.throws(() => completionRate(5, 4));
  assert.deepEqual(quantitativeGoal([40, 25], 100), {
    progress: 65,
    percentage: 65,
    achieved: false,
  });
  assert.equal(quantitativeGoal([140], 100).percentage, 100);
});
test('carry-over changes display day but completed/disabled tasks keep original due date', () => {
  assert.equal(
    carryOver(d('2026-09-30'), d('2026-10-05'), false, true),
    '2026-10-05',
  );
  assert.equal(
    carryOver(d('2026-09-30'), d('2026-10-05'), true, true),
    '2026-09-30',
  );
  assert.equal(
    carryOver(d('2026-09-30'), d('2026-10-05'), false, false),
    '2026-09-30',
  );
});
test('quiet hours cover midnight inclusively at start/exclusively at end', () => {
  assert.equal(withinQuietHours('23:00', '22:00', '07:00'), true);
  assert.equal(withinQuietHours('06:59', '22:00', '07:00'), true);
  assert.equal(withinQuietHours('07:00', '22:00', '07:00'), false);
  assert.equal(withinQuietHours('12:00', null, null), false);
  assert.throws(() => withinQuietHours('25:00', null, null));
});
