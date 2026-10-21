import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
} from 'react';
import {
  addCalendarDays,
  readableDate,
  weekDates,
  weekRange,
} from './calendar.ts';

export type ApiRequest = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
type ProfileUser = {
  name: string;
  email: string;
  timezone: string;
  version: number;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
};
type Task = {
  id: number;
  title: string;
  dueDate: string;
  displayDate: string;
  completed: boolean;
  carryOver: boolean;
};
type Mindset = {
  date: string;
  energy: number;
  focus: number;
  motivation: number;
};
type Goal = {
  id: number;
  title: string;
  description: string;
  category: string;
  deadline: string | null;
  version: number;
  steps: { id: number; title: string; completed: boolean }[];
  habitIds: number[];
  progress: { completed: number; total: number; percentage: number | null };
};
type Habit = { id: number; name: string };
type Insight = {
  overall: { completed: number; due: number; percentage: number | null };
  comparison: {
    thisWeek: number | null;
    lastWeek: number | null;
    deltaPoints: number | null;
  };
  weeks: {
    from: string;
    completed: number;
    due: number;
    percentage: number | null;
  }[];
  leaderboard: {
    id: number;
    name: string;
    completed: number;
    due: number;
    percentage: number | null;
    thisWeek: number | null;
    lastWeek: number | null;
  }[];
  strongest: { id: number; name: string; percentage: number | null }[];
  slipping: {
    id: number;
    name: string;
    thisWeek: number | null;
    lastWeek: number | null;
  }[];
};
type ReportOverview = {
  date: string;
  aiAvailable: boolean;
  comparison: {
    thisWeek: { completed: number; due: number; percentage: number | null };
    sameDaysLastWeek: {
      completed: number;
      due: number;
      percentage: number | null;
    };
  };
  pendingHabits: { id: number; name: string }[];
  pendingTasks: {
    id: number;
    title: string;
    dueDate: string;
    overdue: boolean;
  }[];
  morePendingTasks: boolean;
  pendingGoalSteps: {
    id: number;
    title: string;
    goal: string;
    deadline: string | null;
  }[];
  morePendingGoalSteps: boolean;
  slipping: {
    id: number;
    name: string;
    thisWeek: number;
    lastWeek: number;
  }[];
  focus: { label: string; reason: string }[];
  suggestions: {
    priorities: Suggestion[];
    strength: string | null;
    improvement: string | null;
    insufficientData: boolean;
  };
};
type Suggestion = {
  id: string;
  area: 'Habit' | 'Task' | 'Goal';
  title: string;
  evidence: string;
  action: string;
};

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Request failed';
}
function percent(value: number | null) {
  return value === null ? 'No data' : `${value}%`;
}

