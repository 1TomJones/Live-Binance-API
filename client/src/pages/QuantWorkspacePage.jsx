import React, { useEffect, useMemo, useState } from 'react';
import { quantApi } from '../services/quantApi.js';

const FALLBACK_LIMITS = {
  orderSizeMin: 0.0001,
  orderSizeMax: 0.005,
  orderSizeStep: 0.0001,
  initialBalance: 10000
};

const DEFAULT_SETTINGS = {
  orderSize: 0.001,
  stopLossPct: 0.35,
  takeProfitPct: 0.7,
  enableLong: true,
  enableShort: true
};

export function QuantWorkspacePage() {
  const [strategies, setStrategies] = useState([]);
  const [limits, setLimits] = useState(FALLBACK_LIMITS);
  const [selectedStrategy, setSelectedStrategy] = useState('VWAP_CVD_Live_Trend_01');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadInitial() {
      try {
        const [strategyPayload, workspacePayload] = await Promise.all([
          quantApi.getLiveStrategies(),
          quantApi.getLiveWorkspace()
        ]);
        if (!mounted) return;
        setStrategies(strategyPayload.strategies || []);
        setLimits(strategyPayload.limits || FALLBACK_LIMITS);
        const firstStrategy = strategyPayload.strategies?.[0]?.key || 'VWAP_CVD_Live_Trend_01';
        setSelectedStrategy(firstStrategy);
        setSnapshot(workspacePayload.snapshot || null);
        if (workspacePayload.snapshot?.controls) {
          setSettings((prev) => ({ ...prev, ...workspacePayload.snapshot.controls }));
        }
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadInitial();

    const poll = setInterval(async () => {
      try {
        const payload = await quantApi.getLiveWorkspace();
        if (!mounted) return;
        setSnapshot(payload.snapshot || null);
      } catch (pollError) {
        if (mounted) setError(pollError.message);
      }
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, []);

  const strategy = useMemo(
    () => strategies.find((item) => item.key === selectedStrategy) || strategies[0] || null,
    [selectedStrategy, strategies]
  );

  const status = snapshot?.status || 'idle';
  const isRunning = status === 'running';
  const effectiveSymbol = snapshot?.symbol || strategy?.symbol || 'BTCUSDT';
  const position = snapshot?.position || {
    state: 'Flat',
    size: 0,
    entryPrice: null,
    currentMarkPrice: null,
    notionalExposure: 0,
    unrealizedPnl: 0
  };
  const performance = snapshot?.performance || {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    bestTrade: 0,
    worstTrade: 0,
    averageTrade: 0,
    cumulativeRealizedPnl: 0,
    cumulativeUnrealizedPnl: 0,
    totalPnl: 0,
    totalReturn: 0
  };

  const handleNumberChange = (field) => (event) => {
    const value = Number(event.target.value);
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleToggleChange = (field) => (event) => {
    setSettings((prev) => ({ ...prev, [field]: event.target.checked }));
  };

  const startStrategy = async () => {
    setActionBusy(true);
    setError('');
    try {
      const payload = await quantApi.startLivePaper({
        strategyKey: selectedStrategy,
        runConfig: settings
      });
      setSnapshot(payload.run || null);
    } catch (startError) {
      setError(startError.message);
    } finally {
      setActionBusy(false);
    }
  };

  const stopStrategy = async () => {
    setActionBusy(true);
    setError('');
    try {
      const payload = await quantApi.stopLivePaper();
      setSnapshot(payload.run || null);
    } catch (stopError) {
      setError(stopError.message);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <main className="quant-root">
      <header className="quant-header">
        <div>
          <h1>Quant Workspace</h1>
          <span>Live paper strategy workspace · built-in execution only</span>
        </div>
        <div className="quant-header-tags">
          <span className="quant-badge">{effectiveSymbol}</span>
          <span className="quant-badge quant-badge-muted">Paper Trading Only</span>
        </div>
      </header>

      <section className="quant-toolbar">
        <label>
          <span>Built-in Strategy</span>
          <select value={selectedStrategy} onChange={(event) => setSelectedStrategy(event.target.value)} disabled={isRunning || actionBusy}>
            {strategies.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Order Size</span>
          <input
            type="number"
            min={limits.orderSizeMin}
            max={limits.orderSizeMax}
            step={limits.orderSizeStep}
            value={settings.orderSize}
            onChange={handleNumberChange('orderSize')}
            disabled={isRunning || actionBusy}
          />
        </label>
        <div className="quant-toolbar-actions">
          <button className="quant-button quant-button-primary" onClick={startStrategy} disabled={isRunning || actionBusy || loading || !strategy}>Start</button>
          <button className="quant-button" onClick={stopStrategy} disabled={!isRunning || actionBusy}>Stop</button>
        </div>
        <div className="quant-toolbar-status">
          <label>Paper Status</label>
          <strong className={isRunning ? 'is-positive' : 'is-muted'}>{isRunning ? 'Running' : 'Stopped'}</strong>
        </div>
        <div className="quant-toolbar-status">
          <label>Symbol</label>
          <strong>{effectiveSymbol}</strong>
        </div>
        <div className="quant-toolbar-status">
          <label>Mode</label>
          <strong>Paper Trading Only</strong>
        </div>
      </section>

      {error ? <div className="quant-banner quant-banner-error">{error}</div> : null}
      {loading ? <div className="quant-banner">Loading live quant workspace…</div> : null}

      <section className="quant-workspace-grid">
        <div className="quant-panel quant-panel-chart">
          <div className="quant-panel-heading">
            <h3>Live Strategy Chart</h3>
            <span>{strategy?.timeframe || '1m'} · last 100 candles</span>
          </div>
          <MiniStrategyChart chart={snapshot?.chart} />
        </div>

        <div className="quant-sidebar-stack">
          <div className="quant-panel">
            <div className="quant-panel-heading">
              <h3>Live Position</h3>
              <span>{position.state}</span>
            </div>
            <MetricGrid items={[
              ['Position State', position.state],
              ['Position Size', formatQty(position.size)],
              ['Entry Price', formatPrice(position.entryPrice)],
              ['Current Mark', formatPrice(position.currentMarkPrice)],
              ['Notional Exposure', formatMoney(position.notionalExposure)],
              ['Unrealized PnL', formatMoney(position.unrealizedPnl)],
              ['Realized PnL', formatMoney(performance.cumulativeRealizedPnl)],
              ['Total PnL', formatMoney(performance.totalPnl)],
              ['Last Action', snapshot?.lastAction || 'Stopped'],
              ['Last Signal Reason', snapshot?.lastSignalReason || 'Start the strategy to begin.'],
              ['Strategy Status', snapshot?.strategyStatus || 'Stopped']
            ]} />
          </div>

          <div className="quant-panel">
            <div className="quant-panel-heading">
              <h3>Strategy Info</h3>
              <span>{strategy?.name || 'Built-in strategy'}</span>
            </div>
            <div className="quant-rule-list">
              <div>
                <label>Description</label>
                <p>{strategy?.description || snapshot?.strategy?.description || 'VWAP + CVD live trend logic.'}</p>
              </div>
              <div>
                <label>Long Entry</label>
                <p>{strategy?.entryRules?.long || snapshot?.strategy?.entryRules?.long}</p>
              </div>
              <div>
                <label>Short Entry</label>
                <p>{strategy?.entryRules?.short || snapshot?.strategy?.entryRules?.short}</p>
              </div>
              <div>
                <label>Long Exit</label>
                <p>{strategy?.exitRules?.long || snapshot?.strategy?.exitRules?.long}</p>
              </div>
              <div>
                <label>Short Exit</label>
                <p>{strategy?.exitRules?.short || snapshot?.strategy?.exitRules?.short}</p>
              </div>
            </div>
          </div>

          <div className="quant-panel">
            <div className="quant-panel-heading">
              <h3>Settings</h3>
              <span>Execution controls</span>
            </div>
            <div className="quant-settings-grid">
              <label>
                <span>Order Size</span>
                <input
                  type="number"
                  min={limits.orderSizeMin}
                  max={limits.orderSizeMax}
                  step={limits.orderSizeStep}
                  value={settings.orderSize}
                  onChange={handleNumberChange('orderSize')}
                  disabled={isRunning || actionBusy}
                />
                <small>{`${limits.orderSizeMin.toFixed(4)} to ${limits.orderSizeMax.toFixed(4)} BTC`}</small>
              </label>
              <label>
                <span>Stop Loss %</span>
                <input type="number" min="0.01" max="25" step="0.01" value={settings.stopLossPct} onChange={handleNumberChange('stopLossPct')} disabled={isRunning || actionBusy} />
              </label>
              <label>
                <span>Take Profit %</span>
                <input type="number" min="0.01" max="25" step="0.01" value={settings.takeProfitPct} onChange={handleNumberChange('takeProfitPct')} disabled={isRunning || actionBusy} />
              </label>
              <label className="quant-toggle-row">
                <span>Enable Long Trades</span>
                <input type="checkbox" checked={settings.enableLong} onChange={handleToggleChange('enableLong')} disabled={isRunning || actionBusy} />
              </label>
              <label className="quant-toggle-row">
                <span>Enable Short Trades</span>
                <input type="checkbox" checked={settings.enableShort} onChange={handleToggleChange('enableShort')} disabled={isRunning || actionBusy} />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="quant-bottom-grid">
        <div className="quant-panel">
          <div className="quant-panel-heading">
            <h3>Live Performance</h3>
            <span>Updates while running</span>
          </div>
          <MetricGrid items={[
            ['Total Trades', performance.totalTrades],
            ['Wins', performance.wins],
            ['Losses', performance.losses],
            ['Win Rate', `${formatNumber(performance.winRate)}%`],
            ['Best Trade', formatMoney(performance.bestTrade)],
            ['Worst Trade', formatMoney(performance.worstTrade)],
            ['Average Trade', formatMoney(performance.averageTrade)],
            ['Cumulative Realized', formatMoney(performance.cumulativeRealizedPnl)],
            ['Cumulative Unrealized', formatMoney(performance.cumulativeUnrealizedPnl)],
            ['Total Return', `${formatNumber(performance.totalReturn)}%`]
          ]} />
        </div>

        <div className="quant-panel quant-panel-log">
          <div className="quant-panel-heading">
            <h3>Live Trade Log</h3>
            <span>{snapshot?.tradeLog?.length || 0} recent fills</span>
          </div>
          <TradeLogTable rows={snapshot?.tradeLog || []} />
        </div>
      </section>
    </main>
  );
}

function MetricGrid({ items }) {
  return (
    <div className="quant-metric-grid">
      {items.map(([label, value]) => (
        <div key={label} className="quant-metric-cell">
          <label>{label}</label>
          <strong>{String(value ?? '—')}</strong>
        </div>
      ))}
    </div>
  );
}

function TradeLogTable({ rows }) {
  if (!rows.length) {
    return <p className="quant-empty">No paper fills yet. Start the strategy to populate the live log.</p>;
  }

  return (
    <div className="quant-table-wrap">
      <table className="quant-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Side</th>
            <th>Size</th>
            <th>Fill Price</th>
            <th>Reason / Signal</th>
            <th>Resulting Position</th>
            <th>Realized PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatTimestamp(row.timestamp)}</td>
              <td>{row.action}</td>
              <td>{row.side ? row.side.toUpperCase() : '—'}</td>
              <td>{formatQty(row.size)}</td>
              <td>{formatPrice(row.fillPrice)}</td>
              <td className="quant-log-reason">{row.reason}</td>
              <td>{row.resultingPosition}</td>
              <td>{row.realizedPnl == null ? '—' : formatMoney(row.realizedPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniStrategyChart({ chart }) {
  const candles = chart?.candles || [];
  if (!candles.length) {
    return <p className="quant-empty">Waiting for live candles to build the strategy chart.</p>;
  }

  const width = 980;
  const height = 300;
  const padding = { top: 16, right: 16, bottom: 28, left: 16 };
  const minPrice = Math.min(...candles.map((candle) => candle.low), ...(chart.averageEntryPrice ? [chart.averageEntryPrice] : []));
  const maxPrice = Math.max(...candles.map((candle) => candle.high), ...(chart.averageEntryPrice ? [chart.averageEntryPrice] : []));
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const candleStep = plotWidth / Math.max(candles.length, 1);
  const bodyWidth = Math.max(candleStep * 0.56, 2);
  const priceRange = Math.max(maxPrice - minPrice, 1);

  const xForIndex = (index) => padding.left + candleStep * index + candleStep / 2;
  const yForPrice = (price) => padding.top + ((maxPrice - price) / priceRange) * plotHeight;
  const vwapPath = candles.map((candle, index) => `${index === 0 ? 'M' : 'L'} ${xForIndex(index)} ${yForPrice(candle.vwap)}`).join(' ');
  const markerMap = new Map(candles.map((candle, index) => [candle.time, { candle, index }]));

  return (
    <div className="quant-mini-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="quant-chart-svg" role="img" aria-label="Live strategy candlestick chart">
        <rect x="0" y="0" width={width} height={height} fill="#07101c" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#17243a" strokeWidth="1" />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#17243a" strokeWidth="1" />
        {[0, 0.5, 1].map((ratio) => {
          const price = maxPrice - priceRange * ratio;
          const y = yForPrice(price);
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#111d31" strokeDasharray="4 6" />
              <text x={width - padding.right} y={y - 4} fill="#6f84aa" fontSize="11" textAnchor="end">{formatPrice(price)}</text>
            </g>
          );
        })}

        <path d={vwapPath} fill="none" stroke="#89aef7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {chart.averageEntryPrice ? (
          <g>
            <line
              x1={padding.left}
              y1={yForPrice(chart.averageEntryPrice)}
              x2={width - padding.right}
              y2={yForPrice(chart.averageEntryPrice)}
              stroke="#d8b04d"
              strokeDasharray="6 6"
              strokeWidth="1.5"
            />
            <text x={padding.left + 4} y={yForPrice(chart.averageEntryPrice) - 6} fill="#d8b04d" fontSize="11">Avg entry {formatPrice(chart.averageEntryPrice)}</text>
          </g>
        ) : null}

        {candles.map((candle, index) => {
          const x = xForIndex(index);
          const openY = yForPrice(candle.open);
          const closeY = yForPrice(candle.close);
          const highY = yForPrice(candle.high);
          const lowY = yForPrice(candle.low);
          const color = candle.close >= candle.open ? '#47c28f' : '#e16a74';
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);
          return (
            <g key={candle.time}>
              <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.5" />
              <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} rx="1" />
            </g>
          );
        })}

        {(chart.markers || []).map((marker, index) => {
          const mapped = markerMap.get(marker.time);
          if (!mapped) return null;
          const x = xForIndex(mapped.index);
          const candle = mapped.candle;
          if (marker.action === 'BUY') {
            const y = yForPrice(candle.low) + 10;
            return (
              <g key={`${marker.time}-${marker.action}-${index}`}>
                <path d={`M ${x} ${y - 16} L ${x - 7} ${y - 2} L ${x + 7} ${y - 2} Z`} fill="#47c28f" />
                <text x={x} y={y + 10} textAnchor="middle" fill="#47c28f" fontSize="10">BUY</text>
              </g>
            );
          }
          if (marker.action === 'SELL') {
            const y = yForPrice(candle.high) - 10;
            return (
              <g key={`${marker.time}-${marker.action}-${index}`}>
                <path d={`M ${x} ${y + 16} L ${x - 7} ${y + 2} L ${x + 7} ${y + 2} Z`} fill="#e16a74" />
                <text x={x} y={y - 10} textAnchor="middle" fill="#e16a74" fontSize="10">SELL</text>
              </g>
            );
          }
          const y = yForPrice(marker.price);
          return (
            <g key={`${marker.time}-${marker.action}-${index}`}>
              <circle cx={x} cy={y} r="5" fill="#d8b04d" stroke="#07101c" strokeWidth="2" />
              <text x={x} y={y - 10} textAnchor="middle" fill="#d8b04d" fontSize="10">EXIT</text>
            </g>
          );
        })}
      </svg>
      <div className="quant-chart-legend">
        <span><i className="is-buy" /> Buy entry</span>
        <span><i className="is-sell" /> Sell entry</span>
        <span><i className="is-exit" /> Exit</span>
        <span><i className="is-vwap" /> VWAP</span>
      </div>
    </div>
  );
}

function formatTimestamp(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  return `${number >= 0 ? '+' : ''}${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQty(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(4);
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '0.00';
  return Number(value).toFixed(2);
}
