import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LiveMarketChart } from '../components/demo/LiveMarketChart.jsx';
import { EquityCurveChart } from '../components/demo/EquityCurveChart.jsx';

// ─── Theme constants ─────────────────────────────────────────────────────────
const C = {
  bg: '#060b13',
  panelBg: '#0d1520',
  panelBg2: '#0a1018',
  border: '#1a263d',
  borderLight: '#253450',
  green: '#27bb82',
  red: '#e35d68',
  blue: '#4f8ef7',
  text: '#d4dceb',
  textMuted: '#7a9cc8',
  textDim: '#4a6080',
  yellow: '#d6a84a',
  headerBg: '#08111e'
};

// ─── Inline style helpers ─────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: C.bg,
    color: C.text,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 13,
    display: 'flex',
    flexDirection: 'column'
  },
  topBar: {
    height: 42,
    background: C.headerBg,
    borderBottom: `1px solid ${C.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    flexShrink: 0
  },
  brand: { color: '#a7b8d8', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em' },
  title: { color: C.blue, fontWeight: 600, fontSize: 14, letterSpacing: '0.02em' },
  navLink: { color: '#91addf', textDecoration: 'none', fontSize: 12 },
  main: { flex: 1, padding: '24px 20px', maxWidth: 1400, margin: '0 auto', width: '100%' },
  card: {
    background: C.panelBg,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: 20
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.1em',
    color: C.textMuted,
    textTransform: 'uppercase',
    marginBottom: 16
  },
  btn: {
    background: C.blue,
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '9px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.02em',
    transition: 'opacity 0.15s'
  },
  btnSecondary: {
    background: 'transparent',
    color: C.textMuted,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    padding: '7px 14px',
    fontSize: 12,
    cursor: 'pointer'
  },
  btnGreen: {
    background: '#1a3d2c',
    color: C.green,
    border: `1px solid #255c3e`,
    borderRadius: 4,
    padding: '5px 12px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600
  },
  segBtn: (active) => ({
    background: active ? '#162030' : 'transparent',
    color: active ? C.blue : C.textMuted,
    border: `1px solid ${active ? C.blue : C.border}`,
    borderRadius: 3,
    padding: '5px 14px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: active ? 600 : 400
  }),
  chip: (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '6px 10px',
    borderRadius: 4,
    border: `1px solid ${active ? C.blue : C.border}`,
    background: active ? 'rgba(79,142,247,0.08)' : 'transparent',
    cursor: 'pointer',
    color: active ? C.text : C.textMuted,
    fontSize: 12,
    userSelect: 'none'
  })
};

// ─── Indicator definitions ────────────────────────────────────────────────────
const INDICATOR_LIST = [
  { key: 'ema9',       label: 'EMA 9' },
  { key: 'ema21',      label: 'EMA 21' },
  { key: 'ema50',      label: 'EMA 50' },
  { key: 'ema200',     label: 'EMA 200' },
  { key: 'sma20',      label: 'SMA 20' },
  { key: 'sma50',      label: 'SMA 50' },
  { key: 'rsi',        label: 'RSI 14' },
  { key: 'macd',       label: 'MACD' },
  { key: 'bollinger',  label: 'Bollinger Bands' },
  { key: 'atr',        label: 'ATR 14' },
  { key: 'obv',        label: 'OBV' },
  { key: 'stochastic', label: 'Stochastic' }
];

const DEFAULT_INDICATORS = {
  ema9: false, ema21: true, ema50: false, ema200: false,
  sma20: false, sma50: false, rsi: true, macd: true,
  bollinger: false, atr: false, obv: false, stochastic: false
};

const SYMBOL_OPTIONS = [
  { label: 'BTC', value: 'BTCUSDT' },
  { label: 'ETH', value: 'ETHUSDT' },
  { label: 'SOL', value: 'SOLUSDT' },
  { label: 'BNB', value: 'BNBUSDT' }
];

