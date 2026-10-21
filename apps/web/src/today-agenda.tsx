import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { addCalendarDays, readableDate } from './calendar.ts';
import { WeeklyProgress, type HistoryWeek } from './history.tsx';

type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type ActivityType =
  'task' | 'habit' | 'goal_action' | 'appointment' | 'personal';
type Activity = {
  id: number;
  title: string;
  description: string | null;
  activityType: ActivityType;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  priority: number;
  reminderTime: string | null;
  notes: string | null;
  status: 'planned' | 'completed' | 'skipped' | 'partial';
  linkedTaskId: number | null;
  linkedHabitId: number | null;
  linkedGoalId: number | null;
  linkedGoalTitle: string | null;
  habitValue: number;
  habitTarget: number;
  version: number;
};
type Task = {
  id: number;
  title: string;
  description?: string | null;
  dueDate: string;
  displayDate: string;
  completed: boolean;
  priority: number;
};
type Goal = { id: number; title: string };
type Habit = HistoryWeek['habits'][number] & {
  value: number;
  target: number;
  status: string;
};
type AgendaItem = {
  key: string;
  activity?: Activity;
  title: string;
  description: string | null;
  type: ActivityType;
  startTime: string | null;
  endTime: string | null;
  status:
    'planned' | 'completed' | 'skipped' | 'partial' | 'missed' | 'upcoming';
  priority: number;
  habitId?: number;
  taskId?: number;
  goalTitle?: string | null;
  value?: number;
  target?: number;
};
type DayData = {
  activities: Activity[];
  tasks: Task[];
  habits: Habit[];
  week: HistoryWeek;
};
type FormState = {
  id: number | null;
  version: number | null;
  title: string;
  description: string;
  activityType: ActivityType;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  priority: number;
  reminderTime: string;
  notes: string;
  linkedHabitId: number;
  linkedTaskId: number;
  linkedGoalId: number;
};
const emptyForm = (date: string): FormState => ({
  id: null,
  version: null,
  title: '',
  description: '',
  activityType: 'task',
  scheduledDate: date,
  startTime: '',
  endTime: '',
  priority: 3,
  reminderTime: '',
  notes: '',
  linkedHabitId: 0,
  linkedTaskId: 0,
  linkedGoalId: 0,
});
const typeLabels: Record<ActivityType, string> = {
  task: 'Task',
  habit: 'Habit',
  goal_action: 'Goal action',
  appointment: 'Appointment',
  personal: 'Personal routine',
};
function localClock(timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}
function formatTime(value: string) {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}
function readItemStatus(
  item: AgendaItem,
  date: string,
  today: string,
  now: string,
) {
  if (
    item.status === 'completed' ||
    item.status === 'skipped' ||
    item.status === 'partial'
  )
    return item.status;
  if (date > today) return 'upcoming';
  if (date < today) return 'overdue';
  if (
    item.startTime &&
    item.endTime &&
    item.startTime <= now &&
    now < item.endTime
  )
    return 'in progress';
  if (item.endTime && item.endTime <= now) return 'overdue';
  return 'upcoming';
}
function overlapKeys(items: AgendaItem[]) {
  const keys = new Set<string>();
  const timed = items.filter((item) => item.startTime && item.endTime);
  for (let left = 0; left < timed.length; left++)
    for (let right = left + 1; right < timed.length; right++)
      if (
        timed[left]!.startTime! < timed[right]!.endTime! &&
        timed[right]!.startTime! < timed[left]!.endTime!
      ) {
        keys.add(timed[left]!.key);
        keys.add(timed[right]!.key);
      }
  return keys;
}
function merge(data: DayData): AgendaItem[] {
  const blockedTasks = new Set(
    data.activities.flatMap((activity) =>
      activity.linkedTaskId ? [activity.linkedTaskId] : [],
    ),
  );
  const blockedHabits = new Set(
    data.activities.flatMap((activity) =>
      activity.linkedHabitId ? [activity.linkedHabitId] : [],
    ),
  );
  const activityItems: AgendaItem[] = data.activities.map((activity) => ({
    key: `activity-${activity.id}`,
    activity,
    title: activity.title,
    description: activity.description,
    type: activity.activityType,
    startTime: activity.startTime,
    endTime: activity.endTime,
    status: activity.status,
    priority: activity.priority,
    ...(activity.linkedHabitId
      ? {
          habitId: activity.linkedHabitId,
          value: activity.habitValue,
          target: activity.habitTarget,
        }
      : {}),
    ...(activity.linkedTaskId ? { taskId: activity.linkedTaskId } : {}),
    goalTitle: activity.linkedGoalTitle,
  }));
  const taskItems: AgendaItem[] = data.tasks
    .filter((task) => !blockedTasks.has(task.id))
    .map((task) => ({
      key: `task-${task.id}`,
      title: task.title,
      description: task.description ?? null,
      type: 'task',
      startTime: null,
      endTime: null,
      status: task.completed ? 'completed' : 'planned',
      priority: task.priority,
      taskId: task.id,
    }));
  const habitItems: AgendaItem[] = data.habits
    .filter((habit) => !blockedHabits.has(habit.id))
    .map((habit) => ({
      key: `habit-${habit.id}`,
      title: habit.name,
      description: null,
      type: 'habit',
      startTime: null,
      endTime: null,
      status:
        habit.status === 'completed'
          ? 'completed'
          : habit.status === 'frozen'
            ? 'skipped'
            : habit.status === 'partial'
              ? 'partial'
              : 'planned',
      priority: 3,
      habitId: habit.id,
      value: habit.value,
      target: habit.target,
    }));
  return [...activityItems, ...taskItems, ...habitItems].sort(
    (a, b) =>
      (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') ||
      (a.endTime ?? '99:99').localeCompare(b.endTime ?? '99:99') ||
      a.title.localeCompare(b.title),
  );
}
function dateLabel(date: string) {
  return readableDate(date, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
export function TodayAgenda({
  api,
  today,
  todayHabits,
  timezone,
  onChanged,
}: {
  api: Api;
  today: string;
  todayHabits: { id: number; freezeAvailable: boolean }[];
  timezone: string;
  onChanged: () => Promise<void>;
}) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [now, setNow] = useState(() => localClock(timezone));
  const formHeading = useRef<HTMLHeadingElement>(null);
  const previousToday = useRef(today);
  const loadSequence = useRef(0);
  useEffect(() => {
    if (today !== previousToday.current) {
      if (date === previousToday.current) setDate(today);
      previousToday.current = today;
    }
  }, [today, date]);
  useEffect(() => {
    if (!form) return;
    window.requestAnimationFrame(() => {
      formHeading.current?.focus();
      formHeading.current?.scrollIntoView({ block: 'start' });
    });
  }, [form?.id]);
  const reload = useCallback(
    async (selectedDate: string) => {
      const sequence = ++loadSequence.current;
      const rangeStart = addCalendarDays(
        selectedDate,
        -(new Date(`${selectedDate}T12:00:00Z`).getUTCDay() + 6) % 7,
      );
      const rangeEnd = addCalendarDays(rangeStart, 6);
      const [activities, tasks, week] = await Promise.all([
        api<{ activities: Activity[] }>(
          `/api/v1/activities?date=${selectedDate}`,
        ),
        api<{ tasks: Task[] }>(
          `/api/v1/tasks?from=${selectedDate}&to=${selectedDate}`,
        ),
        api<HistoryWeek>(`/api/v1/history?from=${rangeStart}&to=${rangeEnd}`),
      ]);
      const habits = week.habits.flatMap((habit) => {
        const day = habit.days.find(
          (entry) => entry.date === selectedDate && entry.scheduled,
        );
        return day
          ? [
              {
                ...habit,
                value: day.value ?? 0,
                target: day.target ?? 1,
                status: day.status ?? 'pending',
              },
            ]
          : [];
      });
      if (sequence === loadSequence.current)
        setData({
          activities: activities.activities,
          tasks: tasks.tasks,
          habits,
          week,
        });
    },
    [api],
  );
  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    setError('');
    void reload(date)
      .catch((cause) => {
        if (live)
          setError(
            cause instanceof Error ? cause.message : 'Could not load this day',
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [date, reload]);
  useEffect(() => {
    const tick = () => setNow(localClock(timezone));
    const online = () => setOffline(false);
    const off = () => setOffline(true);
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener('online', online);
    window.addEventListener('offline', off);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', off);
    };
  }, [timezone]);
  const items = useMemo(() => (data ? merge(data) : []), [data]);
  const timed = items.filter((item) => item.startTime !== null);
  const unscheduled = items.filter((item) => item.startTime === null);
  const overlaps = useMemo(() => overlapKeys(timed), [timed]);
  const nowIndex = timed.findIndex((item) => item.endTime! >= now);
  const countable =
    date <= today ? items.filter((item) => item.status !== 'skipped') : [];
  const completed = countable.filter(
    (item) => item.status === 'completed',
  ).length;
  const percentage = countable.length
    ? Math.round((completed / countable.length) * 100)
    : 0;
  async function mutate(
    item: AgendaItem,
    action: 'complete' | 'undo' | 'skip',
  ) {
    if (
      action === 'skip' &&
      item.habitId &&
      !window.confirm(`Use this week's freeze for ${item.title}?`)
    )
      return;
    setBusyKey(item.key);
    setError('');
    setNotice('');
    const before = data;
    if (data) {
      const next =
        action === 'complete'
          ? 'completed'
          : action === 'skip'
            ? 'skipped'
            : 'planned';
      if (item.activity)
        setData({
          ...data,
          activities: data.activities.map((value) =>
            value.id === item.activity!.id
              ? {
                  ...value,
                  status:
                    action === 'complete' &&
                    item.habitId &&
                    (item.target ?? 1) > 1 &&
                    (item.value ?? 0) + 1 < (item.target ?? 1)
                      ? 'partial'
                      : next,
                  habitValue: item.habitId
                    ? action === 'complete'
                      ? Math.min(item.target ?? 1, (item.value ?? 0) + 1)
                      : 0
                    : value.habitValue,
                }
              : value,
          ),
        });
      else if (item.taskId)
        setData({
          ...data,
          tasks: data.tasks.map((value) =>
            value.id === item.taskId
              ? { ...value, completed: action === 'complete' }
              : value,
          ),
        });
      else if (item.habitId)
        setData({
          ...data,
          habits: data.habits.map((value) =>
            value.id === item.habitId
              ? {
                  ...value,
                  status:
                    action === 'skip'
                      ? 'frozen'
                      : action === 'undo'
                        ? 'pending'
                        : (item.value ?? 0) + 1 >= (item.target ?? 1)
                          ? 'completed'
                          : 'partial',
                  value:
                    action === 'complete'
                      ? Math.min(item.target ?? 1, (item.value ?? 0) + 1)
                      : 0,
                }
              : value,
          ),
        });
    }
    try {
      if (item.taskId) {
        if (action === 'skip')
          throw new Error('Move this task to another day instead');
        await api(`/api/v1/tasks/${item.taskId}/${action}`, 'POST');
      } else if (item.habitId) {
        const body =
          action === 'complete' && (item.target ?? 1) > 1
            ? { date, value: 1, mutationId: crypto.randomUUID() }
            : { date };
        await api(`/api/v1/habits/${item.habitId}/${action}`, 'POST', body);
      } else if (item.activity) {
        await api(`/api/v1/activities/${item.activity.id}/${action}`, 'POST');
      }
      await Promise.all([reload(date), onChanged()]);
      setNotice(
        action === 'complete'
          ? 'Updated.'
          : action === 'skip'
            ? 'Skipped.'
            : 'Reopened.',
      );
    } catch (cause) {
      setData(before);
      setError(
        cause instanceof Error ? cause.message : 'Could not update activity',
      );
    } finally {
      setBusyKey(null);
    }
  }
  async function openForm(activity?: Activity) {
    setError('');
    setNotice('');
    if (activity) {
      setForm({
        id: activity.id,
        version: activity.version,
        title: activity.title,
        description: activity.description ?? '',
        activityType: activity.activityType,
        scheduledDate: activity.scheduledDate,
        startTime: activity.startTime ?? '',
        endTime: activity.endTime ?? '',
        priority: activity.priority,
        reminderTime: activity.reminderTime ?? '',
        notes: activity.notes ?? '',
        linkedHabitId: activity.linkedHabitId ?? 0,
        linkedTaskId: activity.linkedTaskId ?? 0,
        linkedGoalId: activity.linkedGoalId ?? 0,
      });
    } else setForm(emptyForm(date));
    try {
      const result = await api<{ goals: Goal[] }>('/api/v1/goals');
      setGoals(result.goals);
    } catch {
      setGoals([]);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    if (
      Boolean(form.startTime) !== Boolean(form.endTime) ||
      (form.startTime && form.endTime <= form.startTime)
    ) {
      setError('Choose both times, with the end later on the same day.');
      return;
    }
    setBusyKey('form');
    setError('');
    try {
      const body = {
        title: form.title.trim(),
        description: form.description || null,
        activityType: form.activityType,
        scheduledDate: form.scheduledDate,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        priority: form.priority,
        reminderTime: form.reminderTime || null,
        notes: form.notes || null,
        linkedHabitId:
          form.activityType === 'habit' ? form.linkedHabitId || null : null,
        linkedTaskId:
          form.activityType === 'task' ? form.linkedTaskId || null : null,
        linkedGoalId:
          form.activityType === 'goal_action'
            ? form.linkedGoalId || null
            : null,
      };
      if (form.id) {
        const original = data?.activities.find(
          (activity) => activity.id === form.id,
        );
        if (!original) throw new Error('Activity changed; reload this day');
        let version = form.version!;
        if (original.scheduledDate !== form.scheduledDate) {
          const result = await api<{ activity: Activity }>(
            `/api/v1/activities/${form.id}/reschedule`,
            'POST',
            {
              version,
              scheduledDate: form.scheduledDate,
              startTime: body.startTime,
              endTime: body.endTime,
            },
          );
          version = result.activity.version;
        }
        await api(`/api/v1/activities/${form.id}`, 'PATCH', {
          ...body,
          version,
        });
      } else await api('/api/v1/activities', 'POST', body);
      const nextDate = form.scheduledDate;
      setForm(null);
      setDate(nextDate);
      await Promise.all([reload(nextDate), onChanged()]);
      setNotice('Activity saved.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save activity',
      );
    } finally {
      setBusyKey(null);
    }
  }
  async function remove(activity: Activity) {
    if (
      !window.confirm(
        `Remove ${activity.title} from your day? Its linked task or habit remains in your account.`,
      )
    )
      return;
    setBusyKey(`activity-${activity.id}`);
    setError('');
    try {
      await api(`/api/v1/activities/${activity.id}`, 'DELETE', {
        version: activity.version,
      });
      await Promise.all([reload(date), onChanged()]);
      setNotice('Activity removed.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not remove activity',
      );
    } finally {
      setBusyKey(null);
    }
  }
  function card(item: AgendaItem, showNow = false) {
    const status = readItemStatus(item, date, today, now);
    const done = item.status === 'completed';
    const skipped = item.status === 'skipped';
    const canCheck = date <= today && !skipped;
    const busy = busyKey !== null || offline;
    const canFreeze = todayHabits.some(
      (habit) => habit.id === item.habitId && habit.freezeAvailable,
    );
    return (
      <li
        key={item.key}
        className={`agenda-card agenda-${item.type}${done ? ' is-done' : ''}`}
      >
        {showNow && (
          <div className="agenda-now" role="status">
            Now · {formatTime(now)}
          </div>
        )}
        <div className="agenda-time">
          {item.startTime ? (
            <>
              <strong>{formatTime(item.startTime)}</strong>
              <small>{formatTime(item.endTime!)}</small>
            </>
          ) : (
            <strong>Anytime</strong>
          )}
        </div>
        <div className="agenda-card-body">
          <div className="agenda-card-main">
            <div className="agenda-copy">
              <div className="agenda-meta">
                <span>{typeLabels[item.type]}</span>
                <span
                  className={`agenda-status status-${status.replace(' ', '-')}`}
                >
                  {status}
                </span>
                {item.priority <= 2 && <span>High priority</span>}
                {overlaps.has(item.key) && (
                  <span className="agenda-conflict">Time overlap</span>
                )}
              </div>
              <strong>{item.title}</strong>
              {item.description && <p>{item.description}</p>}
              {item.goalTitle && <small>Goal: {item.goalTitle}</small>}
              {item.habitId && (item.target ?? 1) > 1 && (
                <small>
                  Check-ins: {item.value ?? 0} / {item.target}
                </small>
              )}
              {item.activity?.reminderTime && (
                <small>
                  Time cue: {formatTime(item.activity.reminderTime)}
                </small>
              )}
            </div>
            <div className="agenda-primary">
              {canCheck && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate(item, done ? 'undo' : 'complete')}
                  aria-label={
                    done
                      ? `Undo ${item.title}`
                      : item.habitId && (item.target ?? 1) > 1
                        ? `+1 check-in for ${item.title}`
                        : `Done: Complete ${item.title}`
                  }
                >
                  {done
                    ? 'Undo'
                    : item.habitId && (item.target ?? 1) > 1
                      ? '+1'
                      : 'Done'}
                </button>
              )}
              {item.habitId && item.status === 'partial' && date <= today && (
                <button
                  className="quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate(item, 'undo')}
                  aria-label={`Undo check-ins for ${item.title}`}
                >
                  Undo
                </button>
              )}
            </div>
          </div>
          {item.activity ? (
            <details className="agenda-actions">
              <summary>More actions for {item.title}</summary>
              <div>
                <button
                  className="quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void openForm(item.activity)}
                >
                  Edit / reschedule
                </button>
                {!item.taskId && !item.habitId && !done && !skipped && (
                  <button
                    className="quiet"
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate(item, 'skip')}
                  >
                    Skip
                  </button>
                )}
                {!item.taskId && !item.habitId && skipped && (
                  <button
                    className="quiet"
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate(item, 'undo')}
                  >
                    Undo skip
                  </button>
                )}
                {item.habitId &&
                  item.status === 'planned' &&
                  date === today && (
                    <button
                      className="quiet"
                      type="button"
                      disabled={busy || !canFreeze}
                      title={
                        canFreeze
                          ? 'Protect this streak once this week'
                          : 'Requires a two-day streak and an unused weekly freeze'
                      }
                      onClick={() => void mutate(item, 'skip')}
                    >
                      Use freeze
                    </button>
                  )}
                <button
                  className="quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(item.activity!)}
                >
                  Remove block
                </button>
              </div>
            </details>
          ) : item.habitId && item.status === 'planned' && date === today ? (
            <button
              className="quiet agenda-freeze"
              type="button"
              disabled={busy || !canFreeze}
              title={
                canFreeze
                  ? 'Protect this streak once this week'
                  : 'Requires a two-day streak and an unused weekly freeze'
              }
              onClick={() => void mutate(item, 'skip')}
            >
              Use freeze
            </button>
          ) : null}
        </div>
      </li>
    );
  }
  return (
    <section className="today-agenda" aria-labelledby="today-title">
      <div className="agenda-header">
        <div>
          <p className="eyebrow">YOUR DAILY PLAN</p>
          <h2 id="today-title">Today</h2>
          <p>
            {dateLabel(date)} · {timezone}
          </p>
        </div>
        <div className="agenda-header-actions">
          <div
            className="progress"
            role="status"
            style={{ '--ring-progress': `${percentage}%` } as CSSProperties}
            aria-label={`${completed} of ${countable.length} activities completed`}
          >
            {completed} / {countable.length}
          </div>
          <button
            type="button"
            onClick={() => void openForm()}
            disabled={offline}
          >
            Add activity
          </button>
        </div>
      </div>
      <div className="agenda-date-nav" aria-label="Choose day">
        <button
          className="quiet"
          type="button"
          onClick={() => setDate(addCalendarDays(date, -1))}
          aria-label="Previous day"
        >
          ← Previous
        </button>
        <input
          type="date"
          aria-label="Selected date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <button
          className="quiet"
          type="button"
          onClick={() => setDate(addCalendarDays(date, 1))}
          aria-label="Next day"
        >
          Next →
        </button>
        {date !== today && (
          <button
            className="quiet"
            type="button"
            onClick={() => setDate(today)}
          >
            Go to Today
          </button>
        )}
      </div>
      {offline && (
        <p className="error" role="alert">
          You are offline. Connect to save changes.
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button
            className="quiet"
            type="button"
            onClick={() => {
              setError('');
              setLoading(true);
              void reload(date)
                .catch((cause) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not load this day',
                  ),
                )
                .finally(() => setLoading(false));
            }}
          >
            Retry
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Loading your day…</p>
      ) : !data ? (
        <div className="empty">
          <p>This day could not be loaded.</p>
        </div>
      ) : (
        <>
          <div className="agenda-summary" role="status">
            <strong>{completed} completed</strong>
            <span>{Math.max(0, countable.length - completed)} remaining</span>
            <span>
              {date > today ? 'Future plan' : `${percentage}% of planned work`}
            </span>
          </div>
          {items.length === 0 ? (
            <div className="empty">
              <p>Nothing planned for this day yet.</p>
              <button type="button" onClick={() => void openForm()}>
                Add your first activity
              </button>
            </div>
          ) : (
            <>
              <section
                aria-labelledby="timeline-title"
                className="agenda-section"
              >
                <div className="section-head">
                  <h3 id="timeline-title">Timeline</h3>
                  <small>{timed.length} timed</small>
                </div>
                {timed.length ? (
                  <ol className="agenda-list">
                    {timed.map((item, index) =>
                      card(item, date === today && index === nowIndex),
                    )}
                    {date === today && nowIndex === -1 && (
                      <li className="agenda-now-last" role="status">
                        Now · {formatTime(now)}
                      </li>
                    )}
                  </ol>
                ) : (
                  <p className="agenda-empty">No activities have a set time.</p>
                )}
              </section>
              <section
                aria-labelledby="unscheduled-title"
                className="agenda-section"
              >
                <div className="section-head">
                  <h3 id="unscheduled-title">Unscheduled</h3>
                  <small>{unscheduled.length} flexible</small>
                </div>
                {unscheduled.length ? (
                  <ol className="agenda-list">
                    {unscheduled.map((item) => card(item))}
                  </ol>
                ) : (
                  <p className="agenda-empty">
                    No flexible items for this day.
                  </p>
                )}
              </section>
            </>
          )}
          {date === today && <WeeklyProgress week={data.week} />}
        </>
      )}
      {form && (
        <section
          className="create agenda-form"
          aria-labelledby="activity-form-title"
        >
          <div className="section-head">
            <h3 id="activity-form-title" ref={formHeading} tabIndex={-1}>
              {form.id ? 'Edit activity' : 'Add activity'}
            </h3>
            <button
              className="quiet"
              type="button"
              onClick={() => setForm(null)}
            >
              Close
            </button>
          </div>
          <form onSubmit={(event) => void save(event)}>
            <label>
              Type
              <select
                value={form.activityType}
                disabled={form.id !== null}
                onChange={(event) =>
                  setForm({
                    ...form,
                    activityType: event.target.value as ActivityType,
                    linkedTaskId: 0,
                    linkedHabitId: 0,
                    linkedGoalId: 0,
                    title: '',
                  })
                }
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {form.activityType === 'habit' && (
              <label>
                Scheduled habit
                <select
                  required
                  value={form.linkedHabitId || ''}
                  disabled={form.id !== null}
                  onChange={(event) => {
                    const id = Number(event.target.value);
                    setForm({
                      ...form,
                      linkedHabitId: id,
                      title:
                        data?.habits.find((habit) => habit.id === id)?.name ??
                        '',
                    });
                  }}
                >
                  <option value="">Choose a habit</option>
                  {data?.habits.map((habit) => (
                    <option key={habit.id} value={habit.id}>
                      {habit.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {form.activityType === 'task' && !form.id && (
              <label>
                Existing task (optional)
                <select
                  value={form.linkedTaskId || ''}
                  onChange={(event) => {
                    const id = Number(event.target.value);
                    setForm({
                      ...form,
                      linkedTaskId: id,
                      title:
                        data?.tasks.find((task) => task.id === id)?.title ?? '',
                    });
                  }}
                >
                  <option value="">Create a new task</option>
                  {data?.tasks
                    .filter(
                      (task) =>
                        !data.activities.some(
                          (activity) => activity.linkedTaskId === task.id,
                        ),
                    )
                    .map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Title
              <input
                required
                maxLength={100}
                value={form.title}
                disabled={
                  form.activityType === 'habit' ||
                  (form.activityType === 'task' &&
                    form.linkedTaskId !== 0 &&
                    form.id === null)
                }
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={5000}
                rows={2}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </label>
            <div className="agenda-form-grid">
              <label>
                Date
                <input
                  required
                  type="date"
                  value={form.scheduledDate}
                  disabled={form.activityType === 'habit' && form.id !== null}
                  onChange={(event) =>
                    setForm({ ...form, scheduledDate: event.target.value })
                  }
                />
              </label>
              <label>
                Priority
                <select
                  value={form.priority}
                  onChange={(event) =>
                    setForm({ ...form, priority: Number(event.target.value) })
                  }
                >
                  <option value={1}>High</option>
                  <option value={3}>Normal</option>
                  <option value={5}>Low</option>
                </select>
              </label>
              <label>
                Start time
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(event) =>
                    setForm({ ...form, startTime: event.target.value })
                  }
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(event) =>
                    setForm({ ...form, endTime: event.target.value })
                  }
                />
              </label>
            </div>
            {form.activityType === 'goal_action' && (
              <label>
                Related goal (optional)
                <select
                  value={form.linkedGoalId || ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      linkedGoalId: Number(event.target.value),
                    })
                  }
                >
                  <option value="">No goal</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Time cue (optional)
              <input
                type="time"
                value={form.reminderTime}
                onChange={(event) =>
                  setForm({ ...form, reminderTime: event.target.value })
                }
              />
              <small>Shown in the agenda; notifications are not sent.</small>
            </label>
            <label>
              Notes
              <textarea
                maxLength={5000}
                rows={2}
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </label>
            <div className="agenda-form-actions">
              <button type="submit" disabled={busyKey !== null || offline}>
                {busyKey === 'form' ? 'Saving…' : 'Save activity'}
              </button>
              <button
                className="quiet"
                type="button"
                onClick={() => setForm(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}
