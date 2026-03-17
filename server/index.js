import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { BinanceStreamService } from './binanceStream.js';
import {
  completeQuantBacktestJob,
  createQuantBacktestJob,
  failQuantBacktestJob,
  getLatestBook,
  getQuantBacktestJobById,
  getQuantResultByJobId,
  getRecentTrades,
  getTradeRange,
  getTradesByRange,
  listQuantBacktestJobs,
  listQuantJobProgress,
  saveBookTicker,
  saveQuantBacktestResult,
  saveQuantLiveRun,
  saveQuantStrategy,
  saveTrade,
  updateQuantBacktestJob,
  getQuantStrategyById
} from './db.js';
import { BacktestJobService } from './quant/backtestJobService.js';
import { StrategyParser } from './quant/strategyParser.js';
import { StrategyExecutionEngine } from './quant/strategyExecutionEngine.js';
import { BacktestRunner } from './quant/backtestRunner.js';
import { createDefaultLivePaperRunner } from './quant/livePaperRunner.js';
import { StrategyUploadService, StrategyValidationService } from './quant/strategyServices.js';
import {
  buildVolumeProfileFromMap,
  computeSessionCvdFromMinuteCandles,
  computeSessionVwapFromCandles,
  aggregateCandles,
  getUtcDayStartMs,
} from './sessionAnalytics.js';

const PORT = process.env.PORT || 3000;
const SYMBOL = 'BTCUSDT';
const BINANCE_REST_BASES = [
  process.env.BINANCE_REST_URL,
  'https://api.binance.com/api/v3',
  'https://api1.binance.com/api/v3',
  'https://data-api.binance.vision/api/v3'
].filter(Boolean);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

let latestTrade = null;
let latestBook = null;
let latestDepth = null;
function createSessionState(dayStartMs) {
  return {
    dayStartMs,
    minuteCandles: [],
    minuteCandleIndex: new Map(),
    cvdRunning: 0,
    cvdMinuteCandles: [],
    cvdMinuteIndex: new Map(),
    volumeProfile: new Map(),
    lastProcessedTradeId: null,
    hydration: {
      status: 'idle',
      source: null,
      startedAt: null,
      finishedAt: null,
      fetchedCandleCount: 0,
      fetchedTradeCount: 0,
      mergedCandleCount: 0,
      processedTradeCount: 0,
      lastError: null
    }
  };
}

let sessionState = createSessionState(getUtcDayStartMs());

function ensureCurrentSession(nowMs = Date.now()) {
  const currentDayStart = getUtcDayStartMs(nowMs);
  if (sessionState.dayStartMs !== currentDayStart) {
    sessionState = createSessionState(currentDayStart);
    console.info('[session] rolled to new UTC day', { dayStartIso: new Date(currentDayStart).toISOString() });
  }
}


function ensureCvdMinuteCandle(minuteTimeSec) {
  const existingIndex = sessionState.cvdMinuteIndex.get(minuteTimeSec);
  if (existingIndex !== undefined) {
    return sessionState.cvdMinuteCandles[existingIndex];
  }

  const candle = {
    time: minuteTimeSec,
    open: sessionState.cvdRunning,
    high: sessionState.cvdRunning,
    low: sessionState.cvdRunning,
    close: sessionState.cvdRunning,
    hasTrades: false
  };

  sessionState.cvdMinuteIndex.set(minuteTimeSec, sessionState.cvdMinuteCandles.length);
  sessionState.cvdMinuteCandles.push(candle);
  return candle;
}

function applyTradeToDerivedState(trade) {
  if (!trade || trade.trade_time < sessionState.dayStartMs) return false;
  if (Number.isFinite(sessionState.lastProcessedTradeId) && trade.trade_id <= sessionState.lastProcessedTradeId) return false;

  const quantity = Number(trade.quantity || 0);
  const delta = trade.maker_flag ? -quantity : quantity;
  const minuteTimeSec = Math.floor(trade.trade_time / 1000 / 60) * 60;

  const cvdCandle = ensureCvdMinuteCandle(minuteTimeSec);
  sessionState.cvdRunning += delta;
  cvdCandle.high = Math.max(cvdCandle.high, sessionState.cvdRunning);
  cvdCandle.low = Math.min(cvdCandle.low, sessionState.cvdRunning);
  cvdCandle.close = sessionState.cvdRunning;
  cvdCandle.hasTrades = true;

  const profileBucket = Math.floor(Number(trade.price));
  sessionState.volumeProfile.set(profileBucket, (sessionState.volumeProfile.get(profileBucket) || 0) + quantity);

  sessionState.lastProcessedTradeId = trade.trade_id;
  sessionState.hydration.processedTradeCount += 1;
  return true;
}

