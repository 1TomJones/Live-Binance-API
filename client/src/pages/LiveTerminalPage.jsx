import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { TopStatusBar } from '../components/TopStatusBar.jsx';
import { TickChart } from '../components/TickChart.jsx';
import { TradeTape } from '../components/TradeTape.jsx';

const socket = io();

export function LiveTerminalPage() {
  const [trades, setTrades] = useState([]);
  const [book, setBook] = useState(null);

  useEffect(() => {
    socket.on('bootstrap', (payload) => {
      setTrades(payload.trades || []);
      setBook(payload.latestBook || null);
    });

    socket.on('trade', (trade) => {
      setTrades((prev) => [trade, ...prev].slice(0, 800));
    });

    socket.on('bookTicker', (nextBook) => {
      setBook(nextBook);
    });

    return () => {
      socket.off('bootstrap');
      socket.off('trade');
      socket.off('bookTicker');
    };
  }, []);

  const stats = useMemo(() => {
    const chartSeries = [...trades].reverse();
    const prices = chartSeries.map((t) => t.price);
    const first = prices[0];
    const last = prices.at(-1);
    return {
      last,
      high: prices.length ? Math.max(...prices) : null,
      low: prices.length ? Math.min(...prices) : null,
      movePct: first && last ? ((last - first) / first) * 100 : null,
      chartSeries
    };
  }, [trades]);

  return (
    <main className="terminal-root">
      <TopStatusBar
        mode="LIVE"
        lastPrice={stats.last}
        high={stats.high}
        low={stats.low}
        movePct={stats.movePct}
        bid={book?.bid_price}
        ask={book?.ask_price}
        spread={book ? book.ask_price - book.bid_price : null}
      />
      <section className="terminal-main">
        <div className="chart-region">
          <TickChart trades={stats.chartSeries} />
        </div>
        <TradeTape trades={trades} />
      </section>
      <footer className="terminal-footer">Streaming from Binance public trade flow (BTCUSDT@trade + @bookTicker)</footer>
    </main>
  );
}
