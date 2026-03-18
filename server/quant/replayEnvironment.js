import { buildCanonicalMinuteCandles } from '../sessionAnalytics.js';
import {
  buildCvdMinuteCandlesFromTrades,
  buildSessionReplay,
  buildTradeBucketMap
} from './sessionReplayBuilder.js';

export function buildReplayEnvironment({
  timeframe = '1m',
  replayMode = 'live',
  sessionStartMs,
  nowMs = Date.now(),
  input,
  trades,
  minuteCandles,
  cvdMinuteCandles,
  byBucket,
  candleHydration,
  settings = {}
} = {}) {
  const resolvedInput = resolveReplayInput({
    input,
    trades,
    minuteCandles,
    cvdMinuteCandles,
    byBucket,
    candleHydration,
    sessionStartMs,
    nowMs,
    timeframe
  });

  return {
    ...resolvedInput,
    replay: buildSessionReplay({
      timeframe,
      replayMode,
      sessionStartMs,
      nowMs,
      minuteCandles: resolvedInput.minuteCandles,
      cvdMinuteCandles: resolvedInput.cvdMinuteCandles,
      byBucket: resolvedInput.byBucket,
      settings
    })
  };
}

export function resolveReplayInput({
  input,
  trades,
  minuteCandles,
  cvdMinuteCandles,
  byBucket,
  candleHydration,
  sessionStartMs,
  nowMs = Date.now(),
  timeframe = '1m'
} = {}) {
  const source = input || inferReplayInputSource({ trades, minuteCandles, cvdMinuteCandles, byBucket, candleHydration });

  if (source.mode === 'canonical') {
    assertCanonicalReplayInput(source);

    return {
      mode: 'canonical',
      minuteCandles: source.minuteCandles,
      cvdMinuteCandles: source.cvdMinuteCandles,
      byBucket: source.byBucket ?? new Map()
    };
  }

  if (source.mode === 'trades') {
    const resolvedTrades = Array.isArray(source.trades) ? source.trades : [];
    const resolvedCandleHydration = source.candleHydration || {};
    const resolvedMinuteCandles = buildCanonicalMinuteCandles(resolvedTrades, {
      sessionStartMs,
      nowMs,
      includeEmptyMinutes: resolvedCandleHydration.includeEmptyMinutes ?? false,
      carryForwardOnEmpty: resolvedCandleHydration.carryForwardOnEmpty ?? true
    });

    return {
      mode: 'trades',
      trades: resolvedTrades,
      candleHydration: resolvedCandleHydration,
      minuteCandles: resolvedMinuteCandles,
      cvdMinuteCandles: buildCvdMinuteCandlesFromTrades(resolvedTrades, { sessionStartMs, nowMs }),
      byBucket: source.byBucket ?? buildTradeBucketMap(resolvedTrades, timeframe, { sessionStartMs, nowMs })
    };
  }

  throw new Error(`Unsupported replay input mode: ${source.mode}`);
}

function inferReplayInputSource({ trades, minuteCandles, cvdMinuteCandles, byBucket, candleHydration } = {}) {
  if (minuteCandles || cvdMinuteCandles) {
    return {
      mode: 'canonical',
      minuteCandles,
      cvdMinuteCandles,
      byBucket
    };
  }

  return {
    mode: 'trades',
    trades: trades || [],
    byBucket,
    candleHydration
  };
}

function assertCanonicalReplayInput(input = {}) {
  if (!Array.isArray(input.minuteCandles)) {
    throw new Error('Canonical replay input requires minuteCandles.');
  }

  if (!Array.isArray(input.cvdMinuteCandles)) {
    throw new Error('Canonical replay input requires cvdMinuteCandles.');
  }
}
