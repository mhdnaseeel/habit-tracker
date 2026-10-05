import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
type Status = 'loading' | 'ok' | 'unavailable';
function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void fetch('/health/ready', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<{ status: string }>;
      })
      .then((data) => setStatus(data.status === 'ok' ? 'ok' : 'unavailable'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('unavailable');
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <main>
      <p className="eyebrow">HABIT TRACKER · FOUNDATION</p>
      <h1>A calm place for your routines.</h1>
      <p>
        Application setup is in progress. Habit tracking will become available
        after the authenticated workflows are implemented and verified.
      </p>
      <section aria-labelledby="connection">
        <h2 id="connection">Backend connection</h2>
        <p role="status" aria-live="polite">
          {status === 'loading'
            ? 'Checking the database connection…'
            : status === 'ok'
              ? 'The API and database are connected.'
              : 'The backend is unavailable. Start the API and database, then retry.'}
        </p>
        {status === 'unavailable' && (
          <button onClick={() => setAttempt((a) => a + 1)}>
            Retry connection
          </button>
        )}
      </section>
      <p className="note">
        No account or habit data is simulated on this setup screen.
      </p>
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
