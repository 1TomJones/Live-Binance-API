import {
  aggregateCandles,
  buildCanonicalMinuteCandles,
  bucketTime,
  timeframeToSeconds
} from '../sessionAnalytics.js';

export function buildSessionReplay({
  timeframe = '1m',
  replayMode = 'live',
  sessionStartMs,
  nowMs = Date.now(),
  trades = [],
  minuteCandles,
  cvdMinuteCandles,
  byBucket,
  settings = {}
} = {}) {
  const resolvedMinuteCandles = normalizeMinuteCandles(
    minuteCandles
    ?? buildCanonicalMinuteCandles(trades, {
      sessionStartMs,
      nowMs,
      includeEmptyMinutes: false
    })
  );

  const hydratedCandles = aggregateCandles(resolvedMinuteCandles, timeframe, { replayMode: 'market' });
  const replayCandles = aggregateCandles(resolvedMinuteCandles, timeframe, { replayMode: 'scaffold' });
  const scaffold = buildTimeScaffold(timeframe, sessionStartMs, nowMs);
  const hydratedByTime = new Map(
    replayCandles.map((candle) => [candle.time, { ...candle, isPlaceholder: false, state: candle.state || (candle.hasTrades ? 'hydrated' : 'synthetic') }])
  );
  const candles = scaffold.map((slot) => hydratedByTime.get(slot.time) || { ...slot, state: 'placeholder' });

  const vwap = buildRunningSessionVwap(hydratedCandles);
  const resolvedCvdMinuteCandles = normalizeCvdMinuteCandles(
    cvdMinuteCandles ?? buildCvdMinuteCandlesFromTrades(trades, { sessionStartMs, nowMs })
  );
  const cvd = aggregateSessionCvdCandles(resolvedCvdMinuteCandles, timeframe, { sessionStartMs, nowMs });
  const resolvedBuckets = byBucket ?? buildTradeBucketMap(trades, timeframe, { sessionStartMs, nowMs });
  const vwapByTime = new Map(vwap.map((point) => [point.time, point.value]));
  const cvdByTime = new Map(cvd.map((point) => [point.time, point]));
  const closedEngineCandles = enrichReplayCandles(
    hydratedCandles,
    { vwapByTime, cvdByTime, byBucket: resolvedBuckets, settings }
  );
  const engineSourceCandles = replayMode === 'backtest'
    ? hydratedCandles
    : candles.filter((candle) => !candle.isPlaceholder && Number.isFinite(candle.open) && Number.isFinite(candle.close));
  const engineCandles = replayMode === 'backtest'
    ? closedEngineCandles
    : enrichReplayCandles(engineSourceCandles, { vwapByTime, cvdByTime, byBucket: resolvedBuckets, settings });

  return {
    candles,
    hydratedCandles,
    replayCandles,
    vwap,
    cvd,
    byBucket: resolvedBuckets,
    engineCandles,
    closedEngineCandles
  };
}

export function buildTimeScaffold(timeframe, sessionStartMs, nowMs) {
  const tfSeconds = timeframeToSeconds(timeframe);
  const startSec = bucketTime(Math.floor(sessionStartMs / 1000), timeframe);
  const endSec = bucketTime(Math.floor(nowMs / 1000), timeframe);
  const scaffold = [];

  for (let ts = startSec; ts <= endSec; ts += tfSeconds) {
    scaffold.push({
      time: ts,
      open: null,
      high: null,
      low: null,
      close: null,
      volume: 0,
      hasTrades: false,
      isPlaceholder: true,
      isSynthetic: false,
      state: 'placeholder'
    });
  }

  return scaffold;
}

