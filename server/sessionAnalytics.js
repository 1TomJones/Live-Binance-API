const TIMEFRAME_TO_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600
};

export function timeframeToSeconds(timeframe = '1m') {
  return TIMEFRAME_TO_SECONDS[timeframe] || TIMEFRAME_TO_SECONDS['1m'];
}

export function getUtcDayStartMs(ts = Date.now()) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

export function bucketTime(unixSeconds, timeframe = '1m') {
  const sec = timeframeToSeconds(timeframe);
  return Math.floor(unixSeconds / sec) * sec;
}

export function buildCandlesFromTrades(trades, timeframe = '1m') {
  const buckets = new Map();
  const ordered = [...trades].sort((a, b) => a.trade_time - b.trade_time || a.trade_id - b.trade_id);

  ordered.forEach((trade) => {
    const tradeSec = Math.floor(trade.trade_time / 1000);
    const candleTime = bucketTime(tradeSec, timeframe);
    const price = Number(trade.price);
    const quantity = Number(trade.quantity || 0);

    const existing = buckets.get(candleTime);
    if (!existing) {
      buckets.set(candleTime, {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: quantity
      });
      return;
    }

    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
    existing.volume += quantity;
  });

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function computeSessionVwapFromTrades(trades, timeframe = '1m') {
  const running = [];
  let cumulativePv = 0;
  let cumulativeVolume = 0;
  let activeDayStart = null;

  const candles = buildCandlesFromTrades(trades, timeframe);
  candles.forEach((candle) => {
    const candleMs = candle.time * 1000;
    const dayStart = getUtcDayStartMs(candleMs);
    if (activeDayStart !== dayStart) {
      activeDayStart = dayStart;
      cumulativePv = 0;
      cumulativeVolume = 0;
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePv += typicalPrice * Number(candle.volume || 0);
    cumulativeVolume += Number(candle.volume || 0);

    running.push({
      time: candle.time,
      value: cumulativeVolume > 0 ? cumulativePv / cumulativeVolume : candle.close
    });
  });

  return running;
}

export function computeSessionCvdFromTrades(trades, timeframe = '1m') {
  const ordered = [...trades].sort((a, b) => a.trade_time - b.trade_time || a.trade_id - b.trade_id);
  const buckets = new Map();
  let running = 0;
  let activeDayStart = null;

  ordered.forEach((trade) => {
    const dayStart = getUtcDayStartMs(trade.trade_time);
    if (activeDayStart !== dayStart) {
      activeDayStart = dayStart;
      running = 0;
    }

    const tradeSec = Math.floor(trade.trade_time / 1000);
    const candleTime = bucketTime(tradeSec, timeframe);
    if (!buckets.has(candleTime)) {
      buckets.set(candleTime, {
        time: candleTime,
        open: running,
        high: running,
        low: running,
        close: running
      });
    }

    const candle = buckets.get(candleTime);
    const delta = Number(trade.maker_flag) ? -Number(trade.quantity || 0) : Number(trade.quantity || 0);
    running += delta;
    candle.high = Math.max(candle.high, running);
    candle.low = Math.min(candle.low, running);
    candle.close = running;
  });

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function buildVolumeProfileByDollar(trades) {
  if (!trades.length) return [];

  const buckets = new Map();
  trades.forEach((trade) => {
    const bucket = Math.floor(Number(trade.price));
    const volume = Number(trade.quantity || 0);
    buckets.set(bucket, (buckets.get(bucket) || 0) + volume);
  });

  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const maxVolume = Math.max(...sorted.map(([, volume]) => volume), 1);

  return sorted.map(([price, volume]) => ({
    price,
    volume,
    ratio: volume / maxVolume
  }));
}
