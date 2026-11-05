import { Fragment, FormEvent, useEffect, useState } from 'react';

type RunStatus =
  | 'UNKNOWN'
  | 'CREATED'
  | 'EXPLORED'
  | 'PLANNED'
  | 'INSPECTED'
  | 'GENERATED'
  | 'EXECUTED'
  | 'ANALYZED'
  | 'DONE'
  | 'FAILED';

type TestOutcome = 'PASSED' | 'FAILED' | 'SKIPPED' | 'PENDING';

interface TestCaseResult {
  id: string;
  description: string;
  type: 'happy' | 'negative' | 'edge';
  source: 'stated' | 'inferred';
  preconditions?: string;
  steps?: string[];
  expectedResult?: string;
  priority?: 'high' | 'medium' | 'low';
  outcome: TestOutcome;
  reason: string;
  durationMs?: number;
}

interface SyntheticInput {
  field: string;
  value: string;
  rationale: string;
  needsRealValue: boolean;
}

interface RunStatusResponse {
  status: RunStatus;
  message?: string;
  provider?: string;
  model?: string;
  results?: TestCaseResult[];
  summary?: { total: number; passed: number; failed: number; skipped: number };
  syntheticInputs?: SyntheticInput[];
  advisories?: string[];
  exploration?: { stepsVisited: number; reachedGoal: boolean; stoppedBecause?: string };
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:3000';
const TERMINAL_STATUSES = new Set<RunStatus>(['DONE', 'FAILED']);

/** Ordered so progress reads as a pipeline rather than an opaque status string. */
const STAGES: RunStatus[] = [
  'CREATED',
  'EXPLORED',
  'PLANNED',
  'GENERATED',
  'EXECUTED',
  'DONE',
];

const OUTCOME_STYLE: Record<TestOutcome, { bg: string; fg: string }> = {
  PASSED: { bg: '#e3f2e9', fg: '#1b7f4b' },
  FAILED: { bg: '#fbe6e2', fg: '#a8321f' },
  SKIPPED: { bg: '#f0f0f0', fg: '#5a646e' },
  PENDING: { bg: '#fbf0da', fg: '#96620a' },
};

function App() {
  const [prdText, setPrdText] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      return;
    }

    let isDisposed = false;
    let intervalId = 0;

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
        setError(null);