const INTERVAL_OPTIONS = ['1h', '4h', '1d'];
const YEARS_OPTIONS = [1, 2, 3, 5];

// ─── Training progress steps ──────────────────────────────────────────────────
function buildProgressSteps(symbol, interval, years, indicators) {
  const selectedIndicators = Object.entries(indicators).filter(([, v]) => v).map(([k]) => k);
  const indicatorCount = selectedIndicators.length;
  return [
    { label: `Fetching ${years}y of ${interval} candles for ${symbol}…`, duration: 0 },
    { label: `Paginating Binance REST API (limit 1000/batch)…`, duration: 600 },
    { label: `Computing ${indicatorCount} indicator${indicatorCount !== 1 ? 's' : ''}…`, duration: 300 },
    { label: 'Training Model 1/5: EMA Crossover…', duration: 400 },
    { label: 'Training Model 2/5: RSI Reversal…', duration: 400 },
    { label: 'Training Model 3/5: MACD Signal…', duration: 400 },
    { label: 'Training Model 4/5: Bollinger Mean Reversion…', duration: 400 },
    { label: 'Training Model 5/5: Multi-Factor Score…', duration: 400 },
    { label: 'Ranking models by out-of-sample Sharpe ratio…', duration: 300 }
  ];
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmtPct(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${Number(v).toFixed(decimals)}%`;
}
function fmtNum(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toFixed(decimals);
}
function fmtDollars(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '+';
  return `${sign}$${abs.toFixed(2)}`;
}
function fmtDate(timeSec) {
  if (!timeSec) return '—';
  return new Date(timeSec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function metricColor(v, higherIsBetter = true) {
  if (v == null || !Number.isFinite(v)) return C.textMuted;
  return (higherIsBetter ? v > 0 : v < 0) ? C.green : (v === 0 ? C.textMuted : C.red);
}

// ─── Step 1: Configure ────────────────────────────────────────────────────────
function ConfigureStep({ config, setConfig, onNext, error }) {
  const { symbol, interval, years, indicators } = config;

  const toggleIndicator = (key) => {
    setConfig((prev) => ({
      ...prev,
      indicators: { ...prev.indicators, [key]: !prev.indicators[key] }
    }));
  };

  const selectedCount = Object.values(indicators).filter(Boolean).length;

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={S.sectionTitle}>Step 1 — Configure Training Session</div>

        {/* Symbol + Interval + Years row */}
        <div style={{ display: 'flex', gap: 32, marginBottom: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Asset</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {SYMBOL_OPTIONS.map((opt) => (
                <button key={opt.value} style={S.segBtn(symbol === opt.value)} onClick={() => setConfig((p) => ({ ...p, symbol: opt.value }))}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Timeframe</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {INTERVAL_OPTIONS.map((opt) => (
                <button key={opt} style={S.segBtn(interval === opt)} onClick={() => setConfig((p) => ({ ...p, interval: opt }))}>
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>History</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {YEARS_OPTIONS.map((y) => (
                <button key={y} style={S.segBtn(years === y)} onClick={() => setConfig((p) => ({ ...p, years: y }))}>
                  {y}y
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Indicator grid */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Technical Indicators
            <span style={{ color: C.textDim, marginLeft: 8, fontSize: 10 }}>({selectedCount} selected)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {INDICATOR_LIST.map(({ key, label }) => (
              <label key={key} style={S.chip(indicators[key])} onClick={() => toggleIndicator(key)}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3,
                  border: `1.5px solid ${indicators[key] ? C.blue : C.border}`,
                  background: indicators[key] ? C.blue : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {indicators[key] && (
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                      <path d="M1 3L3 5L7 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Info note */}
        <div style={{ padding: '10px 14px', background: 'rgba(79,142,247,0.06)', borderRadius: 4, border: `1px solid rgba(79,142,247,0.15)`, fontSize: 12, color: C.textMuted, marginBottom: 20 }}>
          <span style={{ color: C.blue, fontWeight: 600 }}>Note: </span>
          Each model requires specific indicators. Models missing required indicators will be skipped.
          For best coverage, enable EMA 9, EMA 21, EMA 50, RSI, MACD, and Bollinger Bands.
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: 'rgba(227,93,104,0.08)', borderRadius: 4, border: `1px solid rgba(227,93,104,0.2)`, color: C.red, fontSize: 12, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button style={S.btn} onClick={onNext}>
          Train Models →
        </button>
      </div>

      {/* Config summary */}
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: C.textMuted }}>
        <span>Symbol: <span style={{ color: C.text }}>{symbol}</span></span>
        <span style={{ color: C.border }}>|</span>
        <span>Interval: <span style={{ color: C.text }}>{interval}</span></span>
        <span style={{ color: C.border }}>|</span>
        <span>History: <span style={{ color: C.text }}>{years}y</span></span>
        <span style={{ color: C.border }}>|</span>
        <span>Indicators: <span style={{ color: C.text }}>{selectedCount}</span></span>
      </div>
    </div>
  );
}

// ─── Step 2: Training ─────────────────────────────────────────────────────────
function TrainingStep({ config, trainingResult, trainingError, isTraining, selectedModelIndex, onSelectModel, onRunBacktest }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const stepTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const mountedRef = useRef(true);

  const steps = buildProgressSteps(config.symbol, config.interval, config.years, config.indicators);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isTraining) return;
    setStepIndex(0);
    setProgress(0);

    let currentStep = 0;
    let currentProgress = 0;

    const advanceProgress = () => {
      if (!mountedRef.current) return;
      currentProgress += 2 + Math.random() * 3;
      if (currentProgress > 95) currentProgress = 95;
      setProgress(currentProgress);
    };

    const advanceStep = () => {
      if (!mountedRef.current) return;
      currentStep = Math.min(currentStep + 1, steps.length - 1);
      setStepIndex(currentStep);
      if (currentStep < steps.length - 1) {
        const nextDelay = steps[currentStep]?.duration || 500;
        stepTimerRef.current = setTimeout(advanceStep, nextDelay);
      }
    };

    progressTimerRef.current = setInterval(advanceProgress, 250);
    stepTimerRef.current = setTimeout(advanceStep, steps[0].duration || 800);

    return () => {
      clearTimeout(stepTimerRef.current);
      clearInterval(progressTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTraining]);

  useEffect(() => {
    if (trainingResult) {
      setProgress(100);
      clearTimeout(stepTimerRef.current);
      clearInterval(progressTimerRef.current);
      setStepIndex(steps.length - 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingResult]);

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={S.sectionTitle}>Step 2 — Model Training</div>

        {/* Progress display */}
        {(isTraining || !trainingResult) && !trainingError && (
          <div style={{ marginBottom: 24 }}>
            {/* Animated steps */}
            <div style={{ marginBottom: 16 }}>
              {steps.map((step, idx) => {
                const isActive = idx === stepIndex;
                const isDone = idx < stepIndex;
                return (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '5px 0',
                    opacity: isDone ? 0.5 : isActive ? 1 : 0.3,
                    transition: 'opacity 0.3s'
                  }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%',
                      border: `1.5px solid ${isDone ? C.green : isActive ? C.blue : C.border}`,
                      background: isDone ? 'rgba(39,187,130,0.15)' : isActive ? 'rgba(79,142,247,0.15)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, flexShrink: 0,
                      color: isDone ? C.green : isActive ? C.blue : C.textDim
                    }}>
                      {isDone ? '✓' : isActive ? '◉' : (idx + 1)}
                    </span>
                    <span style={{ fontSize: 12, color: isActive ? C.text : C.textMuted }}>{step.label}</span>
                    {isActive && isTraining && (
                      <span style={{ marginLeft: 4, color: C.blue, animation: 'none' }}>
                        <PulsingDot />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: `linear-gradient(90deg, ${C.blue} 0%, ${C.green} 100%)`,
                borderRadius: 2,
                transition: 'width 0.4s ease'
              }} />
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
              {isTraining ? `${Math.round(progress)}% complete` : 'Waiting to start…'}
            </div>
          </div>
        )}

        {trainingError && (
          <div style={{ padding: '12px 16px', background: 'rgba(227,93,104,0.08)', borderRadius: 4, border: `1px solid rgba(227,93,104,0.2)`, color: C.red, fontSize: 12, marginBottom: 20 }}>
            <span style={{ fontWeight: 600 }}>Training failed: </span>{trainingError}
          </div>
        )}

        {trainingResult && !isTraining && (
          <ModelComparisonTable
            models={trainingResult.models}
            dataStats={trainingResult.dataStats}
            selectedIndex={selectedModelIndex}
            onSelect={onSelectModel}
          />
        )}
      </div>

      {trainingResult && !isTraining && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button style={S.btn} onClick={onRunBacktest}>
            Run Full Backtest →
          </button>
          <span style={{ fontSize: 12, color: C.textMuted }}>
            Selected: <span style={{ color: C.text }}>
              {trainingResult.models[selectedModelIndex]?.name || '—'}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function PulsingDot() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setVisible((v) => !v), 500);
    return () => clearInterval(t);
  }, []);
  return <span style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.2s' }}>●</span>;
}

function ModelComparisonTable({ models, dataStats, selectedIndex, onSelect }) {
  if (!models || models.length === 0) {
    return (
      <div style={{ color: C.textMuted, fontSize: 13, padding: 12 }}>
        No models were trained. Try enabling more indicators (EMA 9, EMA 21, RSI, MACD, Bollinger).
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 12, color: C.textMuted }}>
        <span>Candles: <span style={{ color: C.text }}>{dataStats?.candles?.toLocaleString()}</span></span>
        <span style={{ color: C.border }}>|</span>
        <span>From: <span style={{ color: C.text }}>{fmtDate(dataStats?.from)}</span></span>
        <span style={{ color: C.border }}>|</span>
        <span>To: <span style={{ color: C.text }}>{fmtDate(dataStats?.to)}</span></span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {['Rank', 'Model', 'Description', 'Train Sharpe', 'Test Sharpe', 'Test Return', 'Win Rate', 'Trades', 'Exp. Value', ''].map((h, i) => (
                <th key={i} style={{ padding: '8px 10px', color: C.textMuted, fontWeight: 500, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model, idx) => {
              const isSelected = idx === selectedIndex;
              const isTop = idx === 0;
              return (
                <tr
                  key={model.modelId}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    background: isSelected ? 'rgba(79,142,247,0.08)' : isTop && !isSelected ? 'rgba(39,187,130,0.04)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s'
                  }}
                  onClick={() => onSelect(idx)}
                >
                  <td style={{ padding: '9px 10px', color: isTop ? C.green : C.textMuted, fontWeight: isTop ? 700 : 400 }}>
                    #{idx + 1}
                  </td>
                  <td style={{ padding: '9px 10px', color: C.text, fontWeight: 600, whiteSpace: 'nowrap' }}>{model.name}</td>
                  <td style={{ padding: '9px 10px', color: C.textMuted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {model.description}
                  </td>
                  <td style={{ padding: '9px 10px', color: metricColor(model.trainMetrics?.sharpe), fontVariantNumeric: 'tabular-nums' }}>
                    {fmtNum(model.trainMetrics?.sharpe)}
                  </td>
                  <td style={{ padding: '9px 10px', color: metricColor(model.testMetrics?.sharpe), fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {fmtNum(model.testMetrics?.sharpe)}
                  </td>
                  <td style={{ padding: '9px 10px', color: metricColor(model.testMetrics?.totalReturn), fontVariantNumeric: 'tabular-nums' }}>
                    {fmtPct(model.testMetrics?.totalReturn)}
                  </td>
                  <td style={{ padding: '9px 10px', color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtPct(model.testMetrics?.winRate, 1)}
                  </td>
                  <td style={{ padding: '9px 10px', color: C.textMuted }}>{model.testMetrics?.totalTrades ?? '—'}</td>
                  <td style={{ padding: '9px 10px', color: metricColor(model.testMetrics?.expectedValue), fontVariantNumeric: 'tabular-nums' }}>
                    {model.testMetrics?.expectedValue != null ? `$${Number(model.testMetrics.expectedValue).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 10px' }}>
                    <button
                      style={isSelected ? S.btnGreen : S.btnSecondary}
                      onClick={(e) => { e.stopPropagation(); onSelect(idx); }}
                    >
                      {isSelected ? '✓ Selected' : 'Select'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Step 3: Results ──────────────────────────────────────────────────────────
function ResultsStep({ config, backtestResult, isBacktesting, backtestError, selectedModel }) {
  if (isBacktesting) {
    return (
      <div style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 14, padding: 32 }}>
        <div style={{ width: 24, height: 24, border: `2.5px solid ${C.blue}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div>
          <div style={{ color: C.text, fontWeight: 600, marginBottom: 4 }}>Running full backtest…</div>
          <div style={{ color: C.textMuted, fontSize: 12 }}>Computing {config.years}y of trades on {config.symbol} {config.interval}</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (backtestError) {
    return (
      <div style={{ ...S.card, padding: 24 }}>
        <div style={{ color: C.red, marginBottom: 8, fontWeight: 600 }}>Backtest failed</div>
        <div style={{ color: C.textMuted, fontSize: 12 }}>{backtestError}</div>
      </div>
    );
  }

  if (!backtestResult) {
    return (
      <div style={{ ...S.card, padding: 24, color: C.textMuted }}>No results yet.</div>
    );
  }

  const { equityCurve, trades, metrics } = backtestResult;
  const displayTrades = (trades || []).slice(-100);

  return (
    <div>
      {/* Stats grid row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total Return', value: fmtPct(metrics?.totalReturn), color: metricColor(metrics?.totalReturn) },
          { label: 'Sharpe Ratio', value: fmtNum(metrics?.sharpe), color: metricColor(metrics?.sharpe) },
          { label: 'Win Rate', value: fmtPct(metrics?.winRate, 1), color: metricColor(metrics?.winRate) },
          { label: 'Exp. Value / Trade', value: metrics?.expectedValue != null ? fmtDollars(metrics.expectedValue) : '—', color: metricColor(metrics?.expectedValue) },
          { label: 'Max Drawdown', value: fmtPct(metrics?.maxDrawdown), color: metricColor(metrics?.maxDrawdown, false) },
          { label: 'Profit Factor', value: fmtNum(metrics?.profitFactor), color: metricColor(metrics?.profitFactor - 1) },
          { label: 'Total Trades', value: metrics?.totalTrades?.toLocaleString() ?? '—', color: C.text },
          { label: 'Avg Duration', value: metrics?.avgDuration != null ? `${fmtNum(metrics.avgDuration, 1)} bars` : '—', color: C.textMuted }
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: C.panelBg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Main 2-col layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Left: live chart */}
        <div>
          <div style={{ ...S.card, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {config.symbol} Live Market
              </div>
              <div style={{ fontSize: 10, color: C.textDim }}>Updates every 30s</div>
            </div>
            <LiveMarketChart
              symbol={config.symbol}
              timeframe="1h"
              indicators={config.indicators}
              height={310}
            />
          </div>

          <div style={{ ...S.card, padding: 16 }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              Model Parameters
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              {selectedModel && (
                <>
                  <div style={{ color: C.textMuted }}>Model</div>
                  <div style={{ color: C.text }}>{selectedModel.name}</div>
                  {Object.entries(selectedModel.trainedParams || {}).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <div style={{ color: C.textMuted }}>{k}</div>
                      <div style={{ color: C.text }}>{String(v)}</div>
                    </React.Fragment>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: equity curve + trade log */}
        <div>
          <div style={{ ...S.card, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Equity Curve
              <span style={{ marginLeft: 8, color: C.textDim, fontSize: 10 }}>Starting $10,000</span>
            </div>
            <EquityCurveChart equityCurve={equityCurve || []} height={260} />
          </div>

          <div style={{ ...S.card, padding: 16 }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              Trade Log
              <span style={{ marginLeft: 8, color: C.textDim, fontSize: 10 }}>Last {displayTrades.length} of {(trades || []).length}</span>
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.panelBg }}>
                  <tr>
                    {['#', 'Side', 'Entry', 'Exit', 'P&L%', 'Reason', 'Dur.'].map((h) => (
                      <th key={h} style={{ padding: '5px 8px', color: C.textMuted, fontWeight: 500, textAlign: 'left', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayTrades.map((trade, i) => {
                    const isWin = trade.netPnl > 0;
                    const globalIdx = (trades.length - displayTrades.length) + i + 1;
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid rgba(26,38,61,0.6)` }}>
                        <td style={{ padding: '4px 8px', color: C.textDim }}>{globalIdx}</td>
                        <td style={{ padding: '4px 8px', color: trade.side === 'long' ? C.green : C.red, fontWeight: 600 }}>
                          {trade.side === 'long' ? 'L' : 'S'}
                        </td>
                        <td style={{ padding: '4px 8px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(trade.entryPrice)}</td>
                        <td style={{ padding: '4px 8px', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(trade.exitPrice)}</td>
                        <td style={{ padding: '4px 8px', color: isWin ? C.green : C.red, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtPct(trade.pnlPct * 100, 2)}
                        </td>
                        <td style={{ padding: '4px 8px', color: C.textDim, fontSize: 10 }}>
                          {trade.exitReason?.replace('_', ' ')}
                        </td>
                        <td style={{ padding: '4px 8px', color: C.textDim }}>{trade.duration}</td>
                      </tr>
                    );
                  })}
                  {displayTrades.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: '16px 8px', color: C.textDim, textAlign: 'center' }}>No trades</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function MLDemoPage() {
  const [step, setStep] = useState(1); // 1, 2, 3
  const [config, setConfig] = useState({
    symbol: 'BTCUSDT',
    interval: '4h',
    years: 3,
    indicators: { ...DEFAULT_INDICATORS }
  });

  const [isTraining, setIsTraining] = useState(false);
  const [trainingResult, setTrainingResult] = useState(null);
  const [trainingError, setTrainingError] = useState(null);

  const [selectedModelIndex, setSelectedModelIndex] = useState(0);

  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestError, setBacktestError] = useState(null);

  const [step1Error, setStep1Error] = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleStartTraining = useCallback(async () => {
    setStep1Error(null);
    const selectedCount = Object.values(config.indicators).filter(Boolean).length;
    if (selectedCount === 0) {
      setStep1Error('Please select at least one indicator.');
      return;
    }

    setStep(2);
    setIsTraining(true);
    setTrainingResult(null);
    setTrainingError(null);
    setSelectedModelIndex(0);
    setBacktestResult(null);

    try {
      const res = await fetch('/api/demo/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: config.symbol,
          interval: config.interval,
          years: config.years,
          indicators: config.indicators
        })
      });

      const data = await res.json();
      if (!mountedRef.current) return;

      if (!res.ok) {
        setTrainingError(data.error || `Server error ${res.status}`);
        setIsTraining(false);
        return;
      }

      setTrainingResult(data);
      setSelectedModelIndex(0);
      setIsTraining(false);
    } catch (err) {
      if (mountedRef.current) {
        setTrainingError(err.message || 'Network error');
        setIsTraining(false);
      }
    }
  }, [config]);

  const handleRunBacktest = useCallback(async () => {
    if (!trainingResult?.models?.length) return;
    const selectedModel = trainingResult.models[selectedModelIndex];
    if (!selectedModel) return;

    setStep(3);
    setIsBacktesting(true);
    setBacktestResult(null);
    setBacktestError(null);

    try {
      const res = await fetch('/api/demo/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: config.symbol,
          interval: config.interval,
          years: config.years,
          modelId: selectedModel.modelId,
          trainedParams: selectedModel.trainedParams,
          indicators: config.indicators
        })
      });

      const data = await res.json();
      if (!mountedRef.current) return;

      if (!res.ok) {
        setBacktestError(data.error || `Server error ${res.status}`);
        setIsBacktesting(false);
        return;
      }

      setBacktestResult(data);
      setIsBacktesting(false);
    } catch (err) {
      if (mountedRef.current) {
        setBacktestError(err.message || 'Network error');
        setIsBacktesting(false);
      }
    }
  }, [config, trainingResult, selectedModelIndex]);

  const handleGoBack = (targetStep) => {
    setStep(targetStep);
    if (targetStep === 1) {
      setTrainingResult(null);
      setTrainingError(null);
      setBacktestResult(null);
    }
  };

  const selectedModel = trainingResult?.models?.[selectedModelIndex] || null;

  return (
    <div style={S.page}>
      {/* Top bar */}
      <div style={S.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={S.brand}>CRYPTO TERMINAL</span>
          <span style={{ color: C.border }}>|</span>
          <span style={S.title}>ML Strategy Demo</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a href="/" style={S.navLink}>← Live Terminal</a>
          <a href="/quant" style={S.navLink}>Quant Workspace</a>
        </div>
      </div>

      {/* Main content */}
      <div style={S.main}>
        {/* Step navigation breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}>
          {[
            { num: 1, label: 'Configure' },
            { num: 2, label: 'Train' },
            { num: 3, label: 'Results' }
          ].map(({ num, label }, idx, arr) => {
            const isDone = step > num;
            const isActive = step === num;
            return (
              <React.Fragment key={num}>
                <button
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'transparent', border: 'none', cursor: isDone || isActive ? 'pointer' : 'default',
                    color: isActive ? C.blue : isDone ? C.green : C.textDim,
                    fontSize: 13, fontWeight: isActive ? 700 : 400, padding: 0
                  }}
                  onClick={() => (isDone && !isTraining && !isBacktesting) ? handleGoBack(num) : undefined}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%',
                    border: `2px solid ${isActive ? C.blue : isDone ? C.green : C.border}`,
                    background: isDone ? 'rgba(39,187,130,0.12)' : isActive ? 'rgba(79,142,247,0.12)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, flexShrink: 0
                  }}>
                    {isDone ? '✓' : num}
                  </span>
                  {label}
                </button>
                {idx < arr.length - 1 && (
                  <span style={{ color: C.border, fontSize: 16, margin: '0 4px' }}>›</span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step content */}
        {step === 1 && (
          <ConfigureStep
            config={config}
            setConfig={setConfig}
            onNext={handleStartTraining}
            error={step1Error}
          />
        )}
        {step === 2 && (
          <TrainingStep
            config={config}
            trainingResult={trainingResult}
            trainingError={trainingError}
            isTraining={isTraining}
            selectedModelIndex={selectedModelIndex}
            onSelectModel={setSelectedModelIndex}
            onRunBacktest={handleRunBacktest}
          />
        )}
        {step === 3 && (
          <ResultsStep
            config={config}
            backtestResult={backtestResult}
            isBacktesting={isBacktesting}
            backtestError={backtestError}
            selectedModel={selectedModel}
          />
        )}
      </div>
    </div>
  );
}
