import WebSocket from 'ws';

const WS_BASE = 'wss://data-stream.binance.vision/ws';

export class BinanceStreamService {
  constructor({ symbol = 'btcusdt', onTrade, onBookTicker }) {
    this.symbol = symbol.toLowerCase();
    this.onTrade = onTrade;
    this.onBookTicker = onBookTicker;
    this.tradeSocket = null;
    this.bookSocket = null;
    this.tradeReconnectTimer = null;
    this.bookReconnectTimer = null;
  }

  start() {
    this.connectTrade();
    this.connectBookTicker();
  }

  stop() {
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.bookReconnectTimer);
    this.tradeSocket?.close();
    this.bookSocket?.close();
  }

  connectTrade() {
    const url = `${WS_BASE}/${this.symbol}@trade`;
    this.tradeSocket = new WebSocket(url);

    this.tradeSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const trade = {
        trade_id: msg.t,
        symbol: msg.s,
        price: Number(msg.p),
        quantity: Number(msg.q),
        trade_time: msg.T,
        maker_flag: msg.m ? 1 : 0,
        side: msg.m ? 'sell' : 'buy',
        ingest_ts: Date.now()
      };
      this.onTrade?.(trade);
    });

    this.tradeSocket.on('close', () => this.scheduleReconnect('trade'));
    this.tradeSocket.on('error', () => this.tradeSocket?.close());
  }

  connectBookTicker() {
    const url = `${WS_BASE}/${this.symbol}@bookTicker`;
    this.bookSocket = new WebSocket(url);

    this.bookSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const book = {
        symbol: msg.s,
        bid_price: Number(msg.b),
        bid_qty: Number(msg.B),
        ask_price: Number(msg.a),
        ask_qty: Number(msg.A),
        ts: msg.T || Date.now()
      };
      this.onBookTicker?.(book);
    });

    this.bookSocket.on('close', () => this.scheduleReconnect('book'));
    this.bookSocket.on('error', () => this.bookSocket?.close());
  }

  scheduleReconnect(type) {
    if (type === 'trade') {
      clearTimeout(this.tradeReconnectTimer);
      this.tradeReconnectTimer = setTimeout(() => this.connectTrade(), 1500);
    }

    if (type === 'book') {
      clearTimeout(this.bookReconnectTimer);
      this.bookReconnectTimer = setTimeout(() => this.connectBookTicker(), 1500);
    }
  }
}
