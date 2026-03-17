import React, { useEffect, useMemo, useRef, useState } from 'react';
import { quantApi } from '../services/quantApi.js';

const defaultConfig = {
  initialBalance: 10000,
  startDate: '',
  endDate: '',
  mode: 'historical_backtest'
};

export function QuantWorkspacePage() {
  const [uploadState, setUploadState] = useState({ phase: 'no_file', fileName: '', strategy: null, parseResult: null, errors: [] });
  const [runConfig, setRunConfig] = useState(defaultConfig);
  const [activeJob, setActiveJob] = useState(null);
  const [jobDetails, setJobDetails] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [liveStatus, setLiveStatus] = useState('idle');
  const fileRef = useRef(null);

  useEffect(() => {
    quantApi.listRuns().then((d) => setRunHistory(d.runs || [])).catch(() => {});
    const poll = setInterval(async () => {
      try {
        const d = await quantApi.getLiveMetrics();
        setLiveMetrics(d.metrics);
      } catch {
        // no-op
      }
    }, 3000);
    return () => clearInterval(poll);
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
    setUploadState({ phase: 'file_uploaded', fileName: file.name, strategy: null, parseResult: null, errors: [] });
    try {
      const result = await quantApi.uploadStrategy({ fileName: file.name, content });
      setUploadState({
        phase: 'file_parsed',
        fileName: file.name,
        strategy: result.strategy,
        parseResult: result.parseResult,
        errors: []
      });
    } catch (error) {
      setUploadState({ phase: 'file_invalid', fileName: file.name, strategy: null, parseResult: null, errors: [error.message] });
    }
  };

  const startBacktest = async () => {
    const started = await quantApi.startBacktest({ strategyId: uploadState.strategy.id, runConfig: { ...runConfig, mode: 'historical_backtest' } });
    setActiveJob({ jobId: started.jobId });
  };

  const startLive = async () => {
    await quantApi.startLivePaper({ strategyId: uploadState.strategy.id, runConfig });
    setLiveStatus('running');
  };

  const stopLive = async () => {
    await quantApi.stopLivePaper();
    setLiveStatus('stopped');
  };

  const metrics = useMemo(() => jobDetails?.result?.summary_json ? JSON.parse(jobDetails.result.summary_json) : null, [jobDetails]);
  const equitySeries = useMemo(() => jobDetails?.result?.equity_series_json ? JSON.parse(jobDetails.result.equity_series_json) : [], [jobDetails]);
  const trades = useMemo(() => jobDetails?.result?.trade_log_json ? JSON.parse(jobDetails.result.trade_log_json) : [], [jobDetails]);

  return (
    <main className="quant-root">
      <header className="quant-header"><h1>Quant Workspace</h1><span>v1 Rules Engine · on_candle_close</span></header>
      <section className="quant-grid">
        <div className="quant-panel">
          <h3>Strategy Upload (.json)</h3>
          <div className="quant-dropzone" onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" hidden accept=".json" onChange={(e) => onFile(e.target.files?.[0])} />
            <p>Upload strategy JSON</p>
          </div>
          <p className="quant-note">{uploadState.fileName || 'No file selected'}</p>
          {uploadState.errors.map((err) => <p key={err} className="quant-error">{err}</p>)}
        </div>

        <div className="quant-panel">
          <h3>Parsed Strategy Summary</h3>
          {uploadState.parseResult?.summary ? (
            <div className="quant-summary-grid">{Object.entries(uploadState.parseResult.summary).map(([k, v]) => <div key={k}><label>{k}</label><span>{Array.isArray(v) ? v.join(', ') : String(v)}</span></div>)}</div>
          ) : <p className="quant-empty">Upload a valid strategy to view summary.</p>}
        </div>

        <div className="quant-panel">
          <h3>Run Configuration</h3>
          <div className="quant-form-grid">
            <label>Initial Balance<input type="number" value={runConfig.initialBalance} onChange={(e) => setRunConfig((p) => ({ ...p, initialBalance: Number(e.target.value) }))} /></label>
            <label>Start Date<input type="date" value={runConfig.startDate} onChange={(e) => setRunConfig((p) => ({ ...p, startDate: e.target.value }))} /></label>
            <label>End Date<input type="date" value={runConfig.endDate} onChange={(e) => setRunConfig((p) => ({ ...p, endDate: e.target.value }))} /></label>
          </div>
          <button disabled={!uploadState.strategy?.id || activeJob} onClick={startBacktest}>Run Historical Backtest</button>
        </div>

        <div className="quant-panel">
          <h3>Backtest Progress</h3>
          {jobDetails?.job ? (<><div className="quant-progress"><div style={{ width: `${jobDetails.job.progress_pct}%` }} /></div><p>{jobDetails.job.status} · {jobDetails.job.current_marker}</p></>) : <p className="quant-empty">No active backtest.</p>}
        </div>

        <div className="quant-panel">
          <h3>Backtest Metrics</h3>
          {metrics ? <div className="quant-metric-grid">{Object.entries(metrics).map(([k, v]) => <div key={k}><label>{k}</label><strong>{String(v)}</strong></div>)}</div> : <p className="quant-empty">Run a backtest to populate metrics.</p>}
        </div>

        <div className="quant-panel"><h3>Equity Curve</h3><EquityChart series={equitySeries} /></div>

        <div className="quant-panel">
          <h3>Live Paper Mode</h3>
          <p className="quant-note">Status: {liveStatus}</p>
          <button disabled={!uploadState.strategy?.id} onClick={startLive}>Start Live Paper</button>
          <button onClick={stopLive}>Stop</button>
          {liveMetrics ? <div className="quant-metric-grid">{Object.entries(liveMetrics).map(([k, v]) => <div key={k}><label>{k}</label><strong>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</strong></div>)}</div> : null}
        </div>

        <div className="quant-panel quant-span-2">
          <h3>Trade Log</h3>
          <table className="quant-table"><thead><tr><th>Entry</th><th>Exit</th><th>Side</th><th>Entry Px</th><th>Exit Px</th><th>PnL</th><th>Bars</th></tr></thead>
            <tbody>{trades.map((trade, idx) => <tr key={`${trade.entryTime}-${idx}`}><td>{new Date(trade.entryTime * 1000).toLocaleString()}</td><td>{new Date(trade.exitTime * 1000).toLocaleString()}</td><td>{trade.side}</td><td>{trade.entryPrice?.toFixed?.(2)}</td><td>{trade.exitPrice?.toFixed?.(2)}</td><td>{trade.realizedPnl?.toFixed?.(2)}</td><td>{trade.holdingBars}</td></tr>)}</tbody>
          </table>
        </div>

        <div className="quant-panel quant-span-2">
          <h3>Run History</h3>
          <table className="quant-table"><thead><tr><th>ID</th><th>Status</th><th>Created</th></tr></thead><tbody>{runHistory.map((run) => <tr key={run.id}><td>{run.id}</td><td>{run.status}</td><td>{new Date(run.created_at).toLocaleString()}</td></tr>)}</tbody></table>
        </div>
      </section>
    </main>
  );
}

function EquityChart({ series }) {
  if (!series?.length) return <p className="quant-empty">No equity data yet.</p>;
  const width = 760;
  const height = 180;
  const values = series.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = series.map((point, idx) => `${(idx / Math.max(series.length - 1, 1)) * width},${height - ((point.equity - min) / Math.max(max - min, 1)) * height}`).join(' ');
  return <svg viewBox={`0 0 ${width} ${height}`} className="quant-chart"><polyline fill="none" stroke="#3f8cff" strokeWidth="2" points={points} /></svg>;
}