        if (TERMINAL_STATUSES.has(payload.status)) {
          window.clearInterval(intervalId);
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

    // Start the timer before the first fetch so an already-terminal run can clear it.
    intervalId = window.setInterval(() => {
      void fetchStatus();
    }, 2000);
    void fetchStatus();

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, [runId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError(null);
    setStatus(null);
    setRunId(null);
    setExpanded(null);
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
        requestError instanceof Error ? requestError.message : 'Failed to start run',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const results = status?.results ?? [];
  const summary = status?.summary;
  const isRunning = Boolean(runId) && !TERMINAL_STATUSES.has(status?.status ?? 'CREATED');

  return (
    <div style={S.page}>
      <h1 style={S.h1}>AI QA Agent</h1>
      <p style={S.sub}>
        Give it a URL and describe what to test. It walks the app, writes the cases,
        runs them, and reports what passed.
      </p>

      <form onSubmit={handleSubmit} style={S.form}>
        <label style={S.label}>
          Target URL
          <input
            id="baseUrl"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://example.com/"
            required
            style={S.input}
          />
        </label>
        <label style={S.label}>
          What should be tested?
          <textarea
            id="prdText"
            value={prdText}
            onChange={(event) => setPrdText(event.target.value)}
            rows={5}
            required
            placeholder={
              'Create a walk-in and test the estimation step for a physical transaction type.\n\nInclude any credentials or test data here, e.g. log in with employee ID WG00001 and password ••••••'
            }
            style={{ ...S.input, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <small style={S.hint}>
            Credentials and test data go in here. Anything you leave out, the agent
            invents — and tells you what it used.
          </small>
        </label>
        <button type="submit" disabled={isSubmitting || isRunning} style={S.button}>
          {isSubmitting ? 'Starting…' : isRunning ? 'Running…' : 'Run tests'}
        </button>
      </form>

      {error && <p style={S.error}>{error}</p>}

      {runId && (
        <section style={{ marginTop: '2.5rem' }}>
          <Progress status={status?.status ?? 'CREATED'} />

          <div style={S.metaRow}>
            <span style={S.meta}>
              Run <code>{runId.slice(0, 8)}</code>
            </span>
            {status?.provider && (
              <span style={S.meta}>
                Engine <code>{status.provider}</code> · {status.model}
              </span>
            )}
            {status?.exploration && (
              <span style={S.meta}>
                {status.exploration.stepsVisited} screen
                {status.exploration.stepsVisited === 1 ? '' : 's'} explored
                {status.exploration.reachedGoal ? ' · goal reached' : ' · goal not reached'}
              </span>
            )}
          </div>

          {status?.status === 'FAILED' && status.message && (
            <p style={S.error}>{status.message}</p>
          )}

          {status?.advisories?.map((note) => (
            <p key={note} style={S.advisory}>
              {note}
            </p>
          ))}

          {summary && summary.total > 0 && (
            <div style={S.summaryRow}>
              <Stat label="Total" value={summary.total} />
              <Stat label="Passed" value={summary.passed} tone="PASSED" />
              <Stat label="Failed" value={summary.failed} tone="FAILED" />
              <Stat label="Not run" value={summary.skipped} tone="SKIPPED" />
            </div>
          )}

          {results.length > 0 && (
            <>
              <div style={S.tableHead}>
                <h2 style={S.h2}>Test suite</h2>
                <a
                  href={`${API_BASE_URL}/agent-runs/${runId}/report.xlsx`}
                  style={{
                    ...S.download,
                    ...(status?.status === 'DONE' ? {} : S.downloadDisabled),
                  }}
                >
                  Download Excel
                </a>
              </div>
              {status?.status !== 'DONE' && (
                <small style={S.hint}>
                  The report is downloadable now, but outcomes are still filling in
                  until the run finishes.
                </small>
              )}
              <ResultsTable
                results={results}
                expanded={expanded}
                onToggle={(id) => setExpanded(expanded === id ? null : id)}
              />
            </>
          )}

          {status?.syntheticInputs && status.syntheticInputs.length > 0 && (
            <>
              <h2 style={S.h2}>Data the agent invented</h2>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Field</th>
                    <th style={S.th}>Value used</th>
                    <th style={S.th}>Needs a real value?</th>
                  </tr>
                </thead>
                <tbody>
                  {status.syntheticInputs.map((input) => (
                    <tr key={`${input.field}-${input.value}`}>
                      <td style={S.td}>
                        <code>{input.field}</code>
                      </td>
                      <td style={S.td}>
                        <code>{input.value}</code>
                      </td>
                      <td style={S.td}>
                        {input.needsRealValue ? (
                          <span style={S.needsReal}>yes — likely rejected</span>
                        ) : (
                          'no'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {results.length === 0 && status?.status !== 'FAILED' && (
            <p style={S.waiting}>
              {status?.status === 'CREATED' || status?.status === 'EXPLORED'
                ? 'Walking the application…'
                : 'Building the test suite…'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Progress({ status }: { status: RunStatus }) {
  const reached = STAGES.indexOf(status === 'FAILED' ? 'DONE' : status);
  return (
    <ol style={S.stages}>
      {STAGES.map((stage, index) => {
        const done = reached >= index && status !== 'FAILED';
        const active = reached === index;
        return (
          <li
            key={stage}
            style={{
              ...S.stage,
              color: done ? '#15605c' : '#8a939c',
              fontWeight: active ? 700 : 400,
              borderBottomColor: done ? '#15605c' : '#d8dce0',
            }}
          >
            {stage.toLowerCase()}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: TestOutcome;
}) {
  const colour = tone ? OUTCOME_STYLE[tone] : { bg: '#eef0f2', fg: '#15191d' };
  return (
    <div style={{ ...S.stat, background: colour.bg }}>
      <strong style={{ ...S.statValue, color: colour.fg }}>{value}</strong>
      <span style={S.statLabel}>{label}</span>
    </div>
  );
}

function ResultsTable({
  results,
  expanded,
  onToggle,
}: {
  results: TestCaseResult[];
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <table style={S.table}>
      <thead>
        <tr>
          <th style={{ ...S.th, width: '4.5rem' }}>TC</th>
          <th style={S.th}>Description</th>
          <th style={{ ...S.th, width: '5.5rem' }}>Status</th>
          <th style={S.th}>Reason</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => {
          const style = OUTCOME_STYLE[result.outcome];
          const isOpen = expanded === result.id;
          return (
            <Fragment key={result.id}>
              <tr onClick={() => onToggle(result.id)} style={{ cursor: 'pointer' }}>
                <td style={{ ...S.td, fontFamily: 'monospace' }}>{result.id}</td>
                <td style={S.td}>
                  {result.description}
                  <div style={S.tags}>
                    <span style={S.tag}>{result.type}</span>
                    {result.priority && <span style={S.tag}>{result.priority}</span>}
                    {result.source === 'inferred' && (
                      <span style={{ ...S.tag, ...S.inferredTag }}>
                        added by agent
                      </span>
                    )}
                  </div>
                </td>
                <td style={S.td}>
                  <span
                    style={{ ...S.badge, background: style.bg, color: style.fg }}
                  >
                    {result.outcome}
                  </span>
                </td>
                <td style={{ ...S.td, color: '#5a646e' }}>{result.reason}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td style={S.detailCell} colSpan={4}>
                    {result.preconditions && (
                      <p style={S.detailP}>
                        <strong>Preconditions: </strong>
                        {result.preconditions}
                      </p>
                    )}
                    {result.steps && result.steps.length > 0 && (
                      <>
                        <strong style={S.detailLabel}>Steps</strong>
                        <ol style={S.detailList}>
                          {result.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </>
                    )}
                    {result.expectedResult && (
                      <p style={S.detailP}>
                        <strong>Expected: </strong>
                        {result.expectedResult}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    padding: '2rem 1rem 4rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: 1040,
    margin: '0 auto',
    color: '#15191d',
    lineHeight: 1.55,
  },
  h1: { fontSize: '1.9rem', margin: '0 0 0.3rem', letterSpacing: '-0.02em' },
  sub: { margin: '0 0 2rem', color: '#5a646e', maxWidth: '36rem' },
  h2: { fontSize: '1.05rem', margin: '2rem 0 0.7rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.1rem', maxWidth: '38rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontWeight: 600, fontSize: '0.92rem' },
  input: {
    width: '100%',
    padding: '0.55rem 0.7rem',
    border: '1px solid #b9c0c7',
    borderRadius: 4,
    fontSize: '0.95rem',
    fontWeight: 400,
  },
  hint: { fontWeight: 400, color: '#8a939c', fontSize: '0.82rem' },
  button: {
    padding: '0.6rem 1.2rem',
    background: '#15605c',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  error: { color: '#a8321f', background: '#fbe6e2', padding: '0.6rem 0.8rem', borderRadius: 4 },
  advisory: {
    color: '#96620a',
    background: '#fbf0da',
    padding: '0.6rem 0.8rem',
    borderRadius: 4,
    fontSize: '0.9rem',
    margin: '0 0 0.6rem',
  },
  stages: {
    display: 'flex',
    gap: '0.4rem',
    listStyle: 'none',
    padding: 0,
    margin: '0 0 1rem',
    flexWrap: 'wrap',
  },
  stage: {
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '2px solid',
    paddingBottom: '0.2rem',
    flex: '1 1 5rem',
    minWidth: '4.5rem',
  },
  metaRow: { display: 'flex', gap: '1.2rem', flexWrap: 'wrap', margin: '0 0 1rem' },
  meta: { fontSize: '0.84rem', color: '#5a646e' },
  summaryRow: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', margin: '0.5rem 0 0' },
  stat: { padding: '0.6rem 1rem', borderRadius: 4, minWidth: '5.5rem' },
  statValue: { display: 'block', fontSize: '1.5rem', lineHeight: 1 },
  statLabel: { fontSize: '0.78rem', color: '#5a646e' },
  tableHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  download: {
    padding: '0.45rem 0.9rem',
    background: '#15605c',
    color: '#fff',
    borderRadius: 4,
    textDecoration: 'none',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  downloadDisabled: { background: '#8a939c' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.88rem',
    border: '1px solid #d8dce0',
    borderRadius: 4,
  },
  th: {
    textAlign: 'left',
    padding: '0.5rem 0.7rem',
    background: '#eef0f2',
    borderBottom: '1px solid #d8dce0',
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#5a646e',
  },
  td: {
    padding: '0.55rem 0.7rem',
    borderBottom: '1px solid #eef0f2',
    verticalAlign: 'top',
  },
  badge: {
    display: 'inline-block',
    padding: '0.15rem 0.45rem',
    borderRadius: 3,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  tags: { display: 'flex', gap: '0.3rem', marginTop: '0.3rem', flexWrap: 'wrap' },
  tag: {
    fontSize: '0.68rem',
    background: '#eef0f2',
    color: '#5a646e',
    padding: '0.1rem 0.35rem',
    borderRadius: 3,
  },
  inferredTag: { background: '#ddeceb', color: '#15605c' },
  needsReal: { color: '#96620a', fontWeight: 600 },
  detailCell: { padding: '0.7rem 0.9rem', background: '#f6f7f8', borderBottom: '1px solid #d8dce0' },
  detailP: { margin: '0 0 0.4rem', fontSize: '0.87rem' },
  detailLabel: { fontSize: '0.87rem' },
  detailList: { margin: '0.2rem 0 0.6rem', paddingLeft: '1.2rem', fontSize: '0.87rem' },
  waiting: { color: '#5a646e', fontStyle: 'italic' },
};

export default App;
