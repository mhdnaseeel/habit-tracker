import { useEffect, useRef, useState } from 'react';
import { addCalendarDays, monthRange, readableDate } from './calendar.ts';
import type { ApiRequest } from './features.tsx';
import { MentorPanel } from './mentor.tsx';

type Prompt = { id: string; text: string };
type Blueprint = {
  id: string;
  name: string;
  description: string;
  prompts: Prompt[];
  version: number;
};
type Entry = {
  date: string;
  content: string;
  blueprintId: string | null;
  blueprintSnapshot: Prompt[] | null;
  responses: Record<string, string>;
  status: 'empty' | 'draft' | 'saved';
  version: number | null;
  updatedAt: string | null;
};
type Context = {
  habits: { id: number; name: string; status: string }[];
  goals: { id: number; title: string; completed: number; total: number }[];
};
type HabitHistory = {
  habits: {
    id: number;
    name: string;
    days: { scheduled: boolean; status: string | null }[];
  }[];
};
type HistoryItem = {
  date: string;
  status: string;
  blueprintName: string | null;
};

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : 'Request could not be completed';
}

export function JournalPanel({
  api,
  today,
  onRegisterLeave,
  onOpenArea,
}: {
  api: ApiRequest;
  today: string;
  onRegisterLeave?: (handler: (() => Promise<boolean>) | null) => void;
  onOpenArea?: (area: 'Habit' | 'Task' | 'Goal' | 'Journal') => void;
}) {
  const [selectedDate, setSelectedDate] = useState(today);
  const [entry, setEntry] = useState<Entry>({
    date: today,
    content: '',
    blueprintId: null,
    blueprintSnapshot: null,
    responses: {},
    status: 'empty',
    version: null,
    updatedAt: null,
  });
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [context, setContext] = useState<Context | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyMonth, setHistoryMonth] = useState(today.slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [entryReady, setEntryReady] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [contextError, setContextError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const draft = useRef(entry);
  const version = useRef<number | null>(null);
  const changed = useRef(0);
  const isDirty = useRef(false);
  const flight = useRef<Promise<boolean> | null>(null);
  const leave = useRef<() => Promise<boolean>>(async () => true);
  const [showMentor, setShowMentor] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const autoBlocked = useRef<number | null>(null);
  const loadedBlueprint = useRef<{
    id: string | null;
    snapshot: Prompt[] | null;
  }>({ id: null, snapshot: null });
  const historyRequest = useRef(0);

  useEffect(() => {
    const update = () => {
      autoBlocked.current = null;
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  useEffect(() => {
    let live = true;
    void apiRef
      .current<{ blueprints: Blueprint[] }>('/api/v1/journal/blueprints')
      .then((value) => {
        if (live) setBlueprints(value.blueprints);
      })
      .catch((cause) => {
        if (live) setError(errorMessage(cause));
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setEntryReady(false);
    setContext(null);
    setContextError('');
    setError('');
    void apiRef
      .current<Entry>(`/api/v1/journal/${selectedDate}`)
      .then((record) => {
        if (!live) return;
        draft.current = record;
        loadedBlueprint.current = {
          id: record.blueprintId,
          snapshot: record.blueprintSnapshot,
        };
        version.current = record.version;
        setEntry(record);
        isDirty.current = false;
        setDirty(false);
        setEntryReady(true);
        setLoading(false);
      })
      .catch((cause) => {
        if (!live) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    void Promise.all([
      apiRef.current<Context>(`/api/v1/journal/${selectedDate}/context`),
      apiRef.current<HabitHistory>(
        `/api/v1/history?from=${selectedDate}&to=${selectedDate}`,
      ),
    ])
      .then(([daily, habitHistory]) => {
        if (!live) return;
        setContext({
          ...daily,
          habits: habitHistory.habits.flatMap((habit) =>
            habit.days[0]?.scheduled
              ? [
                  {
                    id: habit.id,
                    name: habit.name,
                    status: habit.days[0].status ?? 'pending',
                  },
                ]
              : [],
          ),
        });
      })
      .catch((cause) => {
        if (!live) return;
        setContextError(errorMessage(cause));
      });
    return () => {
      live = false;
    };
  }, [selectedDate, reloadTick]);

  async function reloadHistory(month = historyMonth) {
    if (!/^\d{4}-\d{2}$/.test(month) || month > today.slice(0, 7)) return;
    const requestId = ++historyRequest.current;
    setHistory([]);
    const range = monthRange(`${month}-01`);
    try {
      const result = await apiRef.current<{ entries: HistoryItem[] }>(
        `/api/v1/journal/history?from=${range.from}&to=${range.to}`,
      );
      if (requestId === historyRequest.current) setHistory(result.entries);
    } catch (cause) {
      if (requestId === historyRequest.current) setError(errorMessage(cause));
    }
  }
  useEffect(() => {
    void reloadHistory();
  }, [historyMonth, selectedDate]);

  function edit(update: Partial<Entry>) {
    const next = { ...draft.current, ...update };
    draft.current = next;
    changed.current++;
    isDirty.current = true;
    setEntry(next);
    setDirty(true);
    setError('');
  }
  async function persist(status: 'draft' | 'saved'): Promise<boolean> {
    if (flight.current) {
      const result = await flight.current;
      if (!result) return false;
      if (!isDirty.current && status === 'draft') return true;
    }
    const current = draft.current;
    const sequence = changed.current;
    const send = async () => {
      setSaving(true);
      setError('');
      try {
        const result = await apiRef.current<Entry>(
          `/api/v1/journal/${selectedDate}`,
          'PUT',
          {
            content: current.content,
            blueprintId: current.blueprintId,
            responses: current.responses,
            status,
            version: version.current,
          },
        );
        version.current = result.version;
        if (sequence === changed.current) {
          draft.current = result;
          loadedBlueprint.current = {
            id: result.blueprintId,
            snapshot: result.blueprintSnapshot,
          };
          setEntry(result);
          isDirty.current = false;
          setDirty(false);
        } else {
          draft.current = { ...draft.current, version: result.version };
          setEntry(draft.current);
        }
        void reloadHistory();
        return true;
      } catch (cause) {
        autoBlocked.current = changed.current;
        setError(errorMessage(cause));
        return false;
      } finally {
        setSaving(false);
      }
    };
    flight.current = send();
    const result = await flight.current;
    flight.current = null;
    return result;
  }
  leave.current = async () => !isDirty.current || persist('draft');
  useEffect(() => {
    onRegisterLeave?.(() => leave.current());
    return () => onRegisterLeave?.(null);
  }, [onRegisterLeave]);
  useEffect(() => {
    if (
      !dirty ||
      loading ||
      saving ||
      !online ||
      autoBlocked.current === changed.current
    )
      return;
    const timer = window.setTimeout(() => {
      void persist('draft');
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, saving, online, entry]);

  async function changeDate(nextDate: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(nextDate) ||
      nextDate > today ||
      nextDate === selectedDate
    )
      return;
    if (!(await leave.current())) return;
    setSelectedDate(nextDate);
    setHistoryMonth(nextDate.slice(0, 7));
  }
  async function remove() {
    if (
      entry.version === null ||
      !window.confirm('Delete this daily journal entry?')
    )
      return;
    if (flight.current) await flight.current;
    setSaving(true);
    try {
      await apiRef.current(`/api/v1/journal/${selectedDate}`, 'DELETE', {
        version: version.current,
      });
      const empty: Entry = {
        date: selectedDate,
        content: '',
        blueprintId: null,
        blueprintSnapshot: null,
        responses: {},
        status: 'empty',
        version: null,
        updatedAt: null,
      };
      draft.current = empty;
      version.current = null;
      isDirty.current = false;
      setDirty(false);
      setEntry(empty);
      void reloadHistory();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  const selectedBlueprint = blueprints.find(
    (item) => item.id === entry.blueprintId,
  );
  const prompts = entry.blueprintSnapshot ?? selectedBlueprint?.prompts ?? [];
  const canFinish = Boolean(
    entry.content.trim() ||
    Object.values(entry.responses).some((value) => value.trim()),
  );
  return (
    <section aria-labelledby="journal-title">
      <p className="eyebrow">REFLECTION</p>
      <h2 id="journal-title">Daily journal</h2>
      <p>
        Write freely or follow a few prompts. Your draft saves to your account
        as you write.
      </p>
      {!online && (
        <p className="error" role="status">
          You are offline. Keep this page open; your unsaved changes will retry
          when the connection returns.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error} {dirty && 'Your unsaved text is still in this editor.'}
        </p>
      )}
      <div className="section-head journal-heading">
        <h3>{readableDate(selectedDate, { dateStyle: 'full' })}</h3>
        <div className="habit-actions">
          <button
            type="button"
            className="quiet"
            disabled={loading || saving}
            onClick={() => void changeDate(addCalendarDays(selectedDate, -1))}
          >
            Previous day
          </button>
          <button
            type="button"
            className="quiet"
            disabled={loading || saving || selectedDate >= today}
            onClick={() => void changeDate(addCalendarDays(selectedDate, 1))}
          >
            Next day
          </button>
        </div>
      </div>
      <label className="journal-date">
        Choose a day
        <input
          type="date"
          max={today}
          value={selectedDate}
          disabled={loading || saving}
          onChange={(event) => void changeDate(event.target.value)}
        />
      </label>
      <div className="journal-layout">
        <div>
          {loading ? (
            <p>Loading journal…</p>
          ) : !entryReady ? (
            <button
              type="button"
              className="quiet"
              onClick={() => setReloadTick((value) => value + 1)}
            >
              Retry loading entry
            </button>
          ) : (
            <div className="create journal-form">
              <label>
                Writing guide
                <select
                  value={entry.blueprintId ?? ''}
                  onChange={(event) => {
                    const id = event.target.value || null;
                    edit({
                      blueprintId: id,
                      blueprintSnapshot:
                        id === loadedBlueprint.current.id
                          ? loadedBlueprint.current.snapshot
                          : null,
                    });
                  }}
                >
                  <option value="">Blank journal</option>
                  {entry.blueprintId && !selectedBlueprint && (
                    <option value={entry.blueprintId}>
                      Previous writing guide
                    </option>
                  )}
                  {blueprints.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedBlueprint && (
                <p className="muted">
                  {selectedBlueprint.description} · Prompts are optional.
                </p>
              )}
              {prompts.map((prompt) => {
                const key = `${entry.blueprintId}:${prompt.id}`;
                return (
                  <label key={key}>
                    {prompt.text}
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={entry.responses[key] ?? ''}
                      onChange={(event) =>
                        edit({
                          responses: {
                            ...draft.current.responses,
                            [key]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                );
              })}
              <label>
                Your own words
                <textarea
                  rows={8}
                  maxLength={20000}
                  value={entry.content}
                  onChange={(event) => edit({ content: event.target.value })}
                />
              </label>
              <p className="journal-status" role="status">
                {saving
                  ? 'Saving…'
                  : dirty
                    ? online
                      ? 'Unsaved changes · autosave pending'
                      : 'Unsaved while offline'
                    : entry.status === 'draft'
                      ? 'Draft saved to your account'
                      : entry.status === 'saved'
                        ? 'Entry saved'
                        : 'No entry for this day yet'}
              </p>
              <div className="habit-actions">
                <button
                  type="button"
                  disabled={loading || saving || !canFinish || !online}
                  onClick={() => void persist('saved')}
                >
                  Finish entry
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={loading || saving || !dirty || !online}
                  onClick={() => void persist('draft')}
                >
                  Save draft
                </button>
                {entry.version !== null && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={loading || saving || !online}
                    onClick={() => void remove()}
                  >
                    Delete entry
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="journal-mentor">
            <button
              type="button"
              className="quiet"
              aria-expanded={showMentor}
              onClick={() => setShowMentor(!showMentor)}
            >
              {showMentor ? 'Hide AI Mentor' : 'Ask AI Mentor about this day'}
            </button>
            {showMentor && (
              <MentorPanel api={api} compact onOpenArea={onOpenArea} />
            )}
          </div>
        </div>
        <aside
          className="journal-side"
          aria-label="Journal context and history"
        >
          <div className="settings-card">
            <h3>Context for this day</h3>
            {contextError ? (
              <p className="error" role="alert">
                Context unavailable: {contextError}
              </p>
            ) : !context ? (
              <p>Loading context…</p>
            ) : (
              <>
                <h4>Recorded routines</h4>
                {context.habits.length ? (
                  <ul>
                    {context.habits.map((habit) => (
                      <li key={habit.id}>
                        {habit.name}: {habit.status}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No routine check-ins recorded for this day.</p>
                )}
                <h4>Active goals</h4>
                {context.goals.length ? (
                  <ul>
                    {context.goals.map((goal) => (
                      <li key={goal.id}>
                        {goal.title}: {goal.completed}/{goal.total} steps
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No active goals.</p>
                )}
              </>
            )}
          </div>
          <div className="settings-card">
            <h3>Entry history</h3>
            <label>
              Month
              <input
                type="month"
                max={today.slice(0, 7)}
                value={historyMonth}
                onChange={(event) => {
                  if (/^\d{4}-\d{2}$/.test(event.target.value))
                    setHistoryMonth(event.target.value);
                }}
              />
            </label>
            {history.length ? (
              <ul className="journal-history">
                {history.map((item) => (
                  <li key={item.date}>
                    <button
                      type="button"
                      className={
                        item.date === selectedDate ? 'active' : 'quiet'
                      }
                      onClick={() => void changeDate(item.date)}
                    >
                      {readableDate(item.date, {
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                      ·{' '}
                      {item.status === 'draft'
                        ? 'Draft'
                        : (item.blueprintName ?? 'Entry')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No entries in this month.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
