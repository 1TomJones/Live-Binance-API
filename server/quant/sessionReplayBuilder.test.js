import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './__fixtures__/marketReplayParity.json' with { type: 'json' };
import { buildCanonicalMinuteCandles } from '../sessionAnalytics.js';
import {
  buildCvdMinuteCandlesFromTrades,
  buildSessionReplay,
  buildTradeBucketMap
} from './sessionReplayBuilder.js';

test('shared session replay builder keeps live-style and backtest replay indicators in parity', () => {
  const { trades, timeframe, sessionStartMs, nowMs } = fixture;

  const liveStyleReplay = buildSessionReplay({
    timeframe,
    sessionStartMs,
    nowMs,
    minuteCandles: buildCanonicalMinuteCandles(trades, {
      sessionStartMs,
      nowMs,
      includeEmptyMinutes: false
    }),
    cvdMinuteCandles: buildCvdMinuteCandlesFromTrades(trades, { sessionStartMs, nowMs }),
    byBucket: buildTradeBucketMap(trades, timeframe, { sessionStartMs, nowMs })
  });

  const backtestReplay = buildSessionReplay({
    timeframe,
    sessionStartMs,
    nowMs,
    trades
  });

  assert.deepStrictEqual(normalizeReplay(liveStyleReplay.engineCandles), normalizeReplay(backtestReplay.engineCandles));
  assert.deepStrictEqual(normalizeSeries(liveStyleReplay.vwap), normalizeSeries(backtestReplay.vwap));
  assert.deepStrictEqual(normalizeReplay(liveStyleReplay.cvd), normalizeReplay(backtestReplay.cvd));
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