function normalizeAggTrade(trade) {
  return {
    trade_id: Number(trade.a),
    price: Number(trade.p),
    quantity: Number(trade.q),
    trade_time: Number(trade.T),
    maker_flag: Boolean(trade.m)
  };
}

async function backfillCurrentSessionTradesFromBinance(dayStartMs, nowMs) {
  let processed = 0;
  let fetched = 0;
  let cursorTradeId = null;

  while (true) {
    const search = new URLSearchParams({
      symbol: SYMBOL,
      limit: '1000',
      endTime: String(nowMs)
    });

    if (cursorTradeId === null) {
      search.set('startTime', String(dayStartMs));
    } else {
      search.set('fromId', String(cursorTradeId));
    }

    let response = null;
    let lastError = null;

    for (const baseUrl of BINANCE_REST_BASES) {
      const url = `${baseUrl}/aggTrades?${search.toString()}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        response = await fetch(url, { signal: controller.signal });
        if (response.ok) break;
        lastError = new Error(`HTTP ${response.status} from ${baseUrl}`);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response?.ok) {
      throw new Error(`Unable to backfill aggTrades from Binance endpoints: ${lastError?.message || 'unknown error'}`);
    }

    const batch = await response.json();
    if (!batch.length) break;

    fetched += batch.length;
    for (const item of batch) {
      const trade = normalizeAggTrade(item);
      if (trade.trade_time < dayStartMs || trade.trade_time > nowMs) continue;
      if (applyTradeToDerivedState(trade)) processed += 1;
    }

    const lastTradeId = Number(batch.at(-1)?.a);
    if (!Number.isFinite(lastTradeId)) break;
    cursorTradeId = lastTradeId + 1;

    if (batch.length < 1000) break;
  }

  return { fetched, processed };
}

function buildTimeScaffold(timeframe, sessionStartMs, nowMs) {
  const tfSeconds = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 }[timeframe] || 60;
  const startSec = Math.floor(sessionStartMs / 1000 / tfSeconds) * tfSeconds;
  const endSec = Math.floor(nowMs / 1000 / tfSeconds) * tfSeconds;
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
      isPlaceholder: true
    });
  }
  return scaffold;
}

function normalizeKline(row) {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    hasTrades: Number(row[8] || 0) > 0,
    isPlaceholder: false
  };
}

function mergeMinuteCandlesIntoSession(candles = []) {
  let merged = 0;
  candles.forEach((candle) => {
    if (!candle || !Number.isFinite(candle.time) || candle.time < Math.floor(sessionState.dayStartMs / 1000)) return;
    const existingIndex = sessionState.minuteCandleIndex.get(candle.time);
    if (existingIndex === undefined) {
      sessionState.minuteCandleIndex.set(candle.time, sessionState.minuteCandles.length);
      sessionState.minuteCandles.push(candle);
      merged += 1;
      return;
    }

    sessionState.minuteCandles[existingIndex] = candle;
  });

  sessionState.minuteCandles.sort((a, b) => a.time - b.time);
  sessionState.minuteCandleIndex = new Map(sessionState.minuteCandles.map((candle, index) => [candle.time, index]));
  return merged;
}

async function backfillCurrentSessionCandlesFromBinance(dayStartMs, nowMs) {
  const collected = [];
  const nowSec = Math.floor(nowMs / 1000) * 1000;
  let cursor = dayStartMs;

  while (cursor <= nowSec) {
    const search = new URLSearchParams({
      symbol: SYMBOL,
      interval: '1m',
      startTime: String(cursor),
      endTime: String(nowSec),
      limit: '1000'
    });

    let response = null;
    let lastError = null;

    for (const baseUrl of BINANCE_REST_BASES) {
      const url = `${baseUrl}/klines?${search.toString()}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        response = await fetch(url, { signal: controller.signal });
        if (response.ok) break;
        lastError = new Error(`HTTP ${response.status} from ${baseUrl}`);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response?.ok) {
      throw new Error(`Unable to backfill klines from Binance endpoints: ${lastError?.message || 'unknown error'}`);
    }

    const batch = await response.json();
    if (!batch.length) break;

    const normalized = batch.map(normalizeKline);
    collected.push(...normalized);

    const lastOpenMs = Number(batch.at(-1)?.[0] || cursor);
    const nextCursor = lastOpenMs + 60_000;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;

  }

  return collected;
}

