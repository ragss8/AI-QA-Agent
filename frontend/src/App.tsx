import { FormEvent, useEffect, useState } from 'react';

type RunStatus =
  | 'UNKNOWN'
  | 'CREATED'
  | 'PLANNED'
  | 'GENERATED'
  | 'DONE'
  | 'FAILED';

interface TestCase {
  id: string;
  description: string;
  type: 'happy' | 'negative' | 'edge';
}

interface TestPlan {
  feature: string;
  tests: TestCase[];
}

interface RunStatusResponse {
  status: RunStatus;
  plan?: TestPlan;
  message?: string;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:3000';
const TERMINAL_STATUSES = new Set<RunStatus>(['DONE', 'FAILED']);

function App() {
  const [prdText, setPrdText] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!runId) {
      return;
    }

    let isDisposed = false;
    let intervalId: number | undefined;

    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/agent-runs/${runId}`);
        if (!response.ok) {
          throw new Error(`Status request failed: ${response.status}`);
        }

        const payload = (await response.json()) as RunStatusResponse;
        if (isDisposed) {
          return;
        }

        setStatus(payload);

        if (TERMINAL_STATUSES.has(payload.status) && intervalId !== undefined) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
      } catch (requestError) {
        if (!isDisposed) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Failed to fetch run status',
          );
        }
      }
    };

    void fetchStatus();
    intervalId = window.setInterval(() => {
      void fetchStatus();
    }, 2000);

    return () => {
      isDisposed = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [runId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError(null);
    setStatus(null);
    setRunId(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/agent-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prdText: prdText.trim(),
          baseUrl: baseUrl.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const payload = (await response.json()) as { runId: string };
      setRunId(payload.runId);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to start run',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        padding: '2rem',
        fontFamily: 'sans-serif',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1>AI QA Agent</h1>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <label>
          Product Requirement:
          <textarea
            value={prdText}
            onChange={(event) => setPrdText(event.target.value)}
            rows={6}
            required
            style={{ width: '100%' }}
          />
        </label>
        <label>
          Base URL:
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
            style={{ width: '100%' }}
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          style={{ padding: '0.5rem 1rem' }}
        >
          {isSubmitting ? 'Starting...' : 'Run Tests'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {runId && (
        <div style={{ marginTop: '2rem' }}>
          <h2>Run ID: {runId}</h2>
          <p>Status: {status?.status ?? 'Waiting...'}</p>
          {status?.message && <p>{status.message}</p>}
          {status?.plan && (
            <div>
              <h3>Planned Test Cases</h3>
              <pre
                style={{
                  background: '#f0f0f0',
                  padding: '1rem',
                  borderRadius: '4px',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(status.plan, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
