import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './__fixtures__/marketReplayParity.json' with { type: 'json' };
import { buildCanonicalMinuteCandles } from '../sessionAnalytics.js';
import {
  buildCvdMinuteCandlesFromTrades,
  buildSessionReplay,
  buildTradeBucketMap,
  REPLAY_EXECUTION_MODES
} from './sessionReplayBuilder.js';

test('strict live parity mode keeps live and backtest execution feeds identical', () => {
  const { trades, timeframe, sessionStartMs, nowMs } = fixture;

  const liveStyleReplay = buildSessionReplay({
    timeframe,
    replayMode: 'live',
    executionMode: REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY,
    sessionStartMs,
    nowMs,
    minuteCandles: buildCanonicalMinuteCandles(trades, {
      sessionStartMs,
      nowMs,
      includeEmptyMinutes: true
    }),
    cvdMinuteCandles: buildCvdMinuteCandlesFromTrades(trades, { sessionStartMs, nowMs }),
    byBucket: buildTradeBucketMap(trades, timeframe, { sessionStartMs, nowMs })
  });

  const backtestReplay = buildSessionReplay({
    timeframe,
    replayMode: 'backtest',
    executionMode: REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY,
    sessionStartMs,
    nowMs,
    trades
  });

  assert.equal(backtestReplay.executionMode, REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY);
  assert.deepStrictEqual(normalizeReplay(liveStyleReplay.engineCandles), normalizeReplay(backtestReplay.engineCandles));
  assert.deepStrictEqual(normalizeReplay(backtestReplay.closedEngineCandles), normalizeReplay(backtestReplay.engineCandles));
  assert.deepStrictEqual(normalizeSeries(liveStyleReplay.vwap), normalizeSeries(backtestReplay.vwap));
  assert.deepStrictEqual(normalizeReplay(liveStyleReplay.cvd), normalizeReplay(backtestReplay.cvd));
});

test('trade-only mode remains available as the explicit legacy backtest feed', () => {
  const sessionStartMs = Date.UTC(2025, 0, 1, 0, 0, 0, 0);
  const nowMs = sessionStartMs + (4 * 60 * 1000);
  const minuteCandles = [
    { time: sessionStartMs / 1000, open: 100, high: 100, low: 100, close: 100, volume: 2, hasTrades: true },
    { time: sessionStartMs / 1000 + 60, open: 100, high: 100, low: 100, close: 100, volume: 0, hasTrades: false, isSynthetic: true, state: 'synthetic' },
    { time: sessionStartMs / 1000 + 120, open: 101, high: 101, low: 101, close: 101, volume: 3, hasTrades: true }
  ];

  const liveReplay = buildSessionReplay({
    timeframe: '1m',
    replayMode: 'live',
    executionMode: REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY,
    sessionStartMs,
    nowMs,
    minuteCandles
  });

  const parityBacktestReplay = buildSessionReplay({
    timeframe: '1m',
    replayMode: 'backtest',
    executionMode: REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY,
    sessionStartMs,
    nowMs,
    minuteCandles
  });

  const tradeOnlyBacktestReplay = buildSessionReplay({
    timeframe: '1m',
    replayMode: 'backtest',
    executionMode: REPLAY_EXECUTION_MODES.TRADE_ONLY,
    sessionStartMs,
    nowMs,
    minuteCandles
  });

  assert.deepStrictEqual(
    liveReplay.engineCandles.map((candle) => ({ time: candle.time, hasTrades: candle.hasTrades })),
    [
      { time: sessionStartMs / 1000, hasTrades: true },
      { time: sessionStartMs / 1000 + 60, hasTrades: false },
      { time: sessionStartMs / 1000 + 120, hasTrades: true }
    ]
  );

  assert.deepStrictEqual(
    parityBacktestReplay.closedEngineCandles.map((candle) => ({ time: candle.time, hasTrades: candle.hasTrades })),
    liveReplay.engineCandles.map((candle) => ({ time: candle.time, hasTrades: candle.hasTrades }))
  );

  assert.deepStrictEqual(
    tradeOnlyBacktestReplay.closedEngineCandles.map((candle) => ({ time: candle.time, hasTrades: candle.hasTrades })),
    [
      { time: sessionStartMs / 1000, hasTrades: true },
      { time: sessionStartMs / 1000 + 120, hasTrades: true }
    ]
  );

  assert.equal(tradeOnlyBacktestReplay.executionMode, REPLAY_EXECUTION_MODES.TRADE_ONLY);
  assert.equal(parityBacktestReplay.candles.filter((candle) => candle.state === 'placeholder').length, 2);
  assert.equal(parityBacktestReplay.candles.filter((candle) => candle.state === 'synthetic').length, 1);
});

function normalizeReplay(series = []) {
  return series.map((entry) => normalizeObject(entry));
}

function normalizeSeries(series = []) {
  return series.map((entry) => normalizeObject(entry));
}

function normalizeObject(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeObject(entry));
  }

  if (!value || typeof value !== 'object') {
    return typeof value === 'number' ? round(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeObject(entry)])
  );
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(8)) : value;
}
