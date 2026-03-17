import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { TopStatusBar } from '../components/TopStatusBar.jsx';
import { TradeTape } from '../components/TradeTape.jsx';
import { OrderBookLadder } from '../components/OrderBookLadder.jsx';
import { CandlestickChart } from '../components/CandlestickChart.jsx';

const socket = io();

export function LiveTerminalPage() {
  const [trades, setTrades] = useState([]);
  const [book, setBook] = useState(null);
  const [depth, setDepth] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('bootstrap', (payload) => {
      setTrades(payload.trades || []);
      setBook(payload.latestBook || null);
      setDepth(payload.depth || null);
    });

    socket.on('trade', (trade) => {
      setTrades((prev) => [trade, ...prev].slice(0, 900));
    });

    socket.on('bookTicker', (nextBook) => {
      setBook(nextBook);
    });

    socket.on('depth', (nextDepth) => {
      setDepth(nextDepth);
    });

    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('bootstrap');
      socket.off('trade');
      socket.off('bookTicker');
      socket.off('depth');
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  const stats = useMemo(() => {
    const prices = trades.map((t) => t.price);
    const first = prices.at(-1);
    const last = prices[0];
    return {
      last,
      high: prices.length ? Math.max(...prices) : null,
      low: prices.length ? Math.min(...prices) : null,
      movePct: first && last ? ((last - first) / first) * 100 : null
    };
  }, [trades]);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await rootRef.current?.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  };

  return (
    <main className="terminal-root" ref={rootRef}>
      <TopStatusBar
        mode="LIVE"
        symbol="BTCUSDT"
        lastPrice={stats.last}
        high={stats.high}
        low={stats.low}
        movePct={stats.movePct}
        bid={depth?.bestBid?.price || book?.bid_price}
        ask={depth?.bestAsk?.price || book?.ask_price}
        spread={depth?.spread || (book ? book.ask_price - book.bid_price : null)}
        connected={connected}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />
      <section className="terminal-main">
        <OrderBookLadder depth={depth} />
        <div className="chart-region">
          <CandlestickChart symbol="BTCUSDT" depth={depth} />
        </div>
        <TradeTape trades={trades} />
      </section>
      <footer className="terminal-footer">Binance streams: BTCUSDT@depth@100ms · @trade · @kline_1m · multi-timeframe + order-flow indicators</footer>
    </main>
  );
}
