import { useState } from 'react';
import { readableDate, weekDates } from './calendar.ts';

export type HistoryDay = {
  date: string;
  scheduled: boolean;
  status:
    | 'upcoming'
    | 'pending'
    | 'partial'
    | 'completed'
    | 'frozen'
    | 'missed'
    | null;
  recorded: boolean;
  value?: number;
  target?: number;
};
export type HistoryWeek = {
  from: string;
  to: string;
  today: string;
  habits: {
    id: number;
    name: string;
    category: string | null;
    color: string | null;
    archived: boolean;
    days: HistoryDay[];
  }[];
  progress: { completed: number; due: number; percentage: number | null };
};

function dayName(date: string) {
  return readableDate(date, { weekday: 'short' });
}
function dayNumber(date: string) {
  return readableDate(date, { day: 'numeric' });
}
function dayMark(day: HistoryDay) {
  if (!day.scheduled) return '—';
  if (day.status === 'completed') return '✓';
  if (day.status === 'frozen') return '❄';
  if (day.status === 'partial') return '◐';
  if (day.status === 'upcoming') return '·';
  return '○';
}

export function WeeklyProgress({ week }: { week: HistoryWeek | null }) {
  if (!week) return <p>Loading this week’s progress…</p>;
  return (
    <section className="weekly-progress" aria-labelledby="weekly-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">THIS WEEK</p>
          <h2 id="weekly-title">Weekly progress</h2>
        </div>
        <strong>
          {week.progress.completed} / {week.progress.due}
        </strong>
      </div>
      <progress
        max={week.progress.due || 1}
        value={week.progress.completed}
        aria-label={`${week.progress.completed} of ${week.progress.due} scheduled check-ins completed this week`}
      />
      <div className="week-strip">
        {weekDates(week.from).map((date) => {
          const days = week.habits.flatMap((habit) =>
            habit.days.filter((day) => day.date === date && day.scheduled),
          );
          const completed = days.filter(
            (day) => day.status === 'completed',
          ).length;
          return (
            <div
              key={date}
              className={date === week.today ? 'week-day today' : 'week-day'}
            >
              <span>{dayName(date)}</span>
              <strong>{dayNumber(date)}</strong>
              <small>{days.length ? `${completed}/${days.length}` : '—'}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HistoryPanel({
  week,
  offset,
  loading,
  onChangeWeek,
}: {
  week: HistoryWeek | null;
  offset: number;
  loading: boolean;
  onChangeWeek: (offset: number) => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected =
    week?.habits.find((habit) => habit.id === selectedId) ?? week?.habits[0];
  return (
    <section aria-labelledby="history-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">PAST CHECK-INS</p>
          <h2 id="history-title">History</h2>
        </div>
        <div className="history-navigation">
          <button
            className="quiet"
            onClick={() => onChangeWeek(offset - 1)}
            disabled={loading}
          >
            Previous week
          </button>
          <button
            className="quiet"
            onClick={() => onChangeWeek(offset + 1)}
            disabled={loading || offset >= 0}
          >
            Next week
          </button>
        </div>
      </div>
      {week && (
        <p>
          {readableDate(week.from, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}{' '}
          –{' '}
          {readableDate(week.to, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {' · '}
          {week.progress.completed} of {week.progress.due} due check-ins
          completed
        </p>
      )}
      {loading && <p role="status">Loading week…</p>}
      {!week ? null : week.habits.length === 0 ? (
        <p>No routines were scheduled this week.</p>
      ) : (
        <>
          <div
            className="history-scroll"
            role="region"
            aria-label="Routine check-ins by day"
            tabIndex={0}
          >
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Routine</th>
                  {weekDates(week.from).map((date) => (
                    <th key={date} scope="col">
                      {dayName(date)}
                      <br />
                      {dayNumber(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {week.habits.map((habit) => (
                  <tr key={habit.id}>
                    <th scope="row">
                      <button
                        className="quiet history-routine"
                        onClick={() => setSelectedId(habit.id)}
                        aria-pressed={selected?.id === habit.id}
                      >
                        {habit.name}
                      </button>
                      <small>
                        {habit.category ?? 'Other'}
                        {habit.archived ? ' · Removed' : ''}
                      </small>
                    </th>
                    {habit.days.map((day) => (
                      <td
                        key={day.date}
                        title={`${day.date}: ${day.status ?? 'not scheduled'}`}
                      >
                        <span
                          className={`history-mark status-${day.status ?? 'none'}`}
                          aria-label={`${habit.name}, ${readableDate(day.date, { dateStyle: 'medium' })}: ${day.status ?? 'not scheduled'}`}
                        >
                          {dayMark(day)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <div className="history-records">
              <h3>{selected.name} records</h3>
              {selected.days.some((day) => day.recorded) ? (
                <ul>
                  {selected.days
                    .filter((day) => day.recorded)
                    .map((day) => (
                      <li key={day.date}>
                        {readableDate(day.date, { dateStyle: 'medium' })}:{' '}
                        {day.status}
                        {day.value !== undefined && day.target !== undefined
                          ? ` (${day.value}/${day.target})`
                          : ''}
                      </li>
                    ))}
                </ul>
              ) : (
                <p>No check-ins recorded for this routine in this week.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
