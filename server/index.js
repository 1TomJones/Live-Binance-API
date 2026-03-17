import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { BinanceStreamService } from './binanceStream.js';
import {
  getLatestBook,
  getRecentTrades,
  getTradeRange,
  getTradesByRange,
  saveBookTicker,
  saveTrade
} from './db.js';

const PORT = process.env.PORT || 3000;
const SYMBOL = 'BTCUSDT';
const TIMEFRAME_TO_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

let latestTrade = null;
let latestBook = null;
let latestDepth = null;
let candles = [];

function aggregateCandles(sourceCandles, timeframe = '1m') {
  const bucketSeconds = TIMEFRAME_TO_SECONDS[timeframe] || TIMEFRAME_TO_SECONDS['1m'];
  if (bucketSeconds === 60) {
    return sourceCandles.map((c) => ({ ...c, volume: Number(c.volume || 0) }));
  }

  const buckets = new Map();
  sourceCandles.forEach((c) => {
    const bucketTime = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number(c.volume || 0)
      });
      return;
    }

    existing.high = Math.max(existing.high, c.high);
    existing.low = Math.min(existing.low, c.low);
    existing.close = c.close;
    existing.volume += Number(c.volume || 0);
  });

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function computeSessionVwap(candleData) {
  const sessionState = new Map();

  return candleData.map((candle) => {
    const candleDate = new Date(candle.time * 1000);
    const sessionKey = `${candleDate.getUTCFullYear()}-${candleDate.getUTCMonth()}-${candleDate.getUTCDate()}`;
    const state = sessionState.get(sessionKey) || { pv: 0, volume: 0 };
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = Number(candle.volume || 0);

    state.pv += typicalPrice * volume;
    state.volume += volume;
    sessionState.set(sessionKey, state);

    return {
      time: candle.time,
      value: state.volume > 0 ? state.pv / state.volume : candle.close
    };
  });
}

function computeVolumeProfileByDollar(trades) {
  if (!trades.length) return [];

  const buckets = new Map();
  trades.forEach((trade) => {
    const bucketPrice = Math.floor(Number(trade.price));
    const volume = Number(trade.quantity || 0);
    buckets.set(bucketPrice, (buckets.get(bucketPrice) || 0) + volume);
  });

  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const maxVolume = Math.max(...sorted.map(([, volume]) => volume), 1);

  return sorted.map(([price, volume]) => ({
    price,
    volume,
    ratio: volume / maxVolume
  }));
}

const stream = new BinanceStreamService({
  symbol: SYMBOL,
  onTrade: (trade) => {
    latestTrade = trade;
    saveTrade(trade);
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
  onCandleBootstrap: (initialCandles) => {
    candles = initialCandles.slice(-1200);
  },
  onCandle: (candle) => {
    const idx = candles.findIndex((c) => c.time === candle.time);
    if (idx >= 0) candles[idx] = candle;
    else candles.push(candle);
    candles = candles.slice(-1200);
    io.emit('candle', candle);
  }
});

stream.start();

io.on('connection', (socket) => {
  const recent = getRecentTrades(SYMBOL, 500).reverse();
  socket.emit('bootstrap', {
    symbol: SYMBOL,
    trades: recent,
    latestTrade: latestTrade || recent.at(-1) || null,
    latestBook: latestBook || getLatestBook(SYMBOL) || null,
    depth: latestDepth,
    candles
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, symbol: SYMBOL });
});

app.get('/api/candles', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const limit = Math.min(Number(req.query.limit || 400), 1200);
  const aggregated = aggregateCandles(candles, timeframe).slice(-limit);
  res.json({ symbol: SYMBOL, timeframe, candles: aggregated });
});

app.get('/api/indicators/vwap', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const limit = Math.min(Number(req.query.limit || 400), 1200);
  const series = computeSessionVwap(aggregateCandles(candles, timeframe).slice(-limit));
  res.json({ symbol: SYMBOL, timeframe, series });
});

app.get('/api/indicators/volume-profile', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const from = Number(req.query.from);
  const to = Number(req.query.to);

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return res.status(400).json({ error: 'from and to are required unix seconds' });
  }

  const tfSec = TIMEFRAME_TO_SECONDS[timeframe] || TIMEFRAME_TO_SECONDS['1m'];
  const alignedStart = Math.floor(from / tfSec) * tfSec * 1000;
  const alignedEnd = (Math.floor(to / tfSec) * tfSec + tfSec) * 1000 - 1;
  const trades = getTradesByRange(SYMBOL, alignedStart, alignedEnd, 200000);
  const profile = computeVolumeProfileByDollar(trades);
  return res.json({ symbol: SYMBOL, timeframe, from, to, profile });
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
