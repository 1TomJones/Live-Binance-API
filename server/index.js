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
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

let latestTrade = null;
let latestBook = null;
let latestDepth = null;
let candles = [];

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
    candles = initialCandles.slice(-400);
  },
  onCandle: (candle) => {
    const idx = candles.findIndex((c) => c.time === candle.time);
    if (idx >= 0) candles[idx] = candle;
    else candles.push(candle);
    candles = candles.slice(-400);
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