async function initializeCurrentSession() {
  const nowMs = Date.now();
  const dayStartMs = getUtcDayStartMs(nowMs);
  ensureCurrentSession(nowMs);

  sessionState.hydration = {
    ...sessionState.hydration,
    status: 'running',
    source: 'binance-klines-1m+aggTrades',
    startedAt: Date.now(),
    finishedAt: null,
    lastError: null
  };

  const backfilledCandles = await backfillCurrentSessionCandlesFromBinance(dayStartMs, nowMs);
  const mergedCandleCount = mergeMinuteCandlesIntoSession(backfilledCandles);
  const tradeBackfill = await backfillCurrentSessionTradesFromBinance(dayStartMs, nowMs);

  sessionState.hydration = {
    ...sessionState.hydration,
    status: 'complete',
    finishedAt: Date.now(),
    fetchedCandleCount: backfilledCandles.length,
    fetchedTradeCount: tradeBackfill.fetched,
    mergedCandleCount,
    processedTradeCount: tradeBackfill.processed,
    lastError: null
  };

  console.info('[session/hydration] complete', {
    dayStartIso: new Date(dayStartMs).toISOString(),
    fetchedCandleCount: backfilledCandles.length,
    fetchedTradeCount: tradeBackfill.fetched,
    mergedCandleCount,
    processedTradeCount: tradeBackfill.processed,
    inMemoryMinuteCandleCount: sessionState.minuteCandles.length
  });
}

async function initializeCurrentSessionWithRetries() {
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      await initializeCurrentSession();
      console.log(`Current session initialized (attempt ${attempt}).`);
      return;
    } catch (error) {
      sessionState.hydration = {
        ...sessionState.hydration,
        status: 'failed',
        finishedAt: Date.now(),
        lastError: error?.message || String(error)
      };
      const retryDelayMs = Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5));
      console.error(`Session initialization failed (attempt ${attempt}). Retrying in ${retryDelayMs}ms.`, error);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

function buildSessionPayload(timeframe = '1m') {
  ensureCurrentSession();
  const nowMs = Date.now();
  const minuteCandles = [...sessionState.minuteCandles];
  const hydratedCandles = aggregateCandles(minuteCandles, timeframe);
  const scaffold = buildTimeScaffold(timeframe, sessionState.dayStartMs, nowMs);
  const hydratedByTime = new Map(hydratedCandles.map((bar) => [bar.time, { ...bar, isPlaceholder: false, state: 'hydrated' }]));
  const candles = scaffold.map((slot) => hydratedByTime.get(slot.time) || { ...slot, state: 'placeholder' });

  const vwap = computeSessionVwapFromCandles(aggregateCandles(minuteCandles, timeframe));
  const cvd = computeSessionCvdFromMinuteCandles(sessionState.cvdMinuteCandles, timeframe, {
    sessionStartMs: sessionState.dayStartMs,
    nowMs
  });

  const timeframeCounts = ['1m', '5m', '15m', '1h'].reduce((acc, tf) => {
    acc[tf] = aggregateCandles(minuteCandles, tf).length;
    return acc;
  }, {});

  const placeholderCount = candles.filter((bar) => bar.isPlaceholder).length;
  const hydratedCount = candles.length - placeholderCount;
  const realOhlcVariance = new Set(hydratedCandles.map((bar) => `${bar.open}:${bar.high}:${bar.low}:${bar.close}`)).size;

  return {
    symbol: SYMBOL,
    timeframe,
    sessionStartMs: sessionState.dayStartMs,
    sessionStartIso: new Date(sessionState.dayStartMs).toISOString(),
    candles,
    vwap,
    cvd,
    debug: {
      sessionTradeCount: sessionState.hydration.processedTradeCount,
      sessionCandleCount: candles.length,
      hydratedCandleCount: hydratedCount,
      placeholderCandleCount: placeholderCount,
      realOhlcVariance,
      timeframeCounts,
      startsAtUtcMidnight: sessionState.dayStartMs === getUtcDayStartMs(nowMs),
      hydration: sessionState.hydration,
      vwapCurrent: vwap.at(-1)?.value || null,
      vwapHasVariance: new Set(vwap.map((point) => point.value.toFixed(8))).size > 1,
      cvdCurrent: cvd.at(-1)?.close || null,
      cvdBarsWithTrades: cvd.filter((bar) => bar.hasTrades).length
    }
  };
}

