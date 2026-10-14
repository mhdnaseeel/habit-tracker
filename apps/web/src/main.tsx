import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { monthRange, weekRange } from './calendar.ts';
import { HistoryPanel, type HistoryWeek } from './history.tsx';
import { TodayAgenda } from './today-agenda.tsx';
import {
  GoalPlanner,
  InsightsPanel,
  ReportsPanel,
  JournalPanel,
  SettingsPanel,
  TaskTracker,
} from './features.tsx';
import './styles.css';
const categories = [
  'Wellbeing',
  'Movement',
  'Learning',
  'Mindfulness',
  'Home',
  'Other',
] as const;
type Category = (typeof categories)[number];
type User = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  version: number;
};
type Today = {
  date: string;
  habits: { id: number; freezeAvailable: boolean }[];
};
type AuthResponse = {
  user: User;
  token: { accessToken: string; expiresIn: number };
};
type HabitSummary = {
  id: number;
  name: string;
  category: string | null;
  active: boolean;
  version: number;
  schedules: {
    effectiveFrom: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    weekdays: number[];
    monthDays: number[];
    target: number;
  }[];
};
type View =
  | 'today'
  | 'habits'
  | 'history'
  | 'tasks'
  | 'goals'
  | 'insights'
  | 'reports'
  | 'journal'
  | 'settings';
