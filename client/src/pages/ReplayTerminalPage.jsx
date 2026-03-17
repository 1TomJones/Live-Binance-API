import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TopStatusBar } from '../components/TopStatusBar.jsx';
import { TickChart } from '../components/TickChart.jsx';
import { TradeTape } from '../components/TradeTape.jsx';

export function ReplayTerminalPage() {
  const [range, setRange] = useState({ minTime: null, maxTime: null, count: 0 });
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [allTrades, setAllTrades] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [speed, setSpeed] = useState(4);
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    fetch('/api/history/range').then((r) => r.json()).then((data) => {
      setRange(data);
      if (data.minTime && data.maxTime) {
        setStart(new Date(data.minTime).toISOString().slice(0, 16));
        setEnd(new Date(data.maxTime).toISOString().slice(0, 16));
      }
    });
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setInterval(() => {
      setCursor((prev) => {
        const next = Math.min(prev + 1, allTrades.length);
        if (next >= allTrades.length) setIsPlaying(false);
        return next;
      });
    }, Math.max(10, 240 / speed));
    return () => clearInterval(timerRef.current);
  }, [isPlaying, allTrades.length, speed]);

  const loadRange = async () => {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const response = await fetch(`/api/history/trades?start=${startMs}&end=${endMs}&limit=20000`);
    const data = await response.json();
    setAllTrades(data.trades || []);
    setCursor(0);
    setIsPlaying(false);
  };

  const visible = useMemo(() => allTrades.slice(0, cursor), [allTrades, cursor]);
  const latestFirstTape = useMemo(() => [...visible].reverse().slice(0, 800), [visible]);
  const prices = visible.map((t) => t.price);
  const first = prices[0];
  const last = prices.at(-1);

  return (
    <main className="terminal-root">
      <TopStatusBar
        mode="REPLAY"
        lastPrice={last}
        high={prices.length ? Math.max(...prices) : null}
        low={prices.length ? Math.min(...prices) : null}
        movePct={first && last ? ((last - first) / first) * 100 : null}
      />
      <section className="terminal-main">
        <div className="chart-region">
          <div className="replay-controls">
            <label>Start <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label>End <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            <button onClick={loadRange}>Load</button>
            <button onClick={() => setIsPlaying(true)} disabled={!allTrades.length}>Play</button>
            <button onClick={() => setIsPlaying(false)}>Pause</button>
            <button onClick={() => { setCursor(0); setIsPlaying(false); }}>Reset</button>
            <label>Speed
              <input type="range" min="1" max="20" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
              {speed}x
            </label>
            <span>{cursor}/{allTrades.length} ticks</span>
            <span>{range.count || 0} stored</span>
          </div>
          <TickChart trades={visible} />
        </div>
        <TradeTape trades={latestFirstTape} />
      </section>
      <footer className="terminal-footer">Replay from local SQLite trade archive</footer>
    </main>
  );
}
