import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './__fixtures__/marketReplayParity.json' with { type: 'json' };
import { buildCanonicalMinuteCandles } from '../sessionAnalytics.js';
import { buildCvdMinuteCandlesFromTrades } from './sessionReplayBuilder.js';
import { buildReplayEnvironment } from './replayEnvironment.js';

test('shared replay environment keeps canonical live inputs and trade-driven backtest inputs in parity for one UTC session', () => {
  const { trades, timeframe, sessionStartMs, nowMs } = fixture;
  const minuteCandles = buildCanonicalMinuteCandles(trades, {
    sessionStartMs,
    nowMs,
    includeEmptyMinutes: true
  });
  const cvdMinuteCandles = buildCvdMinuteCandlesFromTrades(trades, { sessionStartMs, nowMs });

  const liveStyleEnvironment = buildReplayEnvironment({
    timeframe,
    replayMode: 'live',
    sessionStartMs,
    nowMs,
    input: {
      mode: 'canonical',
      minuteCandles,
      cvdMinuteCandles
    }
  });

  const backtestEnvironment = buildReplayEnvironment({
    timeframe,
    replayMode: 'backtest',
    sessionStartMs,
    nowMs,
    input: {
      mode: 'trades',
      trades
    }
  });

  assert.deepStrictEqual(
    normalizeParitySeries(liveStyleEnvironment.replay.engineCandles),
    normalizeParitySeries(backtestEnvironment.replay.engineCandles)
  );
});

function normalizeParitySeries(series = []) {
  return series.map((candle) => ({
    time: candle.time,
    open: round(candle.open),
    high: round(candle.high),
    low: round(candle.low),
    close: round(candle.close),
    volume: round(candle.volume),
    vwap_session: round(candle.vwap_session),
    cvd_open: round(candle.cvd_open),
    cvd_high: round(candle.cvd_high),
    cvd_low: round(candle.cvd_low),
    cvd_close: round(candle.cvd_close),
    prev_cvd_close: round(candle.prev_cvd_close)
  }));
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(8)) : value;
}
