import React, { useState, useEffect } from 'react';

interface RunStatus {
  status: string;
  plan?: any;
  message?: string;
}

const App: React.FC = () => {
  const [prdText, setPrdText] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll run status when runId changes
  useEffect(() => {
    if (!runId) return;
    let interval: number;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`http://localhost:3000/agent-runs/${runId}`);
        const json = await res.json();
        setStatus(json);
        if (json.status === 'DONE' || json.status === 'FAILED') {
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    };
    // Immediately fetch once then poll every 2 seconds
    fetchStatus();
    interval = window.setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [runId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setRunId(null);
    try {
      const res = await fetch('http://localhost:3000/agent-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prdText, baseUrl }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const json = await res.json();
      setRunId(json.runId);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto' }}>
      <h1>AI QA Agent</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label>
          Product Requirement:
          <textarea
            value={prdText}
            onChange={(e) => setPrdText(e.target.value)}
            rows={4}
            required
            style={{ width: '100%' }}
          />
        </label>
        <label>
          Base URL:
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            required
            style={{ width: '100%' }}
          />
        </label>
        <button type="submit" style={{ padding: '0.5rem 1rem' }}>Run Tests</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {runId && (
        <div style={{ marginTop: '2rem' }}>
          <h2>Run ID: {runId}</h2>
          <p>Status: {status?.status || 'Waiting...'}</p>
          {status?.plan && (
            <div>
              <h3>Planned Test Cases:</h3>
              <pre style={{ background: '#f0f0f0', padding: '1rem', borderRadius: '4px' }}>
                {JSON.stringify(status.plan, null, 2)}
              </pre>
            </div>
          )}
          {status?.message && <p>{status.message}</p>}
        </div>
      )}
    </div>
  );
};

export default App;