const strategyUploadService = new StrategyUploadService({
  validationService: new StrategyValidationService(),
  parserService: new StrategyParser(),
  saveStrategyRecord: saveQuantStrategy
});

const strategyParser = new StrategyParser();
const executionEngine = new StrategyExecutionEngine();
const backtestRunner = new BacktestRunner({
  executionEngine,
  loadTrades: ({ symbol, startMs, endMs, limit }) => getTradesByRange(symbol, startMs, endMs, limit)
});

const backtestJobService = new BacktestJobService({
  backtestRunner,
  strategyParser,
  getStrategyById: getQuantStrategyById,
  createJob: createQuantBacktestJob,
  updateJob: updateQuantBacktestJob,
  completeJob: completeQuantBacktestJob,
  failJob: failQuantBacktestJob,
  saveResult: saveQuantBacktestResult,
  listJobProgress: listQuantJobProgress,
  getJobById: getQuantBacktestJobById
});

const liveStrategyRunner = createDefaultLivePaperRunner({
  executionEngine,
  loadTrades: ({ symbol, startMs, endMs, limit }) => getTradesByRange(symbol, startMs, endMs, limit),
  saveLiveState: ({ strategyId, status, stateJson }) => saveQuantLiveRun({ strategyId, status, stateJson }),
  getLiveState: () => null
});

const stream = new BinanceStreamService({
  symbol: SYMBOL,
  onTrade: (trade) => {
    latestTrade = trade;
    saveTrade(trade);
    ensureCurrentSession(trade.trade_time);

    applyTradeToDerivedState(trade);

    io.emit('trade', trade);
  },
  onBookTicker: (book) => {
    latestBook = book;
    saveBookTicker(book);
    io.emit('bookTicker', book);
  },
  onDepth: (depth) => {
    latestDepth = depth;
    io.emit('depth', depth);
  },
  onCandle: (candle) => {
    ensureCurrentSession(candle.time * 1000);
    mergeMinuteCandlesIntoSession([{ ...candle, hasTrades: true, isPlaceholder: false }]);
  }
});

server.listen(PORT, () => {
  console.log(`Kent Invest Crypto Tape Terminal listening on ${PORT}`);
});

initializeCurrentSessionWithRetries()
  .then(() => {
    stream.start();
  })
  .catch((error) => {
    console.error('Unexpected fatal error while initializing current session.', error);
  });

io.on('connection', (socket) => {
  const recent = getRecentTrades(SYMBOL, 500).reverse();
  socket.emit('bootstrap', {
    symbol: SYMBOL,
    trades: recent,
    latestTrade: latestTrade || recent.at(-1) || null,
    latestBook: latestBook || getLatestBook(SYMBOL) || null,
    depth: latestDepth,
    sessionStartMs: sessionState.dayStartMs
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, symbol: SYMBOL });
});

app.post('/api/quant/strategy/upload', (req, res) => {
  const { fileName, content } = req.body || {};
  const result = strategyUploadService.handleUpload({ fileName, content });
  if (result.status === 'invalid') return res.status(400).json(result);
  return res.json(result);
});

app.post('/api/quant/backtests', (req, res) => {
  const { strategyId, runConfig } = req.body || {};
  if (!strategyId || !runConfig) {
    return res.status(400).json({ error: 'strategyId and runConfig are required.' });
  }

  const job = backtestJobService.start({ strategyId, runConfig });
  return res.status(202).json({ jobId: job.id, job });
});

app.post('/api/quant/backtests/:jobId/cancel', (req, res) => {
  backtestJobService.cancel(Number(req.params.jobId));
  return res.json({ ok: true });
});

