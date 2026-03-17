import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.resolve('data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'terminal.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    trade_time INTEGER NOT NULL,
    maker_flag INTEGER NOT NULL,
    side TEXT NOT NULL,
    ingest_ts INTEGER NOT NULL,
    UNIQUE(symbol, trade_id)
  );

  CREATE TABLE IF NOT EXISTS book_ticker (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    bid_price REAL NOT NULL,
    bid_qty REAL NOT NULL,
    ask_price REAL NOT NULL,
    ask_qty REAL NOT NULL,
    ts INTEGER NOT NULL
  );
`);

const insertTradeStmt = db.prepare(`
  INSERT OR IGNORE INTO trades (
    trade_id, symbol, price, quantity, trade_time, maker_flag, side, ingest_ts
  ) VALUES (
    @trade_id, @symbol, @price, @quantity, @trade_time, @maker_flag, @side, @ingest_ts
  )
`);

const insertBookStmt = db.prepare(`
  INSERT INTO book_ticker (
    symbol, bid_price, bid_qty, ask_price, ask_qty, ts
  ) VALUES (
    @symbol, @bid_price, @bid_qty, @ask_price, @ask_qty, @ts
  )
`);

export function saveTrade(trade) {
  insertTradeStmt.run(trade);
}

export function saveBookTicker(book) {
  insertBookStmt.run(book);
}

export function getRecentTrades(symbol, limit = 500) {
  return db.prepare(`
    SELECT trade_id, symbol, price, quantity, trade_time, maker_flag, side, ingest_ts
    FROM trades
    WHERE symbol = ?
    ORDER BY trade_time DESC
    LIMIT ?
  `).all(symbol, limit);
}

export function getTradeRange(symbol) {
  const row = db.prepare(`
    SELECT MIN(trade_time) as minTime, MAX(trade_time) as maxTime, COUNT(*) as count
    FROM trades
    WHERE symbol = ?
  `).get(symbol);
  return row;
}

export function getTradesByRange(symbol, start, end, limit = 20000) {
  return db.prepare(`
    SELECT trade_id, symbol, price, quantity, trade_time, maker_flag, side, ingest_ts
    FROM trades
    WHERE symbol = ?
      AND trade_time BETWEEN ? AND ?
    ORDER BY trade_time ASC
    LIMIT ?
  `).all(symbol, start, end, limit);
}

export function getLatestBook(symbol) {
  return db.prepare(`
    SELECT symbol, bid_price, bid_qty, ask_price, ask_qty, ts
    FROM book_ticker
    WHERE symbol = ?
    ORDER BY ts DESC
    LIMIT 1
  `).get(symbol);
}