export function buildRunningSessionVwap(candles = []) {
  const running = [];
  let cumulativePv = 0;
  let cumulativeVolume = 0;

  candles.forEach((candle) => {
    const typicalPrice = (Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3;
    const volume = Number(candle.volume || 0);
    cumulativePv += typicalPrice * volume;
    cumulativeVolume += volume;

    running.push({
      time: candle.time,
      value: cumulativeVolume > 0 ? cumulativePv / cumulativeVolume : Number(candle.close || 0)
    });
  });

  return running;
}

export function buildCvdMinuteCandlesFromTrades(trades = [], { sessionStartMs, nowMs = Date.now() } = {}) {
  const ordered = [...trades]
    .filter((trade) => trade && Number.isFinite(trade.trade_time))
    .sort((a, b) => a.trade_time - b.trade_time || (a.trade_id || 0) - (b.trade_id || 0));

  const buckets = new Map();
  let running = 0;

  ordered.forEach((trade) => {
    if (trade.trade_time < sessionStartMs || trade.trade_time > nowMs) return;

    const minuteTime = bucketTime(Math.floor(trade.trade_time / 1000), '1m');
    if (!buckets.has(minuteTime)) {
      buckets.set(minuteTime, {
        time: minuteTime,
        open: running,
        high: running,
        low: running,
        close: running,
        hasTrades: false
      });
    }

    const candle = buckets.get(minuteTime);
    const delta = Number(trade.maker_flag) ? -Number(trade.quantity || 0) : Number(trade.quantity || 0);
    running += delta;
    candle.high = Math.max(candle.high, running);
    candle.low = Math.min(candle.low, running);
    candle.close = running;
    candle.hasTrades = true;
  });

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function aggregateSessionCvdCandles(minuteCandles = [], timeframe = '1m', { sessionStartMs, nowMs = Date.now() } = {}) {
  const startSec = bucketTime(Math.floor(sessionStartMs / 1000), timeframe);
  const endSec = bucketTime(Math.floor(nowMs / 1000), timeframe);
  const tfSec = timeframeToSeconds(timeframe);

  if (timeframe === '1m') {
    const minuteMap = new Map(normalizeCvdMinuteCandles(minuteCandles).map((candle) => [candle.time, candle]));
    const result = [];
    let previousClose = 0;

    for (let ts = startSec; ts <= endSec; ts += tfSec) {
      const existing = minuteMap.get(ts);
      if (existing) {
        previousClose = existing.close;
        result.push({ ...existing });
      } else {
        result.push({ time: ts, open: previousClose, high: previousClose, low: previousClose, close: previousClose, hasTrades: false });
      }
    }

    return result;
  }

  const minuteSeries = aggregateSessionCvdCandles(minuteCandles, '1m', { sessionStartMs, nowMs });
  const buckets = new Map();

  minuteSeries.forEach((candle) => {
    const bucket = bucketTime(candle.time, timeframe);
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        hasTrades: Boolean(candle.hasTrades)
      });
      return;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.hasTrades = existing.hasTrades || Boolean(candle.hasTrades);
  });

  const result = [];
  let previousClose = 0;
  for (let ts = startSec; ts <= endSec; ts += tfSec) {
    const existing = buckets.get(ts);
    if (existing) {
      previousClose = existing.close;
      result.push(existing);
    } else {
      result.push({ time: ts, open: previousClose, high: previousClose, low: previousClose, close: previousClose, hasTrades: false });
    }
  }

  return result;
}

export function buildTradeBucketMap(trades = [], timeframe = '1m', { sessionStartMs, nowMs = Date.now() } = {}) {
  const buckets = new Map();
  const tfSec = timeframeToSeconds(timeframe);

  trades.forEach((trade) => {
    if (!trade || trade.trade_time < sessionStartMs || trade.trade_time > nowMs) return;

    const time = Math.floor((trade.trade_time / 1000) / tfSec) * tfSec;
    const bucket = buckets.get(time) || { buy: 0, sell: 0 };
    if (trade.side === 'buy') bucket.buy += Number(trade.quantity || 0);
    else bucket.sell += Number(trade.quantity || 0);
    buckets.set(time, bucket);
  });

  return buckets;
}

export function enrichReplayCandles(candles, { vwapByTime, cvdByTime, byBucket = new Map(), settings = {} } = {}) {
  return (candles || []).map((candle, idx, arr) => {
    const bucket = byBucket.get(candle.time) || { buy: 0, sell: 0 };
    const recent = arr.slice(Math.max(0, idx - 19), idx + 1);
    const avgVolume20 = recent.reduce((acc, entry) => acc + Number(entry.volume || 0), 0) / Math.max(recent.length, 1);
    const cvdCandle = cvdByTime?.get(candle.time) || { open: 0, high: 0, low: 0, close: 0 };
    const previous = arr[idx - 1] || candle;
    const previousCvd = cvdByTime?.get(previous.time) || cvdCandle;
    const sessionVwap = vwapByTime?.get(candle.time) ?? candle.close;

    return {
      ...candle,
      vwap: sessionVwap,
      vwap_session: sessionVwap,
      cvd_open: cvdCandle.open ?? 0,
      cvd_high: cvdCandle.high ?? 0,
      cvd_low: cvdCandle.low ?? 0,
      cvd_close: cvdCandle.close ?? 0,
      prev_cvd_close: previousCvd.close ?? cvdCandle.close ?? 0,
      dom_visible_buy_limits: bucket.buy,
      dom_visible_sell_limits: bucket.sell,
      avg_volume_20: avgVolume20,
      stopLossPct: settings.stopLossPct,
      takeProfitPct: settings.takeProfitPct
    };
  });
}

function normalizeMinuteCandles(candles = []) {
  return [...candles]
    .filter((candle) => candle && Number.isFinite(candle.time))
    .map((candle) => ({
      time: candle.time,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume || 0),
      hasTrades: Boolean(candle.hasTrades),
      isPlaceholder: Boolean(candle.isPlaceholder),
      isSynthetic: Boolean(candle.isSynthetic ?? (!candle.hasTrades && !candle.isPlaceholder)),
      state: candle.state || (candle.isPlaceholder ? 'placeholder' : candle.hasTrades ? 'hydrated' : 'synthetic')
    }))
    .sort((a, b) => a.time - b.time);
}

function normalizeCvdMinuteCandles(candles = []) {
  return [...candles]
    .filter((candle) => candle && Number.isFinite(candle.time))
    .map((candle) => ({
      time: candle.time,
      open: Number(candle.open || 0),
      high: Number(candle.high || 0),
      low: Number(candle.low || 0),
      close: Number(candle.close || 0),
      hasTrades: Boolean(candle.hasTrades)
    }))
    .sort((a, b) => a.time - b.time);
}