app.get('/api/quant/backtests/:jobId', (req, res) => {
  const jobId = Number(req.params.jobId);
  const job = getQuantBacktestJobById(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const progress = backtestJobService.getProgress(jobId);
  const result = getQuantResultByJobId(jobId);
  return res.json({ job, progress, result });
});

app.get('/api/quant/runs', (_req, res) => {
  const jobs = listQuantBacktestJobs(100).map((job) => ({
    ...job,
    summary: job.result_id ? JSON.parse(getQuantResultByJobId(job.id)?.summary_json || '{}') : null,
    strategyMetadata: job.metadata_json ? JSON.parse(job.metadata_json) : null
  }));
  return res.json({ runs: jobs });
});

app.get('/api/quant/live-metrics', (_req, res) => {
  const snapshot = liveStrategyRunner.tick() || liveStrategyRunner.getSnapshot();
  return res.json({ metrics: snapshot?.metrics || snapshot });
});

app.post('/api/quant/live/start', (req, res) => {
  const { strategyId, runConfig } = req.body || {};
  const strategyRecord = getQuantStrategyById(Number(strategyId));
  if (!strategyRecord) return res.status(404).json({ error: 'Strategy not found' });
  const parsed = strategyParser.parse(strategyRecord.raw_content);
  if (!parsed.valid) return res.status(400).json({ error: parsed.errors.join(', ') });
  const run = liveStrategyRunner.start({ strategyId: Number(strategyId), strategy: parsed.strategy, runConfig: runConfig || {} });
  return res.json({ run });
});

app.post('/api/quant/live/stop', (_req, res) => {
  return res.json({ run: liveStrategyRunner.stop() });
});

app.get('/api/session/snapshot', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  return res.json(buildSessionPayload(timeframe));
});

app.get('/api/candles', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const limit = Math.min(Number(req.query.limit || 1440), 2000);
  const payload = buildSessionPayload(timeframe);
  return res.json({ symbol: SYMBOL, timeframe, candles: payload.candles.slice(-limit), sessionStartMs: payload.sessionStartMs });
});

app.get('/api/indicators/vwap', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const payload = buildSessionPayload(timeframe);
  return res.json({ symbol: SYMBOL, timeframe, series: payload.vwap, sessionStartMs: payload.sessionStartMs });
});

app.get('/api/indicators/cvd', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const payload = buildSessionPayload(timeframe);
  return res.json({ symbol: SYMBOL, timeframe, candles: payload.cvd, sessionStartMs: payload.sessionStartMs });
});

app.get('/api/indicators/volume-profile', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const from = Number(req.query.from);
  const to = Number(req.query.to);

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return res.status(400).json({ error: 'from and to are required unix seconds' });
  }

  ensureCurrentSession();
  const profile = buildVolumeProfileFromMap(sessionState.volumeProfile);
  return res.json({ symbol: SYMBOL, timeframe, from, to, profile });
});

app.get('/api/session/debug', (_req, res) => {
  const snapshot = buildSessionPayload('1m');
  return res.json({
    symbol: SYMBOL,
    sessionStartMs: snapshot.sessionStartMs,
    sessionStartIso: snapshot.sessionStartIso,
    sessionTradeCount: snapshot.debug.sessionTradeCount,
    sessionCandleCount1m: snapshot.debug.sessionCandleCount,
    startsAtUtcMidnight: snapshot.debug.startsAtUtcMidnight,
    latestVwap: snapshot.debug.vwapCurrent,
    latestCvd: snapshot.debug.cvdCurrent,
    timeframeCounts: snapshot.debug.timeframeCounts,
    hydratedCandleCount: snapshot.debug.hydratedCandleCount,
    placeholderCandleCount: snapshot.debug.placeholderCandleCount,
    realOhlcVariance: snapshot.debug.realOhlcVariance,
    hydration: snapshot.debug.hydration,
    vwapHasVariance: snapshot.debug.vwapHasVariance,
    cvdBarsWithTrades: snapshot.debug.cvdBarsWithTrades
  });
});

app.get('/api/history/range', (_req, res) => {
  res.json({ symbol: SYMBOL, ...getTradeRange(SYMBOL) });
});

app.get('/api/history/trades', (req, res) => {
  const start = Number(req.query.start);
  const end = Number(req.query.end);
  const limit = Number(req.query.limit || 20000);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return res.status(400).json({ error: 'start and end query params are required' });
  }

  const trades = getTradesByRange(SYMBOL, start, end, limit);
  return res.json({ symbol: SYMBOL, count: trades.length, trades });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, '../client/dist');

app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});
