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

function computeVwap(candleData) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  return candleData.map((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = Number(candle.volume || 0);
    cumulativePV += typicalPrice * volume;
    cumulativeVolume += volume;
    return {
      time: candle.time,
      value: cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : candle.close
    };
  });
}

function computeCvd(trades, timeframe = '1m') {
  const bucketMs = (TIMEFRAME_TO_SECONDS[timeframe] || 60) * 1000;
  const grouped = new Map();

  trades.forEach((trade) => {
    const bucket = Math.floor(trade.trade_time / bucketMs) * bucketMs;
    const delta = trade.maker_flag ? -Number(trade.quantity) : Number(trade.quantity);
    grouped.set(bucket, (grouped.get(bucket) || 0) + delta);
  });

  let cumulative = 0;
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, delta]) => {
      cumulative += delta;
      return {
        time: Math.floor(bucket / 1000),
        delta,
        value: cumulative
      };
    });
}

function computeImbalanceSnapshot(depth, levels = 10) {
  if (!depth?.bids?.length || !depth?.asks?.length) return null;

  const bids = depth.bids.slice(0, levels);
  const asks = depth.asks.slice(0, levels);
  const bidVolume = bids.reduce((sum, level) => sum + Number(level.quantity || 0), 0);
  const askVolume = asks.reduce((sum, level) => sum + Number(level.quantity || 0), 0);
  const total = bidVolume + askVolume;

  return {
    ts: depth.ts,
    levels,
    bidVolume,
    askVolume,
    value: total > 0 ? (bidVolume - askVolume) / total : 0
  };
}

function computeVolumeProfile(trades, bins = 24) {
  if (!trades.length) return [];

  const min = Math.min(...trades.map((t) => t.price));
  const max = Math.max(...trades.map((t) => t.price));
  const span = Math.max(max - min, 0.01);
  const binSize = span / bins;
  const volumes = Array.from({ length: bins }, () => 0);

  trades.forEach((trade) => {
    const idx = Math.min(Math.floor((trade.price - min) / binSize), bins - 1);
    volumes[Math.max(0, idx)] += Number(trade.quantity || 0);
  });

  const maxVol = Math.max(...volumes, 1);
  return volumes.map((volume, idx) => ({
    priceStart: min + idx * binSize,
    priceEnd: min + (idx + 1) * binSize,
    volume,
    ratio: volume / maxVol
  }));
}

function computeLiquidityHeatmap(depth, levels = 50) {
  if (!depth?.bids?.length || !depth?.asks?.length) return [];

  const allLevels = [
    ...depth.bids.slice(0, levels).map((row) => ({ side: 'bid', price: row.price, quantity: row.quantity })),
    ...depth.asks.slice(0, levels).map((row) => ({ side: 'ask', price: row.price, quantity: row.quantity }))
  ];

  const maxQty = Math.max(...allLevels.map((row) => Number(row.quantity || 0)), 1);
  return allLevels.map((row) => ({
    ...row,
    intensity: Number(row.quantity || 0) / maxQty
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
  const series = computeVwap(aggregateCandles(candles, timeframe).slice(-limit));
  res.json({ symbol: SYMBOL, timeframe, series });
});

app.get('/api/indicators/cvd', (req, res) => {
  const timeframe = req.query.timeframe || '1m';
  const trades = getRecentTrades(SYMBOL, 12000).reverse();
  const series = computeCvd(trades, timeframe).slice(-600);
  res.json({ symbol: SYMBOL, timeframe, series });
});

app.get('/api/indicators/imbalance', (req, res) => {
  const levels = Math.min(Math.max(Number(req.query.levels || 10), 1), 50);
  const snapshot = computeImbalanceSnapshot(latestDepth, levels);
  res.json({ symbol: SYMBOL, snapshot });
});

app.get('/api/indicators/volume-profile', (req, res) => {
  const bins = Math.min(Math.max(Number(req.query.bins || 24), 12), 80);
  const trades = getRecentTrades(SYMBOL, 6000);
  const profile = computeVolumeProfile(trades, bins);
  res.json({ symbol: SYMBOL, bins, profile });
});

app.get('/api/indicators/liquidity-heatmap', (req, res) => {
  const levels = Math.min(Math.max(Number(req.query.levels || 40), 5), 100);
  const heatmap = computeLiquidityHeatmap(latestDepth, levels);
  res.json({ symbol: SYMBOL, levels, heatmap });
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