class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error?.message ?? 'Request could not be completed',
    );
  return body as T;
}
function App() {
  const token = useRef<string | null>(null);
  const refreshFlight = useRef<Promise<AuthResponse> | null>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [historyWeek, setHistoryWeek] = useState<HistoryWeek | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [historyMode, setHistoryMode] = useState<'week' | 'month'>('week');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [view, setView] = useState<View>('today');
  const [menuOpen, setMenuOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [habitName, setHabitName] = useState('');
  const [category, setCategory] = useState<Category>('Wellbeing');
  const [categoryFilter, setCategoryFilter] = useState<Category | 'All'>('All');
  const [editingHabit, setEditingHabit] = useState<HabitSummary | null>(null);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>(
    'daily',
  );
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState(1);
  const [target, setTarget] = useState(1);
  const [habitList, setHabitList] = useState<HabitSummary[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  useEffect(() => {
    if (showCreate) formHeading.current?.focus();
  }, [showCreate, editingHabit]);
  useEffect(() => {
    if (!menuOpen) return;
    navigation.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButton.current?.focus());
    };
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !navigation.current?.contains(event.target) &&
        !menuButton.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [menuOpen]);
  function refresh(): Promise<AuthResponse> {
    if (!refreshFlight.current) {
      refreshFlight.current = (async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const response = await fetch('/api/v1/refresh', {
            method: 'POST',
            credentials: 'same-origin',
          });
          if (response.status === 409 && attempt < 4) {
            await new Promise((resolve) =>
              setTimeout(resolve, 150 * (attempt + 1)),
            );
            continue;
          }
          const data = await decode<AuthResponse>(response);
          token.current = data.token.accessToken;
          setUser(data.user);
          return data;
        }
        throw new ApiError(409, 'Session refresh could not complete');
      })().finally(() => {
        refreshFlight.current = null;
      });
    }
    return refreshFlight.current;
  }
  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    const send = () =>
      fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(token.current
            ? { Authorization: `Bearer ${token.current}` }
            : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let response = await send();
    if (response.status === 401 && token.current) {
      try {
        await refresh();
        response = await send();
      } catch {
        token.current = null;
        setUser(null);
        throw new ApiError(401, 'Your session ended. Please sign in again.');
      }
    }
    return decode<T>(response);
  }
  async function loadToday() {
    const data = await request<Today>('/api/v1/today');
    setToday(data);
  }
  async function loadHabits() {
    const habits: HabitSummary[] = [];
    let page = 1;
    let total = 0;
    do {
      const data = await request<{ habits: HabitSummary[]; total: number }>(
        `/api/v1/habits?limit=100&page=${page}`,
      );
      habits.push(...data.habits);
      total = data.total;
      page++;
    } while (habits.length < total);
    setHabitList(habits);
  }
  async function loadHistory(
    offset: number,
    mode: 'week' | 'month' = historyMode,
  ) {
    if (!today) return;
    setHistoryLoading(true);
    try {
      const range =
        mode === 'week'
          ? weekRange(today.date, offset)
          : monthRange(today.date, offset);
      const data = await request<HistoryWeek>(
        `/api/v1/history?from=${range.from}&to=${range.to}`,
      );
      setHistoryMode(mode);
      setWeekOffset(offset);
      setHistoryWeek(data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load history',
      );
    } finally {
      setHistoryLoading(false);
    }
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const check = await fetch('/api/v1/session', {
          credentials: 'same-origin',
        });
        const state = await decode<{ hasSession: boolean }>(check);
        if (!state.hasSession) return;
        await refresh();
        if (!live) return;
        if (live) await loadToday();
      } catch (cause) {
        if (live && !(cause instanceof ApiError && cause.code === 401))
          setError(
            'Could not connect to the service. Retry when you are online.',
          );
      } finally {
        if (live) setChecking(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      void loadToday()
        .then(async () => {
          if (view === 'habits') await loadHabits();
          if (view === 'history') await loadHistory(weekOffset, historyMode);
        })
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not refresh account data',
          ),
        );
    };
    window.addEventListener('focus', sync);
    const interval = window.setInterval(sync, 60000);
    return () => {
      window.removeEventListener('focus', sync);
      window.clearInterval(interval);
    };
  }, [user?.id, view, weekOffset, historyMode]);
  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body =
        mode === 'signup'
          ? {
              email,
              password,
              name,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : { email, password };
      const data = await request<AuthResponse>(
        `/api/v1/${mode === 'signup' ? 'signup' : 'login'}`,
        'POST',
        body,
      );
      token.current = data.token.accessToken;
      setUser(data.user);
      setPassword('');
      await loadToday();
      setNotice(`Welcome${data.user.name ? `, ${data.user.name}` : ''}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }
  function closeHabitForm() {
    setShowCreate(false);
    setEditingHabit(null);
    setHabitName('');
    setCategory('Wellbeing');
    setFrequency('daily');
    setWeekdays([]);
    setTarget(1);
  }
  function openCreateHabit() {
    closeHabitForm();
    setShowCreate(true);
  }
  function editRoutine(habit: HabitSummary) {
    const schedule = habit.schedules.at(-1);
    setEditingHabit(habit);
    setHabitName(habit.name);
    setCategory(
      categories.includes(habit.category as Category)
        ? (habit.category as Category)
        : 'Other',
    );
    setFrequency(schedule?.frequency ?? 'daily');
    setWeekdays(schedule?.weekdays ?? []);
    setMonthDay(schedule?.monthDays[0] ?? 1);
    setTarget(schedule?.target ?? 1);
    setShowCreate(true);
  }
  async function saveHabit(event: FormEvent) {
    event.preventDefault();
    if (!today) return;
    setBusy(true);
    setError('');
    try {
      const schedule =
        frequency === 'daily'
          ? { frequency: 'daily' }
          : frequency === 'weekly'
            ? { frequency: 'weekly', weekdays }
            : { frequency: 'monthly', monthDays: [monthDay] };
      await request(
        editingHabit ? `/api/v1/habits/${editingHabit.id}` : '/api/v1/habits',
        editingHabit ? 'PUT' : 'POST',
        {
          name: habitName,
          category,
          schedule,
          target,
          ...(editingHabit
            ? { version: editingHabit.version }
            : { startDate: today.date }),
        },
      );
      closeHabitForm();
      await Promise.all([loadToday(), loadHabits()]);
      setNotice(
        editingHabit
          ? 'Routine updated. Schedule changes may start tomorrow if today was already checked in.'
          : 'Routine saved.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save routine',
      );
    } finally {
      setBusy(false);
    }
  }
  async function archiveHabit(habit: { id: number; name: string }) {
    if (
      !window.confirm(
        `Delete ${habit.name} from active routines? Its history will be kept.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/v1/habits/${habit.id}`, 'DELETE');
      closeHabitForm();
      await Promise.all([loadToday(), loadHabits()]);
      setNotice('Routine removed. Its history is still available.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not archive habit',
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await request('/api/v1/logout', 'POST');
      token.current = null;
      setUser(null);
      setToday(null);
      setHabitList(null);
      setHistoryWeek(null);
      setNotice('Signed out.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out');
    } finally {
      setBusy(false);
    }
  }
  async function showHabits() {
    closeHabitForm();
    setView('habits');
    setError('');
    try {
      await loadHabits();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load habits',
      );
    }
  }
  function showHistory() {
    closeHabitForm();
    setView('history');
    setError('');
    void loadHistory(0);
  }
  function showOther(next: View) {
    closeHabitForm();
    setError('');
    setView(next);
  }
  function accountDeleted() {
    token.current = null;
    setUser(null);
    setToday(null);
    setHabitList(null);
    setHistoryWeek(null);
    setView('today');
    setNotice('Your account was deleted.');
  }
  function navigate(next: View) {
    setMenuOpen(false);
    if (next === 'habits') void showHabits();
    else if (next === 'history') showHistory();
    else if (next === 'today') {
      closeHabitForm();
      setView('today');
    } else showOther(next);
  }
  const sections: { view: View; label: string }[] = [
    { view: 'today', label: 'Today' },
    { view: 'reports', label: 'Reports' },
    { view: 'habits', label: 'Habits' },
    { view: 'history', label: 'History' },
    { view: 'tasks', label: 'Tasks' },
    { view: 'goals', label: 'Goals' },
    { view: 'insights', label: 'Insights' },
    { view: 'journal', label: 'Journal' },
    { view: 'settings', label: 'Settings' },
  ];
  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">HABIT TRACKER</p>
          <h1>{user ? 'Your routines' : 'A calm place for your routines'}</h1>
        </div>
        {user && (
          <div className="header-actions">
            <button
              ref={menuButton}
              className="quiet menu-toggle"
              type="button"
              aria-controls="app-navigation"
              aria-expanded={menuOpen}
              aria-label={
                menuOpen ? 'Close navigation menu' : 'Open navigation menu'
              }
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">☰</span>
              <span>Menu</span>
            </button>
            <button
              className="quiet desktop-signout"
              onClick={signOut}
              disabled={busy}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button
            className="quiet"
            onClick={() => {
              setError('');
              if (user) void loadToday();
              else window.location.reload();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {checking ? (
        <p role="status">Checking your session…</p>
      ) : !user ? (
        <section className="auth" aria-labelledby="auth-title">
          <h2 id="auth-title">
            {mode === 'signup' ? 'Create your account' : 'Sign in'}
          </h2>
          <p>Track what matters, one day at a time.</p>
          <form onSubmit={submitAuth}>
            {mode === 'signup' && (
              <label>
                Display name
                <input
                  required
                  maxLength={100}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              Email
              <input
                required
                type="email"
                maxLength={255}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                minLength={mode === 'signup' ? 12 : 1}
                maxLength={128}
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy
                ? 'Please wait…'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>
          <button
            className="quiet switch"
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setError('');
            }}
          >
            {mode === 'signup'
              ? 'Already have an account? Sign in'
              : 'New here? Create an account'}
          </button>
        </section>
      ) : (
        <>
          <nav
            id="app-navigation"
            ref={navigation}
            className={`app-nav${menuOpen ? ' nav-open' : ''}`}
            aria-label="Available sections"
          >
            {sections.map((section) => (
              <button
                key={section.view}
                className={view === section.view ? 'active quiet' : 'quiet'}
                aria-current={view === section.view ? 'page' : undefined}
                onClick={() => navigate(section.view)}
              >
                {section.label}
              </button>
            ))}
            <button
              className="quiet mobile-signout"
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
              disabled={busy}
            >
              Sign out
            </button>
          </nav>
          {view === 'today' ? (
            today ? (
              <TodayAgenda
                api={request}
                today={today.date}
                todayHabits={today.habits}
                timezone={user.timezone}
                onChanged={loadToday}
              />
            ) : (
              <p>Loading your day…</p>
            )
          ) : view === 'habits' ? (
            <section aria-labelledby="habits-title">
              <div className="section-head">
                <h2 id="habits-title">Your routines</h2>
                <button
                  onClick={() =>
                    showCreate ? closeHabitForm() : openCreateHabit()
                  }
                  aria-expanded={showCreate}
                >
                  {showCreate ? 'Close form' : 'Add routine'}
                </button>
              </div>
              <label className="filter-label">
                Category
                <select
                  value={categoryFilter}
                  onChange={(event) =>
                    setCategoryFilter(event.target.value as Category | 'All')
                  }
                >
                  <option value="All">All categories</option>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              {habitList === null ? (
                <p>Loading routines…</p>
              ) : habitList.length === 0 ? (
                <p>No routines yet. Create one to begin.</p>
              ) : habitList.filter(
                  (habit) =>
                    categoryFilter === 'All' ||
                    (habit.category ?? 'Other') === categoryFilter,
                ).length === 0 ? (
                <p>No routines in this category.</p>
              ) : (
                <ul className="habit-list">
                  {habitList
                    .filter(
                      (habit) =>
                        categoryFilter === 'All' ||
                        (habit.category ?? 'Other') === categoryFilter,
                    )
                    .map((h) => (
                      <li key={h.id} className="habit-row">
                        <div className="habit-copy">
                          <strong>{h.name}</strong>
                          <small>
                            {h.category ?? 'Other'} ·{' '}
                            {h.schedules.at(-1)?.frequency ?? 'daily'}
                          </small>
                        </div>
                        <div className="habit-actions">
                          <button
                            className="quiet"
                            disabled={busy}
                            onClick={() => editRoutine(h)}
                          >
                            Edit
                          </button>
                          <button
                            className="quiet"
                            disabled={busy}
                            onClick={() => void archiveHabit(h)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          ) : view === 'history' ? (
            <HistoryPanel
              week={historyWeek}
              offset={weekOffset}
              mode={historyMode}
              loading={historyLoading}
              onChangeWeek={(offset) => void loadHistory(offset)}
              onChangeMode={(mode) => void loadHistory(0, mode)}
            />
          ) : view === 'tasks' ? (
            today ? (
              <TaskTracker api={request} today={today.date} />
            ) : (
              <p>Loading tasks…</p>
            )
          ) : view === 'goals' ? (
            <GoalPlanner api={request} />
          ) : view === 'insights' ? (
            <InsightsPanel api={request} />
          ) : view === 'reports' ? (
            <ReportsPanel api={request} />
          ) : view === 'journal' ? (
            today ? (
              <JournalPanel api={request} today={today.date} />
            ) : (
              <p>Loading journal…</p>
            )
          ) : (
            <SettingsPanel api={request} onDeleted={accountDeleted} />
          )}
          {showCreate && (
            <section className="create" aria-labelledby="create-title">
              <h2 id="create-title" ref={formHeading} tabIndex={-1}>
                {editingHabit ? 'Edit routine' : 'New routine'}
              </h2>
              <form onSubmit={saveHabit}>
                <label>
                  Name
                  <input
                    required
                    maxLength={100}
                    value={habitName}
                    onChange={(e) => setHabitName(e.target.value)}
                    placeholder="Name your habit"
                  />
                </label>
                <label>
                  Category
                  <select
                    value={category}
                    onChange={(event) =>
                      setCategory(event.target.value as Category)
                    }
                  >
                    {categories.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Repeat
                  <select
                    value={frequency}
                    onChange={(e) =>
                      setFrequency(e.target.value as typeof frequency)
                    }
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {frequency === 'weekly' && (
                  <fieldset>
                    <legend>Days of week</legend>
                    <div className="weekdays">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                        (day, index) => (
                          <label key={day}>
                            <input
                              type="checkbox"
                              checked={weekdays.includes(index)}
                              onChange={(e) =>
                                setWeekdays(
                                  e.target.checked
                                    ? [...weekdays, index]
                                    : weekdays.filter(
                                        (value) => value !== index,
                                      ),
                                )
                              }
                            />
                            {day}
                          </label>
                        ),
                      )}
                    </div>
                  </fieldset>
                )}
                {frequency === 'monthly' && (
                  <label>
                    Day of month
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={monthDay}
                      onChange={(e) => setMonthDay(Number(e.target.value))}
                    />
                  </label>
                )}
                <label>
                  Daily target
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !today ||
                    (frequency === 'weekly' && weekdays.length === 0)
                  }
                >
                  {editingHabit ? 'Save changes' : 'Save routine'}
                </button>
                <button
                  className="quiet"
                  type="button"
                  onClick={closeHabitForm}
                >
                  Cancel
                </button>
              </form>
            </section>
          )}
        </>
      )}
      <footer>
        <p>Your routines are saved to your account.</p>
      </footer>
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
