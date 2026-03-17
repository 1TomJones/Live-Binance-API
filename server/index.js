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
  saveQuantStrategy,
  saveTrade,
  saveTradesBatch,
  updateQuantBacktestJob
} from './db.js';
import { BacktestJobService, StrategyExecutionService } from './quant/backtestJobService.js';
import { LiveStrategyRunner } from './quant/liveMetricsStore.js';
import { StrategyParserService, StrategyUploadService, StrategyValidationService } from './quant/strategyServices.js';
import {
  buildCandlesFromTrades,
  buildVolumeProfileByDollar,
  computeSessionCvdFromTrades,
  computeSessionVwapFromTrades,
  getUtcDayStartMs,
  timeframeToSeconds
} from './sessionAnalytics.js';

const PORT = process.env.PORT || 3000;
const SYMBOL = 'BTCUSDT';
const BINANCE_REST = 'https://api.binance.com/api/v3';

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
    const url = `${BINANCE_REST}/aggTrades?symbol=${SYMBOL}&startTime=${cursor}&endTime=${nowMs}&limit=1000`;
    const response = await fetch(url);
    if (!response.ok) break;

    const batch = await response.json();
    if (!batch.length) break;

    const normalized = batch.map(normalizeAggTrade);
    collected.push(...normalized);

    const lastTs = normalized.at(-1)?.trade_time || cursor;
    if (lastTs <= cursor) break;
    cursor = lastTs + 1;

    if (collected.length > 300000) break;
  }

  return collected;
}

async function initializeCurrentSession() {
  const nowMs = Date.now();
  const dayStartMs = getUtcDayStartMs(nowMs);

  const dbTrades = getTradesByRange(SYMBOL, dayStartMs, nowMs, 350000);
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

function buildSessionPayload(timeframe = '1m') {
  ensureCurrentSession();
  const candles = buildCandlesFromTrades(sessionState.trades, timeframe);
  const vwap = computeSessionVwapFromTrades(sessionState.trades, timeframe);
  const cvd = computeSessionCvdFromTrades(sessionState.trades, timeframe);

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
      startsAtUtcMidnight: sessionState.dayStartMs === getUtcDayStartMs(),
      vwapCurrent: vwap.at(-1)?.value || null,
      cvdCurrent: cvd.at(-1)?.close || null
    }
  };
}

const strategyUploadService = new StrategyUploadService({
  validationService: new StrategyValidationService(),
  parserService: new StrategyParserService(),
  saveStrategyRecord: saveQuantStrategy
});

const backtestJobService = new BacktestJobService({
  executionService: new StrategyExecutionService(),
  createJob: createQuantBacktestJob,
  updateJob: updateQuantBacktestJob,
  completeJob: completeQuantBacktestJob,
  failJob: failQuantBacktestJob,
  saveResult: saveQuantBacktestResult,
  listJobProgress: listQuantJobProgress,
  getJobById: getQuantBacktestJobById
});

const liveStrategyRunner = new LiveStrategyRunner();

const stream = new BinanceStreamService({
  symbol: SYMBOL,
  onTrade: (trade) => {
    latestTrade = trade;
    saveTrade(trade);
    ensureCurrentSession(trade.trade_time);

    if (!sessionState.tradeIds.has(trade.trade_id) && trade.trade_time >= sessionState.dayStartMs) {
      sessionState.tradeIds.add(trade.trade_id);
      sessionState.trades.push(trade);
      sessionState.trades.sort((a, b) => a.trade_time - b.trade_time || a.trade_id - b.trade_id);
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

await initializeCurrentSession();
stream.start();

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
  return res.json({ metrics: liveStrategyRunner.getSnapshot() });
});

app.post('/api/quant/live-metrics', (req, res) => {
  return res.json({ metrics: liveStrategyRunner.update(req.body || {}) });
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
  const tfSec = timeframeToSeconds(timeframe);
  const alignedStartMs = Math.floor(from / tfSec) * tfSec * 1000;
  const alignedEndMs = (Math.floor(to / tfSec) * tfSec + tfSec) * 1000 - 1;
  const trades = sessionState.trades.filter((trade) => trade.trade_time >= alignedStartMs && trade.trade_time <= alignedEndMs);
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
    latestCvd: snapshot.debug.cvdCurrent
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

server.listen(PORT, () => {
  console.log(`Kent Invest Crypto Tape Terminal listening on ${PORT}`);
});
