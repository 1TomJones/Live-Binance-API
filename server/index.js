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
  getTradesCountByRange,
  listQuantBacktestJobs,
  listQuantJobProgress,
  saveBookTicker,
  saveQuantBacktestResult,
  saveQuantLiveRun,
  saveQuantStrategy,
  saveTrade,
  saveTradesBatch,
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
  buildVolumeProfileByDollar,
  computeSessionCvdFromTrades,
  computeSessionVwapFromTrades,
  aggregateCandles,
  buildCanonicalMinuteCandles,
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
let sessionState = {
  dayStartMs: getUtcDayStartMs(),
  trades: [],
  tradeIds: new Set()
};

function ensureCurrentSession(nowMs = Date.now()) {
  const currentDayStart = getUtcDayStartMs(nowMs);
  if (sessionState.dayStartMs !== currentDayStart) {
    sessionState = { dayStartMs: currentDayStart, trades: [], tradeIds: new Set() };
  }
}

function normalizeAggTrade(trade) {
  return {
    trade_id: Number(trade.l),
    symbol: SYMBOL,
    price: Number(trade.p),
    quantity: Number(trade.q),
    trade_time: Number(trade.T),
    maker_flag: trade.m ? 1 : 0,
    side: trade.m ? 'sell' : 'buy',
    ingest_ts: Date.now()
  };
}

async function backfillCurrentSessionFromBinance(dayStartMs, nowMs) {
  const collected = [];
  let cursor = dayStartMs;

  while (cursor <= nowMs) {
    const search = new URLSearchParams({
      symbol: SYMBOL,
      startTime: String(cursor),
      endTime: String(nowMs),
      limit: '1000'
    });

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

    const normalized = batch.map(normalizeAggTrade);
    collected.push(...normalized);

    const lastTs = normalized.at(-1)?.trade_time || cursor;
    if (lastTs <= cursor) break;
    cursor = lastTs + 1;

  }

  return collected;
}

async function initializeCurrentSession() {
  const nowMs = Date.now();
  const dayStartMs = getUtcDayStartMs(nowMs);

  const dbTrades = getTradesByRange(SYMBOL, dayStartMs, nowMs, null);
  let sessionTrades = dbTrades;

  const presentCount = getTradesCountByRange(SYMBOL, dayStartMs, nowMs);
  if (presentCount < 5000) {
    const backfilled = await backfillCurrentSessionFromBinance(dayStartMs, nowMs);
    saveTradesBatch(backfilled);
    sessionTrades = [...dbTrades, ...backfilled];
  }

  const sortedUnique = [...sessionTrades]
    .sort((a, b) => a.trade_time - b.trade_time || a.trade_id - b.trade_id)
    .filter((trade, index, arr) => index === 0 || trade.trade_id !== arr[index - 1].trade_id);

  sessionState = {
    dayStartMs,
    trades: sortedUnique,
    tradeIds: new Set(sortedUnique.map((trade) => trade.trade_id))
  };
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
      const retryDelayMs = Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5));
      console.error(`Session initialization failed (attempt ${attempt}). Retrying in ${retryDelayMs}ms.`, error);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

function buildSessionPayload(timeframe = '1m') {
  ensureCurrentSession();
  const nowMs = Date.now();
  const minuteCandles = buildCanonicalMinuteCandles(sessionState.trades, {
    sessionStartMs: sessionState.dayStartMs,
    nowMs
  });
  const candles = aggregateCandles(minuteCandles, timeframe);
  const vwap = computeSessionVwapFromTrades(sessionState.trades, timeframe, {
    sessionStartMs: sessionState.dayStartMs,
    nowMs
  });
  const cvd = computeSessionCvdFromTrades(sessionState.trades, timeframe, {
    sessionStartMs: sessionState.dayStartMs,
    nowMs
  });

  const timeframeCounts = ['1m', '5m', '15m', '1h'].reduce((acc, tf) => {
    acc[tf] = aggregateCandles(minuteCandles, tf).length;
    return acc;
  }, {});

  return {
    symbol: SYMBOL,
    timeframe,
    sessionStartMs: sessionState.dayStartMs,
    sessionStartIso: new Date(sessionState.dayStartMs).toISOString(),
    candles,
    vwap,
    cvd,
    debug: {
      sessionTradeCount: sessionState.trades.length,
      sessionCandleCount: candles.length,
      timeframeCounts,
      startsAtUtcMidnight: sessionState.dayStartMs === getUtcDayStartMs(nowMs),
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

    if (!sessionState.tradeIds.has(trade.trade_id) && trade.trade_time >= sessionState.dayStartMs) {
      sessionState.tradeIds.add(trade.trade_id);
      const lastTrade = sessionState.trades.at(-1);
      if (!lastTrade || trade.trade_time > lastTrade.trade_time || (trade.trade_time === lastTrade.trade_time && trade.trade_id > lastTrade.trade_id)) {
        sessionState.trades.push(trade);
      } else {
        sessionState.trades.push(trade);
        sessionState.trades.sort((a, b) => a.trade_time - b.trade_time || a.trade_id - b.trade_id);
      }
    }

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
  }
});

server.listen(PORT, () => {
  console.log(`Kent Invest Crypto Tape Terminal listening on ${PORT}`);
});

stream.start();
initializeCurrentSessionWithRetries().catch((error) => {
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
  const fromMs = Math.floor(from * 1000);
  const toMs = Math.ceil(to * 1000);
  const trades = sessionState.trades.filter((trade) => trade.trade_time >= fromMs && trade.trade_time <= toMs);
  const profile = buildVolumeProfileByDollar(trades);
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
