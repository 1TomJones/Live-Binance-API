import { bucketTime, timeframeToSeconds } from './sessionAnalytics.js';

export const BINANCE_REST_BASES = [
  process.env.BINANCE_REST_URL,
  'https://api.binance.com/api/v3',
  'https://api1.binance.com/api/v3',
  'https://data-api.binance.vision/api/v3'
].filter(Boolean);

export class NonRetryableBinanceRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NonRetryableBinanceRequestError';
  }
}

export async function fetchBinanceWithFallback(endpointPath, search, { timeoutMs = 10000, context = 'binance-request', baseUrls = BINANCE_REST_BASES } = {}) {
  const params = Object.fromEntries(search.entries());
  let lastFailure = null;

  for (const baseUrl of baseUrls) {
    const normalizedEndpointPath = endpointPath.startsWith('/') ? endpointPath.slice(1) : endpointPath;
    const baseAlreadyTargetsEndpoint = baseUrl.endsWith(`/${normalizedEndpointPath}`);
    const url = baseAlreadyTargetsEndpoint
      ? `${baseUrl}?${search.toString()}`
      : `${baseUrl}${endpointPath}?${search.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const responseBody = await response.text();
        const failure = {
          status: response.status,
          url,
          baseUrl,
          endpointPath,
          params,
          responseBody
        };

        console.error(`[${context}] non-200 response from Binance`, failure);
        lastFailure = failure;

        if (response.status >= 400 && response.status < 500) {
          const message = responseBody || `HTTP ${response.status}`;
          throw new NonRetryableBinanceRequestError(
            `Binance ${endpointPath} request rejected (HTTP ${response.status}): ${message}`
          );
        }

        continue;
      }

      const payload = await response.json();
      return { payload, url, baseUrl };
    } catch (error) {
      if (error instanceof NonRetryableBinanceRequestError) {
        throw error;
      }

      lastFailure = {
        url,
        baseUrl,
        endpointPath,
        params,
        error: error?.message || String(error)
      };
      console.error(`[${context}] request failed`, lastFailure);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `Unable to fetch ${endpointPath} from Binance endpoints: ${JSON.stringify(lastFailure)}`
  );
}

export function normalizeKline(row) {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    takerBuyBaseVolume: Number(row[9] || 0),
    takerSellBaseVolume: Math.max(Number(row[5] || 0) - Number(row[9] || 0), 0),
    hasTrades: Number(row[8] || 0) > 0,
    isPlaceholder: false,
    isSynthetic: false,
    state: Number(row[8] || 0) > 0 ? 'hydrated' : 'synthetic'
  };
}

export async function fetchMinuteKlinesRange({ symbol, startMs, endMs, limit = 1000, context = 'binance/klines' }) {
  const collected = [];
  let cursor = startMs;
  const finalEndMs = Math.max(startMs, endMs);

  while (cursor <= finalEndMs) {
    const search = new URLSearchParams({
      symbol,
      interval: '1m',
      startTime: String(cursor),
      endTime: String(finalEndMs),
      limit: String(limit)
    });

    const { payload: batch } = await fetchBinanceWithFallback('/klines', search, { context });
    if (!batch.length) break;

    const normalizedBatch = batch.map(normalizeKline);
    collected.push(...normalizedBatch);

    const lastOpenMs = Number(batch.at(-1)?.[0] || cursor);
    const nextCursor = lastOpenMs + 60_000;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  return dedupeMinuteCandles(collected).filter((candle) => candle.time >= Math.floor(startMs / 1000) && candle.time <= Math.floor(finalEndMs / 1000));
}

export function buildCvdMinuteCandlesFromKlines(candles = []) {
  const normalized = dedupeMinuteCandles(candles);
  let running = 0;

  return normalized.map((candle) => {
    const buy = Number(candle.takerBuyBaseVolume || 0);
    const sell = Number(candle.takerSellBaseVolume ?? Math.max(Number(candle.volume || 0) - buy, 0));
    const delta = buy - sell;
    const open = running;
    const close = running + delta;
    running = close;

    return {
      time: candle.time,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      hasTrades: Boolean(candle.hasTrades || candle.volume > 0)
    };
  });
}

export function buildTradeBucketMapFromKlines(candles = [], timeframe = '1m') {
  const tfSeconds = timeframeToSeconds(timeframe);
  const buckets = new Map();

  dedupeMinuteCandles(candles).forEach((candle) => {
    const bucket = bucketTime(candle.time, timeframe);
    const existing = buckets.get(bucket) || { buy: 0, sell: 0 };
    existing.buy += Number(candle.takerBuyBaseVolume || 0);
    existing.sell += Number(candle.takerSellBaseVolume ?? Math.max(Number(candle.volume || 0) - Number(candle.takerBuyBaseVolume || 0), 0));
    buckets.set(bucket, existing);
  });

  if (tfSeconds <= 60) return buckets;
  return new Map([...buckets.entries()].sort((a, b) => a[0] - b[0]));
}

export function aggregateTradeBuckets(minuteBuckets = new Map(), timeframe = '1m') {
  const tfSeconds = timeframeToSeconds(timeframe);
  if (tfSeconds <= 60) {
    return new Map([...minuteBuckets.entries()].sort((a, b) => a[0] - b[0]));
  }

  const aggregated = new Map();
  [...minuteBuckets.entries()].forEach(([time, bucket]) => {
    const groupedTime = bucketTime(Number(time), timeframe);
    const existing = aggregated.get(groupedTime) || { buy: 0, sell: 0 };
    existing.buy += Number(bucket?.buy || 0);
    existing.sell += Number(bucket?.sell || 0);
    aggregated.set(groupedTime, existing);
  });

  return new Map([...aggregated.entries()].sort((a, b) => a[0] - b[0]));
}

function dedupeMinuteCandles(candles = []) {
  const byTime = new Map();
  [...candles]
    .filter((candle) => candle && Number.isFinite(candle.time))
    .sort((a, b) => a.time - b.time)
    .forEach((candle) => {
      byTime.set(candle.time, {
        ...candle,
        time: Number(candle.time),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume || 0),
        takerBuyBaseVolume: Number(candle.takerBuyBaseVolume || 0),
        takerSellBaseVolume: Number(candle.takerSellBaseVolume ?? Math.max(Number(candle.volume || 0) - Number(candle.takerBuyBaseVolume || 0), 0)),
        hasTrades: Boolean(candle.hasTrades || Number(candle.volume || 0) > 0),
        isPlaceholder: Boolean(candle.isPlaceholder),
        isSynthetic: Boolean(candle.isSynthetic),
        state: candle.state || (candle.hasTrades ? 'hydrated' : 'synthetic')
      });
    });

  return [...byTime.values()];
}
