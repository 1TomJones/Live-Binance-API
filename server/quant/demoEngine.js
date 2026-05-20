/**
 * Demo Engine — fetches historical data and runs training/backtest pipelines
 * for the ML Strategy Demo page.
 */

import { fetchBinanceWithFallback } from '../binanceHistoricalData.js';
import { computeIndicators } from './indicators.js';
import { MODEL_DEFINITIONS, trainModel, runBacktest, calcMetrics } from './mlModelDefinitions.js';

const INTERVAL_TO_MS = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000
};

/**
 * Fetch paginated klines from Binance for a given symbol/interval/year range.
 * Returns candles: [{ time (seconds), open, high, low, close, volume }]
 */
export async function fetchDemoHistoricalData({ symbol, interval, years }) {
  const intervalMs = INTERVAL_TO_MS[interval];
  if (!intervalMs) throw new Error(`Unsupported interval: ${interval}`);

  const endMs = Date.now();
  const startMs = endMs - years * 365 * 24 * 60 * 60 * 1000;

  const candles = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const search = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(endMs),
      limit: '1000'
    });

    const { payload: batch } = await fetchBinanceWithFallback('/klines', search, {
      context: `demo/${symbol}/${interval}`,
      timeoutMs: 30000
    });

    if (!batch || !batch.length) break;

    for (const row of batch) {
      candles.push({
        time: Math.floor(Number(row[0]) / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      });
    }

    const lastOpenMs = Number(batch[batch.length - 1][0]);
    const nextCursor = lastOpenMs + intervalMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  // Deduplicate by time
  const byTime = new Map();
  for (const c of candles) byTime.set(c.time, c);
  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);

  return sorted;
}

/**
 * Run the full training pipeline: fetch data, compute indicators, train all 5
 * models, return ranked results by test Sharpe ratio.
 */
export async function runTrainingPipeline({ symbol, interval, years, indicatorSelection }) {
  const candles = await fetchDemoHistoricalData({ symbol, interval, years });

  if (candles.length < 50) {
    throw new Error(`Insufficient data: only ${candles.length} candles fetched for ${symbol} ${interval}`);
  }

  const indicators = computeIndicators(candles, indicatorSelection || {});

  const results = [];
  for (const modelDef of MODEL_DEFINITIONS) {
    // Ensure required indicators are selected
    const hasRequired = modelDef.requiredIndicators.every((req) => indicatorSelection[req]);
    if (!hasRequired) continue;

    const result = trainModel(modelDef, candles, indicators);
    if (result) results.push(result);
  }

  // Rank by test Sharpe descending
  results.sort((a, b) => (b.testMetrics?.sharpe ?? -Infinity) - (a.testMetrics?.sharpe ?? -Infinity));

  const from = candles[0]?.time;
  const to = candles[candles.length - 1]?.time;

  return {
    models: results,
    dataStats: {
      candles: candles.length,
      from,
      to
    }
  };
}

/**
 * Run a full backtest on the entire period for a specific model with given params.
 * Returns equity curve, trades, metrics, and candleSummary (OHLCV for the chart).
 */
export async function runFullBacktest({ symbol, interval, years, modelId, trainedParams, indicatorSelection }) {
  const candles = await fetchDemoHistoricalData({ symbol, interval, years });

  if (candles.length < 50) {
    throw new Error(`Insufficient data: only ${candles.length} candles fetched for ${symbol} ${interval}`);
  }

  // Ensure indicators needed for the model are computed
  const selection = { ...(indicatorSelection || {}) };

  // Always enable required indicators for the chosen model
  const modelDef = MODEL_DEFINITIONS.find((m) => m.id === modelId);
  if (!modelDef) throw new Error(`Unknown model: ${modelId}`);

  for (const req of modelDef.requiredIndicators) {
    selection[req] = true;
  }

  const indicators = computeIndicators(candles, selection);

  const { trades, equityCurve } = runBacktest(
    candles,
    indicators,
    modelDef.signal.bind(modelDef),
    trainedParams,
    0
  );

  const metrics = calcMetrics(trades, equityCurve, 10000);

  // Summarize candles for the chart (pass full OHLCV)
  const candleSummary = candles.map(({ time, open, high, low, close, volume }) => ({
    time, open, high, low, close, volume
  }));

  return {
    equityCurve,
    trades,
    metrics,
    candleSummary
  };
}
