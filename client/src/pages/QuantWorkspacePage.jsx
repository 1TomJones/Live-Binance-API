import React, { useEffect, useMemo, useRef, useState } from 'react';
import { quantApi } from '../services/quantApi.js';

const defaultConfig = {
  initialBalance: 10000,
  feeBps: 4,
  slippageBps: 2,
  startDate: '',
  endDate: '',
  mode: 'historical_backtest'
};

export function QuantWorkspacePage() {
  const [uploadState, setUploadState] = useState({ phase: 'no_file', fileName: '', strategy: null, parseResult: null, error: '' });
  const [runConfig, setRunConfig] = useState(defaultConfig);
  const [activeJob, setActiveJob] = useState(null);
  const [jobDetails, setJobDetails] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    quantApi.listRuns().then((d) => setRunHistory(d.runs || [])).catch(() => {});
    quantApi.getLiveMetrics().then((d) => setLiveMetrics(d.metrics)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeJob) return;
    const poll = setInterval(async () => {
      const payload = await quantApi.getBacktestJob(activeJob.jobId);
      setJobDetails(payload);
      if (['completed', 'failed', 'cancelled'].includes(payload.job.status)) {
        setActiveJob(null);
        const runs = await quantApi.listRuns();
        setRunHistory(runs.runs || []);
      }
    }, 1000);
    return () => clearInterval(poll);
  }, [activeJob]);

  const onFile = async (file) => {
    if (!file) return;
    const content = await file.text();
    setUploadState({ phase: 'file_uploaded', fileName: file.name, strategy: null, parseResult: null, error: '' });
    try {
      const result = await quantApi.uploadStrategy({ fileName: file.name, content });
      setUploadState({
        phase: result.status === 'parsed' ? 'file_parsed' : 'file_uploaded',
        fileName: file.name,
        strategy: result.strategy,
        parseResult: result.parseResult,
        error: ''
      });
    } catch (error) {
      setUploadState({ phase: 'file_invalid', fileName: file.name, strategy: null, parseResult: null, error: error.message });
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    onFile(e.dataTransfer.files?.[0]);
  };

  const startBacktest = async () => {
    if (!uploadState.strategy?.id) return;
    const started = await quantApi.startBacktest({ strategyId: uploadState.strategy.id, runConfig });
    setActiveJob({ jobId: started.jobId });
    setJobDetails({ job: started.job, progress: [], result: null });
  };

  const metrics = useMemo(() => {
    if (!jobDetails?.result?.summary_json) return null;
    return JSON.parse(jobDetails.result.summary_json);
  }, [jobDetails]);

  const equitySeries = useMemo(() => {
    if (!jobDetails?.result?.equity_series_json) return [];
    return JSON.parse(jobDetails.result.equity_series_json);
  }, [jobDetails]);

  return (
    <main className="quant-root">
      <header className="quant-header">
        <h1>Quant Workspace</h1>
        <span>Research · Validate · Backtest · Monitor</span>
      </header>

      <section className="quant-grid">
        <div className="quant-panel">
          <h3>Strategy Upload</h3>
          <div className="quant-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <p>Drop strategy file or click to select</p>
            <small>Supported shell formats: JSON / YAML / TOML</small>
          </div>
          <div className="quant-upload-row">
            <span>State: {uploadState.phase.replace('_', ' ')}</span>
            <span>{uploadState.fileName || 'No file selected'}</span>
            <button onClick={() => setUploadState({ phase: 'no_file', fileName: '', strategy: null, parseResult: null, error: '' })}>Remove</button>
          </div>
          {uploadState.error ? <p className="quant-error">{uploadState.error}</p> : null}
        </div>

        <div className="quant-panel">
          <h3>Strategy Summary</h3>
          {uploadState.parseResult?.metadata ? (
            <div className="quant-summary-grid">
              {Object.entries(uploadState.parseResult.metadata).map(([k, v]) => (
                <div key={k}><label>{k}</label><span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></div>
              ))}
              <p className="quant-note">Framework parsing is active. Rule interpretation/execution will attach through the dedicated strategy engine adapter.</p>
            </div>
          ) : (
            <p className="quant-empty">Upload and parse a strategy file to inspect metadata.</p>
          )}
        </div>

        <div className="quant-panel">
          <h3>Run Configuration</h3>
          <div className="quant-form-grid">
            <label>Initial Balance<input type="number" value={runConfig.initialBalance} onChange={(e) => setRunConfig((p) => ({ ...p, initialBalance: Number(e.target.value) }))} /></label>
            <label>Fee (bps)<input type="number" value={runConfig.feeBps} onChange={(e) => setRunConfig((p) => ({ ...p, feeBps: Number(e.target.value) }))} /></label>
            <label>Slippage (bps)<input type="number" value={runConfig.slippageBps} onChange={(e) => setRunConfig((p) => ({ ...p, slippageBps: Number(e.target.value) }))} /></label>
            <label>Start Date<input type="date" value={runConfig.startDate} onChange={(e) => setRunConfig((p) => ({ ...p, startDate: e.target.value }))} /></label>
            <label>End Date<input type="date" value={runConfig.endDate} onChange={(e) => setRunConfig((p) => ({ ...p, endDate: e.target.value }))} /></label>
            <label>Mode<select value={runConfig.mode} onChange={(e) => setRunConfig((p) => ({ ...p, mode: e.target.value }))}>
              <option value="historical_backtest">Historical Backtest</option>
              <option value="paper_live">Live Paper Mode</option>
              <option value="replay_mode">Replay Mode (placeholder)</option>
            </select></label>
          </div>
          <button disabled={!uploadState.strategy?.id || activeJob} onClick={startBacktest}>Start Run</button>
          {activeJob ? <button onClick={() => quantApi.cancelBacktest(activeJob.jobId)}>Cancel</button> : null}
        </div>

        <div className="quant-panel">
          <h3>Backtest Progress</h3>
          {jobDetails?.job ? (
            <>
              <div className="quant-progress"><div style={{ width: `${jobDetails.job.progress_pct}%` }} /></div>
              <p>{jobDetails.job.status} · {jobDetails.job.progress_pct}% · {jobDetails.job.current_marker}</p>
            </>
          ) : <p className="quant-empty">No active job.</p>}
        </div>

        <div className="quant-panel">
          <h3>Performance Dashboard</h3>
          {metrics ? <div className="quant-metric-grid">{Object.entries(metrics).map(([k, v]) => <div key={k}><label>{k}</label><strong>{String(v)}</strong></div>)}</div> : <p className="quant-empty">Run a completed backtest to populate metrics.</p>}
        </div>

        <div className="quant-panel">
          <h3>Equity / Drawdown</h3>
          <EquityChart series={equitySeries} />
        </div>

        <div className="quant-panel">
          <h3>Live Mode Metrics</h3>
          {liveMetrics ? <div className="quant-metric-grid">{Object.entries(liveMetrics).map(([k, v]) => <div key={k}><label>{k}</label><strong>{v === null ? '--' : String(v)}</strong></div>)}</div> : <p className="quant-empty">Live runner is idle.</p>}
        </div>

        <div className="quant-panel quant-span-2">
          <h3>Run History & Results</h3>
          <table className="quant-table">
            <thead><tr><th>Run ID</th><th>Strategy</th><th>Mode</th><th>Status</th><th>Initial</th><th>Created</th></tr></thead>
            <tbody>
              {runHistory.map((run) => (
                <tr key={run.id} onClick={() => setSelectedRun(run)}>
                  <td>{run.id}</td>
                  <td>{run.strategyMetadata?.strategyName || run.strategy_file_name || '--'}</td>
                  <td>{JSON.parse(run.run_config_json || '{}').mode || '--'}</td>
                  <td>{run.status}</td>
                  <td>{JSON.parse(run.run_config_json || '{}').initialBalance || '--'}</td>
                  <td>{new Date(run.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedRun ? <p className="quant-note">Selected Run {selectedRun.id}: {selectedRun.summary ? `Net PnL ${selectedRun.summary.netPnl}` : 'Awaiting result summary.'}</p> : null}
        </div>
      </section>
    </main>
  );
}

function EquityChart({ series }) {
  if (!series?.length) return <p className="quant-empty">Equity curve will render when result series is available.</p>;
  const width = 760;
  const height = 180;
  const values = series.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = series
    .map((point, idx) => {
      const x = (idx / Math.max(series.length - 1, 1)) * width;
      const y = height - ((point.equity - min) / Math.max(max - min, 1)) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return <svg viewBox={`0 0 ${width} ${height}`} className="quant-chart"><polyline fill="none" stroke="#3f8cff" strokeWidth="2" points={points} /></svg>;
}