export function TaskTracker({
  api,
  today,
}: {
  api: ApiRequest;
  today: string;
}) {
  const week = weekRange(today);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [mindset, setMindset] = useState<Mindset[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [title, setTitle] = useState('');
  const [energy, setEnergy] = useState(3);
  const [focus, setFocus] = useState(3);
  const [motivation, setMotivation] = useState(3);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const [taskData, moodData] = await Promise.all([
      api<{ tasks: Task[] }>(`/api/v1/tasks?from=${week.from}&to=${week.to}`),
      api<{ entries: Mindset[] }>(
        `/api/v1/mindset?from=${week.from}&to=${week.to}`,
      ),
    ]);
    setTasks(taskData.tasks);
    setMindset(moodData.entries);
  }
  useEffect(() => {
    void load().catch((cause) => setError(message(cause)));
  }, [today]);
  useEffect(() => {
    const refresh = () =>
      void load().catch((cause) => setError(message(cause)));
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [today]);
  useEffect(() => {
    const entry = mindset.find((item) => item.date === selectedDate);
    setEnergy(entry?.energy ?? 3);
    setFocus(entry?.focus ?? 3);
    setMotivation(entry?.motivation ?? 3);
  }, [selectedDate, mindset]);
  async function createTask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/v1/tasks', 'POST', {
        title,
        dueDate: selectedDate,
        carryOver: false,
      });
      setTitle('');
      await load();
      setNotice('Task added.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function changeTask(
    task: Task,
    action: 'complete' | 'undo' | 'archive',
  ) {
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/v1/tasks/${task.id}${action === 'archive' ? '' : `/${action}`}`,
        action === 'archive' ? 'DELETE' : 'POST',
      );
      await load();
      setNotice('Task updated.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function copyYesterday() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ copied: number }>(
        '/api/v1/tasks/copy',
        'POST',
        { from: addCalendarDays(selectedDate, -1), to: selectedDate },
      );
      await load();
      setNotice(
        `${result.copied} task${result.copied === 1 ? '' : 's'} copied.`,
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function saveMindset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/mindset/${selectedDate}`, 'PUT', {
        energy,
        focus,
        motivation,
      });
      await load();
      setNotice('Mindset saved.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  const dayTasks = tasks.filter((task) => task.displayDate === selectedDate);
  return (
    <section aria-labelledby="task-tracker-title">
      <p className="eyebrow">THIS WEEK</p>
      <h2 id="task-tracker-title">Weekly task tracker</h2>
      <p>
        Choose a day to see its tasks and record how you felt. Unfinished
        carry-over tasks appear on today.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="task-week">
        {weekDates(week.from).map((date) => {
          const daily = tasks.filter((task) => task.displayDate === date);
          const done = daily.filter((task) => task.completed).length;
          const value = daily.length
            ? Math.round((done / daily.length) * 100)
            : 0;
          return (
            <button
              key={date}
              className={
                selectedDate === date ? 'task-day selected' : 'task-day'
              }
              onClick={() => setSelectedDate(date)}
              aria-pressed={selectedDate === date}
            >
              <span>{readableDate(date, { weekday: 'short' })}</span>
              <strong>{readableDate(date, { day: 'numeric' })}</strong>
              <span
                className="mini-ring"
                style={{ '--ring-progress': `${value}%` } as CSSProperties}
              >
                {done}/{daily.length}
              </span>
            </button>
          );
        })}
      </div>
      <div className="section-head">
        <h3>{readableDate(selectedDate, { dateStyle: 'full' })}</h3>
        <button
          className="quiet"
          onClick={() => void copyYesterday()}
          disabled={busy || selectedDate > today}
        >
          Copy yesterday’s list
        </button>
      </div>
      <form className="inline-form" onSubmit={createTask}>
        <label>
          New task
          <input
            required
            maxLength={100}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Add task
        </button>
      </form>
      {dayTasks.length === 0 ? (
        <p>No tasks for this day.</p>
      ) : (
        <ul className="habit-list">
          {dayTasks.map((task) => (
            <li className="habit-row" key={task.id}>
              <div className="habit-copy">
                <strong>{task.title}</strong>
                {task.dueDate < selectedDate && <small>Carried over</small>}
              </div>
              <div className="habit-actions">
                <button
                  disabled={busy || (!task.completed && selectedDate > today)}
                  onClick={() =>
                    void changeTask(task, task.completed ? 'undo' : 'complete')
                  }
                >
                  {task.completed ? 'Undo' : 'Done'}
                </button>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => void changeTask(task, 'archive')}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="mindset-card" onSubmit={saveMindset}>
        <h3>Mindset check-in</h3>
        <p>Rate each from 1 (low) to 5 (high).</p>
        <div className="mindset-fields">
          {(
            [
              ['Energy', energy, setEnergy],
              ['Focus', focus, setFocus],
              ['Motivation', motivation, setMotivation],
            ] as const
          ).map(([label, value, setter]) => (
            <label key={label}>
              {label}
              <select
                value={value}
                onChange={(event) => setter(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5].map((number) => (
                  <option key={number} value={number}>
                    {number}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <button type="submit" disabled={busy || selectedDate > today}>
          Save mindset
        </button>
      </form>
    </section>
  );
}

export function GoalPlanner({ api }: { api: ApiRequest }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Health');
  const [deadline, setDeadline] = useState('');
  const [stepTitles, setStepTitles] = useState<Record<number, string>>({});
  const [linkIds, setLinkIds] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    const data = await api<{ goals: Goal[]; areas: string[] }>('/api/v1/goals');
    setGoals(data.goals);
    setAreas(data.areas);
    const all: Habit[] = [];
    let page = 1,
      total = 0;
    do {
      const result = await api<{ habits: Habit[]; total: number }>(
        `/api/v1/habits?limit=100&page=${page}`,
      );
      all.push(...result.habits);
      total = result.total;
      page++;
    } while (all.length < total);
    setHabits(all);
  }
  useEffect(() => {
    void load().catch((cause) => setError(message(cause)));
  }, []);
  useEffect(() => {
    const refresh = () =>
      void load().catch((cause) => setError(message(cause)));
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
      setNotice(success);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setEditing(null);
    setTitle('');
    setDescription('');
    setCategory('Health');
    setDeadline('');
  }
  async function saveGoal(event: FormEvent) {
    event.preventDefault();
    await run(
      async () => {
        await api(
          editing ? `/api/v1/goals/${editing.id}` : '/api/v1/goals',
          editing ? 'PUT' : 'POST',
          {
            title,
            description,
            category,
            deadline: deadline || null,
            ...(editing ? { version: editing.version } : {}),
          },
        );
        reset();
      },
      editing ? 'Goal updated.' : 'Goal created.',
    );
  }
  return (
    <section aria-labelledby="goals-title">
      <p className="eyebrow">DIRECTION</p>
      <h2 id="goals-title">Goal planner</h2>
      <p>
        Set a deadline, break the goal into steps, and connect a routine.
        Progress counts completed steps.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form className="create" onSubmit={saveGoal}>
        <h3>{editing ? 'Edit goal' : 'New goal'}</h3>
        <label>
          Goal title
          <input
            required
            maxLength={100}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={5000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Life area
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {(areas.length ? areas : ['Health']).map((area) => (
              <option key={area}>{area}</option>
            ))}
          </select>
        </label>
        <label>
          Deadline (optional)
          <input
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {editing ? 'Save goal' : 'Create goal'}
        </button>
        {editing && (
          <button type="button" className="quiet" onClick={reset}>
            Cancel
          </button>
        )}
      </form>
      {goals.length === 0 ? (
        <p>No goals yet.</p>
      ) : (
        <div className="goal-list">
          {goals.map((goal) => (
            <article key={goal.id} className="goal-card">
              <div className="section-head">
                <div>
                  <small>{goal.category}</small>
                  <h3>{goal.title}</h3>
                </div>
                <strong>
                  {goal.progress.completed}/{goal.progress.total} steps
                </strong>
              </div>
              <p>{goal.description}</p>
              {goal.deadline && (
                <p>
                  Deadline:{' '}
                  {readableDate(goal.deadline, { dateStyle: 'medium' })}
                </p>
              )}
              <progress
                max={goal.progress.total || 1}
                value={goal.progress.completed}
                aria-label={`${goal.progress.completed} of ${goal.progress.total} steps complete`}
              />
              <div className="habit-actions">
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    setEditing(goal);
                    setTitle(goal.title);
                    setDescription(goal.description);
                    setCategory(goal.category);
                    setDeadline(goal.deadline ?? '');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Edit
                </button>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${goal.title}?`))
                      void run(
                        () => api(`/api/v1/goals/${goal.id}`, 'DELETE'),
                        'Goal removed.',
                      );
                  }}
                >
                  Delete
                </button>
              </div>
              <h4>Steps</h4>
              {goal.steps.length ? (
                <ul className="step-list">
                  {goal.steps.map((step) => (
                    <li key={step.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={step.completed}
                          disabled={busy}
                          onChange={() =>
                            void run(
                              () =>
                                api(
                                  `/api/v1/goals/${goal.id}/steps/${step.id}`,
                                  'PUT',
                                  { completed: !step.completed },
                                ),
                              'Step updated.',
                            )
                          }
                        />
                        {step.title}
                      </label>
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api(
                                `/api/v1/goals/${goal.id}/steps/${step.id}`,
                                'DELETE',
                              ),
                            'Step deleted.',
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No steps yet.</p>
              )}
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(`/api/v1/goals/${goal.id}/steps`, 'POST', {
                      title: stepTitles[goal.id] ?? '',
                    });
                    setStepTitles((old) => ({ ...old, [goal.id]: '' }));
                  }, 'Step added.');
                }}
              >
                <label>
                  Add a step
                  <input
                    required
                    maxLength={100}
                    value={stepTitles[goal.id] ?? ''}
                    onChange={(event) =>
                      setStepTitles((old) => ({
                        ...old,
                        [goal.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <button disabled={busy}>Add</button>
              </form>
              <h4>Connected routines</h4>
              <div className="chips">
                {goal.habitIds.map((id) => (
                  <button
                    key={id}
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api(
                            `/api/v1/goals/${goal.id}/habits/${id}`,
                            'DELETE',
                          ),
                        'Routine unlinked.',
                      )
                    }
                  >
                    {habits.find((habit) => habit.id === id)?.name ??
                      `Routine ${id}`}{' '}
                    ×
                  </button>
                ))}
              </div>
              <div className="inline-form">
                <label>
                  Link routine
                  <select
                    value={linkIds[goal.id] ?? ''}
                    onChange={(event) =>
                      setLinkIds((old) => ({
                        ...old,
                        [goal.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose a routine</option>
                    {habits
                      .filter((habit) => !goal.habitIds.includes(habit.id))
                      .map((habit) => (
                        <option key={habit.id} value={habit.id}>
                          {habit.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={busy || !linkIds[goal.id]}
                  onClick={() =>
                    void run(
                      () =>
                        api(
                          `/api/v1/goals/${goal.id}/habits/${linkIds[goal.id]}`,
                          'POST',
                        ),
                      'Routine linked.',
                    )
                  }
                >
                  Link
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function InsightsPanel({ api }: { api: ApiRequest }) {
  const [weeks, setWeeks] = useState(8);
  const [data, setData] = useState<Insight | null>(null);
  const [error, setError] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void api<Insight>(`/api/v1/insights?weeks=${weeks}`)
        .then((value) => {
          if (live) setData(value);
        })
        .catch((cause) => {
          if (live) setError(message(cause));
        });
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
    };
  }, [weeks]);
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    drag.current = { x: event.clientX, left: scroll.current?.scrollLeft ?? 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag.current && scroll.current)
      scroll.current.scrollLeft =
        drag.current.left - (event.clientX - drag.current.x);
  }
  return (
    <section aria-labelledby="insights-title">
      <p className="eyebrow">PATTERNS</p>
      <h2 id="insights-title">Insights</h2>
      <p>
        Consistency is completed scheduled check-ins divided by scheduled
        check-ins through today. Rankings compare only your own routines.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label className="range-label">
        Weeks shown: {weeks}
        <input
          type="range"
          min={2}
          max={12}
          value={weeks}
          onChange={(event) => setWeeks(Number(event.target.value))}
        />
      </label>
      {!data ? (
        <p>Loading insights…</p>
      ) : (
        <>
          <div className="insight-summary">
            <div>
              <small>Overall consistency</small>
              <strong>{percent(data.overall.percentage)}</strong>
              <span>
                {data.overall.completed}/{data.overall.due} check-ins
              </span>
            </div>
            <div>
              <small>This week</small>
              <strong>{percent(data.comparison.thisWeek)}</strong>
              <span>
                Same days last week: {percent(data.comparison.lastWeek)}
              </span>
            </div>
            <div>
              <small>Week change</small>
              <strong>
                {data.comparison.deltaPoints === null
                  ? 'No comparison'
                  : `${data.comparison.deltaPoints > 0 ? '+' : ''}${data.comparison.deltaPoints} points`}
              </strong>
            </div>
          </div>
          <h3>Weekly trend</h3>
          <p>Drag the chart sideways to explore weeks.</p>
          <div
            className="trend-scroll"
            ref={scroll}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            role="region"
            tabIndex={0}
            aria-label="Weekly consistency chart"
          >
            <div className="trend-chart">
              {data.weeks.map((week) => (
                <div className="trend-column" key={week.from}>
                  <div className="trend-track">
                    <div style={{ height: `${week.percentage ?? 0}%` }} />
                  </div>
                  <strong>{percent(week.percentage)}</strong>
                  <small>
                    {readableDate(week.from, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </small>
                </div>
              ))}
            </div>
          </div>
          <div className="insight-lists">
            <div>
              <h3>Strongest routines</h3>
              {data.strongest.length ? (
                <ol>
                  {data.strongest.map((habit) => (
                    <li key={habit.id}>
                      {habit.name}: {percent(habit.percentage)}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No check-ins yet.</p>
              )}
            </div>
            <div>
              <h3>Slipping this week</h3>
              {data.slipping.length ? (
                <ul>
                  {data.slipping.map((habit) => (
                    <li key={habit.id}>
                      {habit.name}: {percent(habit.lastWeek)} to{' '}
                      {percent(habit.thisWeek)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No declines to show.</p>
              )}
            </div>
          </div>
          <h3>Personal leaderboard</h3>
          {data.leaderboard.length ? (
            <ol className="leaderboard">
              {data.leaderboard.map((habit) => (
                <li key={habit.id}>
                  <span>{habit.name}</span>
                  <strong>{percent(habit.percentage)}</strong>
                  <small>
                    {habit.completed}/{habit.due} check-ins
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No routines have scheduled check-ins in this range.</p>
          )}
        </>
      )}
    </section>
  );
}

export function ReportsPanel({ api }: { api: ApiRequest }) {
  const [data, setData] = useState<ReportOverview | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiError, setAiError] = useState('');
  async function refresh() {
    setLoading(true);
    setError('');
    setAiError('');
    try {
      setData(await api<ReportOverview>('/api/v1/reports/overview'));
      setAiSuggestions(null);
      setGeneratedAt('');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function generate() {
    setBusy(true);
    setAiError('');
    try {
      const result = await api<{
        suggestions: { priorities: Suggestion[] };
        generatedAt: string;
      }>('/api/v1/reports/ai', 'POST');
      setAiSuggestions(result.suggestions.priorities);
      setGeneratedAt(result.generatedAt);
    } catch (cause) {
      setAiError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!data) return;
    const lines = [
      `Habit Tracker report — ${data.date}`,
      `This week: ${data.comparison.thisWeek.completed}/${data.comparison.thisWeek.due} (${percent(data.comparison.thisWeek.percentage)})`,
      `Same days last week: ${data.comparison.sameDaysLastWeek.completed}/${data.comparison.sameDaysLastWeek.due} (${percent(data.comparison.sameDaysLastWeek.percentage)})`,
      `Habits due today: ${data.pendingHabits.map((item) => item.name).join(', ') || 'None'}`,
      `Pending tasks: ${data.pendingTasks.map((item) => `${item.title} (${item.dueDate})`).join(', ') || 'None'}`,
      `Open goal steps: ${data.pendingGoalSteps.map((item) => `${item.goal}: ${item.title}`).join(', ') || 'None'}`,
      `Suggested focus: ${data.focus.map((item) => `${item.label} — ${item.reason}`).join('; ') || 'Nothing urgent'}`,
      aiSuggestions
        ? `AI Suggestions prioritized ${generatedAt}:\n${aiSuggestions.map((item, index) => `${index + 1}. ${item.title} — ${item.evidence}. ${item.action}`).join('\n')}`
        : '',
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join('\n\n')], { type: 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `habit-report-${data.date}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <section aria-labelledby="reports-title">
      <p className="eyebrow">YOUR NEXT STEPS</p>
      <h2 id="reports-title">Analysis reports</h2>
      <p>
        A current snapshot of what is due, what is pending, and where your
        routine consistency changed. Refresh after check-ins or task updates.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="habit-actions">
        <button
          className="quiet"
          onClick={() => void refresh()}
          disabled={busy}
        >
          Refresh analysis
        </button>
        <button className="quiet" onClick={download} disabled={!data}>
          Download report
        </button>
      </div>
      {loading ? (
        <p>Loading your analysis…</p>
      ) : !data ? (
        <p>Your analysis could not be loaded. Try refreshing.</p>
      ) : (
        <>
          <div className="insight-summary">
            <div>
              <small>This week</small>
              <strong>{percent(data.comparison.thisWeek.percentage)}</strong>
              <span>
                {data.comparison.thisWeek.completed}/
                {data.comparison.thisWeek.due} scheduled check-ins
              </span>
            </div>
            <div>
              <small>Same days last week</small>
              <strong>
                {percent(data.comparison.sameDaysLastWeek.percentage)}
              </strong>
              <span>
                {data.comparison.sameDaysLastWeek.completed}/
                {data.comparison.sameDaysLastWeek.due} scheduled check-ins
              </span>
            </div>
            <div>
              <small>Needs attention</small>
              <strong>
                {data.pendingHabits.length + data.pendingTasks.length}
                {data.morePendingTasks ? '+' : ''}
              </strong>
              <span>habits and due or overdue tasks</span>
            </div>
          </div>
          <div className="settings-card">
            <h3>What to focus on next</h3>
            {data.focus.length ? (
              <ol>
                {data.focus.map((item, index) => (
                  <li key={`${item.label}-${index}`}>
                    <strong>{item.label}</strong> — {item.reason}
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                Nothing is currently due or overdue. Choose a small goal step
                when you are ready.
              </p>
            )}
          </div>
          <div className="report-grid">
            <div className="settings-card">
              <h3>Habits due today</h3>
              {data.pendingHabits.length ? (
                <ul>
                  {data.pendingHabits.map((item) => (
                    <li key={item.id}>{item.name}</li>
                  ))}
                </ul>
              ) : (
                <p>All scheduled habits are checked off.</p>
              )}
            </div>
            <div className="settings-card">
              <h3>Pending tasks</h3>
              {data.pendingTasks.length ? (
                <ul>
                  {data.pendingTasks.map((item) => (
                    <li key={item.id}>
                      {item.title}{' '}
                      <small>
                        {item.overdue ? 'Overdue' : 'Due today'} ·{' '}
                        {readableDate(item.dueDate, { dateStyle: 'medium' })}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No tasks are due or overdue.</p>
              )}
              {data.morePendingTasks && (
                <p>Showing the first 30 pending tasks.</p>
              )}
            </div>
            <div className="settings-card">
              <h3>Open goal steps</h3>
              {data.pendingGoalSteps.length ? (
                <ul>
                  {data.pendingGoalSteps.map((item) => (
                    <li key={item.id}>
                      {item.title}{' '}
                      <small>
                        for {item.goal}
                        {item.deadline
                          ? ` · ${readableDate(item.deadline, { dateStyle: 'medium' })}`
                          : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No open goal steps.</p>
              )}
              {data.morePendingGoalSteps && (
                <p>Showing the first 30 goal steps.</p>
              )}
            </div>
            <div className="settings-card">
              <h3>Routines needing attention</h3>
              {data.slipping.length ? (
                <ul>
                  {data.slipping.map((item) => (
                    <li key={item.id}>
                      {item.name}: {item.lastWeek}% → {item.thisWeek}%
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No week-over-week declines with comparable data.</p>
              )}
            </div>
          </div>
          <div className="settings-card ai-suggestions">
            <h3>AI Suggestions</h3>
            <p>
              Practical next steps based on your account data. AI can prioritize
              the grounded suggestions below; it sends candidate actions and
              week totals to OpenAI, without journal text, passwords, or tokens.
            </p>
            {data.suggestions.insufficientData ? (
              <p className="empty" role="status">
                There is not enough activity yet for specific suggestions. Add a
                habit, task, or goal step, then return here.
              </p>
            ) : (
              <>
                <div className="suggestion-context">
                  <div>
                    <h4>Strength</h4>
                    <p>
                      {data.suggestions.strength ??
                        'No completed scheduled check-ins recorded this week yet.'}
                    </p>
                  </div>
                  <div>
                    <h4>Area to improve</h4>
                    <p>
                      {data.suggestions.improvement ??
                        'No comparable decline or overdue task found in the available data.'}
                    </p>
                  </div>
                </div>
                {data.suggestions.priorities.length ? (
                  <>
                    <h4>
                      {aiSuggestions
                        ? 'AI-prioritized next steps'
                        : 'Next steps from your data'}
                    </h4>
                    <ol className="suggestion-list" aria-live="polite">
                      {(aiSuggestions ?? data.suggestions.priorities).map(
                        (item) => (
                          <li key={item.id}>
                            <span className="suggestion-area">{item.area}</span>
                            <strong>{item.title}</strong>
                            <p>{item.evidence}</p>
                            <p>
                              <b>Action:</b> {item.action}
                            </p>
                          </li>
                        ),
                      )}
                    </ol>
                  </>
                ) : (
                  <p role="status">
                    No pending actions to prioritize right now.
                  </p>
                )}
              </>
            )}
            {data.aiAvailable && data.suggestions.priorities.length > 0 && (
              <button onClick={() => void generate()} disabled={busy}>
                {busy ? 'Prioritizing…' : 'Prioritize with AI'}
              </button>
            )}
            {!data.aiAvailable && data.suggestions.priorities.length > 0 && (
              <p>
                AI prioritization needs a server API key. The data-based
                suggestions above are available now.
              </p>
            )}
            {busy && <p role="status">Prioritizing your next steps…</p>}
            {aiError && (
              <p className="error" role="alert">
                {aiError}
              </p>
            )}
            {aiSuggestions && (
              <p className="suggestion-timestamp">
                Prioritized {new Date(generatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function SettingsPanel({
  api,
  onDeleted,
}: {
  api: ApiRequest;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [assistantTokens, setAssistantTokens] = useState<
    {
      id: string;
      label: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
    }[]
  >([]);
  const [assistantLabel, setAssistantLabel] = useState('My assistant');
  const [assistantPassword, setAssistantPassword] = useState('');
  const [createdToken, setCreatedToken] = useState('');
  const [remoteConnections, setRemoteConnections] = useState<
    {
      id: string;
      name: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
    }[]
  >([]);
  async function loadAssistantTokens() {
    const result = await api<{ tokens: typeof assistantTokens }>(
      '/api/v1/mcp-tokens',
    );
    setAssistantTokens(result.tokens);
  }
  async function loadRemoteConnections() {
    const result = await api<{ connections: typeof remoteConnections }>(
      '/api/v1/mcp/connections',
    );
    setRemoteConnections(result.connections);
  }
  useEffect(() => {
    void loadAssistantTokens().catch((cause) => setError(message(cause)));
    void loadRemoteConnections().catch((cause) => setError(message(cause)));
  }, []);
  async function createAssistantToken(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setCreatedToken('');
    try {
      const result = await api<{ token: string }>(
        '/api/v1/mcp-tokens',
        'POST',
        { label: assistantLabel, password: assistantPassword },
      );
      setCreatedToken(result.token);
      setAssistantPassword('');
      await loadAssistantTokens();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function revokeAssistantToken(id: string) {
    if (
      !window.confirm(
        'Revoke this assistant token? The connected assistant will lose access.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/mcp-tokens/${id}`, 'DELETE');
      setCreatedToken('');
      await loadAssistantTokens();
      setNotice('Assistant token revoked.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function revokeRemoteConnection(id: string) {
    if (
      !window.confirm(
        'Disconnect this AI client? Its access will end immediately.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api('/api/v1/mcp/connections/' + id, 'DELETE');
      await loadRemoteConnections();
      setNotice('AI client disconnected.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    setBusy(true);
    setError('');
    try {
      const data = await api<unknown>('/api/v1/account/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'habit-tracker-export.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Export downloaded.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (
      !window.confirm(
        'Permanently delete your account and all its content? This cannot be undone.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api('/api/v1/account', 'DELETE', { password });
      onDeleted();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="settings-title">
      <p className="eyebrow">YOUR DATA</p>
      <h2 id="settings-title">Settings</h2>
      <p>
        Your routines and reflections are saved to your account and available
        when you sign in on another device. This app does not keep a separate
        browser copy.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="settings-card">
        <h3>Export your data</h3>
        <p>
          Download your account content as JSON. Passwords and session
          credentials are excluded.
        </p>
        <button disabled={busy} onClick={() => void exportData()}>
          Download export
        </button>
      </div>
      <div className="settings-card">
        <h3>Read-only assistant access</h3>
        <p>
          Create a token for the local MCP connector. It can read your today
          dashboard, routine grid, tasks, goals, journal, and mindset entries;
          it cannot change them. Tokens expire after 90 days and can be revoked
          here.
        </p>
        <form onSubmit={createAssistantToken}>
          <label>
            Token label
            <input
              required
              maxLength={100}
              value={assistantLabel}
              onChange={(event) => setAssistantLabel(event.target.value)}
            />
          </label>
          <label>
            Confirm your password
            <input
              type="password"
              required
              value={assistantPassword}
              onChange={(event) => setAssistantPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy}>Create read-only token</button>
        </form>
        {createdToken && (
          <div className="token-once" role="status">
            <strong>Copy this token now. It will not be shown again.</strong>
            <code>{createdToken}</code>
            <button
              className="quiet"
              onClick={() => void navigator.clipboard.writeText(createdToken)}
            >
              Copy token
            </button>
          </div>
        )}
        <p>
          See{' '}
          <a
            href="https://github.com/mhdnaseeel/habit-tracker/blob/main/docs/local-development.md"
            target="_blank"
            rel="noreferrer"
          >
            MCP setup instructions
          </a>{' '}
          for Claude Desktop and other local MCP clients.
        </p>
        {assistantTokens.filter((token) => !token.revoked_at).length > 0 && (
          <ul className="token-list">
            {assistantTokens
              .filter((token) => !token.revoked_at)
              .map((token) => (
                <li key={token.id}>
                  <span>
                    {token.label} · expires{' '}
                    {readableDate(token.expires_at.slice(0, 10), {
                      dateStyle: 'medium',
                    })}
                  </span>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => void revokeAssistantToken(token.id)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
      <div className="settings-card">
        <h3>Remote AI connections</h3>
        <p>
          Connect a compatible remote MCP client using this app’s MCP URL. You
          will sign in and approve read-only access. Connected clients can read
          your journal when asked, so choose one you trust.
        </p>
        <code>{window.location.origin + '/mcp'}</code>
        {remoteConnections.filter(
          (connection) =>
            !connection.revoked_at &&
            new Date(connection.expires_at) > new Date(),
        ).length === 0 ? (
          <p>No remote AI clients connected.</p>
        ) : (
          <ul className="token-list">
            {remoteConnections
              .filter(
                (connection) =>
                  !connection.revoked_at &&
                  new Date(connection.expires_at) > new Date(),
              )
              .map((connection) => (
                <li key={connection.id}>
                  <span>
                    {connection.name} · expires{' '}
                    {readableDate(connection.expires_at.slice(0, 10), {
                      dateStyle: 'medium',
                    })}
                  </span>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => void revokeRemoteConnection(connection.id)}
                  >
                    Disconnect
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
      <form className="settings-card" onSubmit={deleteAccount}>
        <h3>Delete account</h3>
        <p>
          This permanently removes the account and its content from this
          database. Enter your password to confirm.
        </p>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="destructive" disabled={busy}>
          Permanently delete account
        </button>
      </form>
    </section>
  );
}

export function ProfilePanel({
  api,
  user,
  onSaved,
}: {
  api: ApiRequest;
  user: ProfileUser;
  onSaved: (user: ProfileUser) => void;
}) {
  const [name, setName] = useState(user.name);
  const [age, setAge] = useState(user.age?.toString() ?? '');
  const [heightCm, setHeightCm] = useState(user.heightCm?.toString() ?? '');
  const [weightKg, setWeightKg] = useState(user.weightKg?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const numberOrNull = (value: string) =>
      value.trim() === '' ? null : Number(value);
    try {
      const result = await api<{ user: typeof user }>('/api/v1/user', 'PUT', {
        name: name.trim(),
        age: numberOrNull(age),
        heightCm: numberOrNull(heightCm),
        weightKg: numberOrNull(weightKg),
        version: user.version,
      });
      onSaved(result.user);
      setNotice('Profile saved.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="profile-title">
      <p className="eyebrow">YOUR DETAILS</p>
      <h2 id="profile-title">Profile</h2>
      <p>
        Keep your personal details up to date. These details stay private to
        your account.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form className="settings-card profile-form" onSubmit={save}>
        <label>
          Display name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Email
          <input
            value={user.email}
            readOnly
            aria-describedby="profile-email-note"
          />
        </label>
        <small id="profile-email-note">
          Email changes are not available here.
        </small>
        <div className="profile-grid">
          <label>
            Age (years)
            <input
              type="number"
              min="13"
              max="120"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            Height (cm)
            <input
              type="number"
              min="50"
              max="250"
              step="0.1"
              inputMode="decimal"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            Weight (kg)
            <input
              type="number"
              min="20"
              max="500"
              step="0.1"
              inputMode="decimal"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>
    </section>
  );
}
