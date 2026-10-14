import { useEffect, useRef, useState } from 'react';
import type { ApiRequest } from './features.tsx';

type Focus = 'today' | 'habits' | 'goals' | 'journal';
type Area = 'Habit' | 'Task' | 'Goal' | 'Journal';
type Recommendation = {
  title: string;
  area: Area;
  nextAction: string;
  priority: 'high' | 'medium' | 'low';
  confidence: 'observed' | 'tentative';
  evidence: { id: string; summary: string; source: string }[];
};
type Guidance = {
  status: 'ready' | 'insufficient_data';
  dataDate: string;
  generatedAt: string | null;
  message?: string;
  dailyFocus?: string;
  recommendations: Recommendation[];
  reflectionQuestions: string[];
  journalIncluded?: boolean;
};

export function MentorPanel({
  api,
  compact = false,
  onOpenArea,
}: {
  api: ApiRequest;
  compact?: boolean;
  onOpenArea?: ((area: Area) => void) | undefined;
}) {
  const [focus, setFocus] = useState<Focus>(compact ? 'journal' : 'today');
  const [consent, setConsent] = useState(false);
  const [consentLoading, setConsentLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [error, setError] = useState('');
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let live = true;
    void apiRef
      .current<{ consent: boolean }>('/api/v1/mentor/consent')
      .then((value) => {
        if (live) setConsent(value.consent);
      })
      .catch((cause) => {
        if (live)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not read AI settings',
          );
      })
      .finally(() => {
        if (live) setConsentLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  async function toggleConsent(next: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ consent: boolean }>(
        '/api/v1/mentor/consent',
        'PUT',
        { consent: next },
      );
      setConsent(result.consent);
      setGuidance(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update consent',
      );
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    setBusy(true);
    setError('');
    setGuidance(null);
    try {
      const result = await api<Guidance>('/api/v1/mentor/guidance', 'POST', {
        focus,
        includeJournal: consent,
      });
      setGuidance(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'AI Mentor is unavailable',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={compact ? 'mentor-panel mentor-compact' : 'mentor-panel'}
      aria-labelledby={compact ? 'mentor-context-title' : 'mentor-title'}
    >
      <p className="eyebrow">OPTIONAL AI GUIDANCE</p>
      <h2 id={compact ? 'mentor-context-title' : 'mentor-title'}>AI Mentor</h2>
      <p>
        Ask for practical next steps grounded in your recorded habits, tasks,
        and goals. AI suggestions may be imperfect; review the evidence before
        acting.
      </p>
      <div className="mentor-controls">
        <label>
          What should the mentor focus on?
          <select
            value={focus}
            disabled={busy}
            onChange={(event) => setFocus(event.target.value as Focus)}
          >
            <option value="today">Today’s focus</option>
            <option value="habits">Habit patterns</option>
            <option value="goals">Goal progress</option>
            <option value="journal">Journal reflection</option>
          </select>
        </label>
        <label className="mentor-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy || consentLoading}
            onChange={(event) => void toggleConsent(event.target.checked)}
          />
          <span>
            Allow recent journal entries, including saved drafts, to be sent to
            OpenAI when I request guidance. Up to seven entries from the last 14
            days may be included. I can turn this off any time.
          </span>
        </label>
        <p className="muted">
          Without this choice, the mentor uses only habits, tasks, and goals. No
          guidance is generated or sent automatically. OpenAI receives the
          selected context to generate a response; this app does not save the AI
          response.
        </p>
        <div className="habit-actions">
          <button
            type="button"
            disabled={busy || consentLoading}
            onClick={() => void generate()}
          >
            {busy
              ? 'Getting guidance…'
              : guidance
                ? 'Ask again'
                : 'Get guidance'}
          </button>
          {guidance && (
            <button
              type="button"
              className="quiet"
              onClick={() => setGuidance(null)}
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error} You can continue using the journal and tracker.
        </p>
      )}
      {guidance?.status === 'insufficient_data' && (
        <p role="status">{guidance.message}</p>
      )}
      {guidance?.status === 'ready' && (
        <div className="mentor-output" role="status">
          <h3>Focus for today</h3>
          <p>{guidance.dailyFocus}</p>
          <p className="muted">
            AI-generated on {new Date(guidance.generatedAt!).toLocaleString()}{' '}
            from data through {guidance.dataDate}. Journal{' '}
            {guidance.journalIncluded
              ? 'included with consent'
              : 'not included'}
            .
          </p>
          <h3>Suggested next steps</h3>
          <ol className="mentor-recommendations">
            {guidance.recommendations.map((item, index) => (
              <li key={`${index}-${item.title}`}>
                <div className="mentor-rec-head">
                  <strong>{item.title}</strong>
                  <span>
                    {item.area} · {item.priority} priority ·{' '}
                    {item.confidence === 'observed'
                      ? 'record-based'
                      : 'tentative'}
                  </span>
                </div>
                <p>
                  <b>Next action:</b> {item.nextAction}
                </p>
                {onOpenArea && (
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => onOpenArea(item.area)}
                  >
                    Open{' '}
                    {item.area === 'Habit'
                      ? 'Habits'
                      : item.area === 'Task'
                        ? 'Tasks'
                        : item.area === 'Goal'
                          ? 'Goals'
                          : 'Journal'}
                  </button>
                )}
                <details>
                  <summary>Why this suggestion?</summary>
                  <ul>
                    {item.evidence.map((source) => (
                      <li key={source.id}>
                        {source.summary} <small>({source.source})</small>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
          {guidance.reflectionQuestions.length > 0 && (
            <>
              <h3>Questions to consider</h3>
              <ul>
                {guidance.reflectionQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
