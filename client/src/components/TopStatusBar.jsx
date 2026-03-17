import React from 'react';

export function TopStatusBar({ mode, lastPrice, high, low, movePct, bid, ask, spread }) {
  return (
    <header className="top-bar">
      <div className="brand">KENT INVEST · CRYPTO TAPE TERMINAL</div>
      <div className="market-metrics">
        <span>{mode}</span>
        <span>LAST {lastPrice?.toFixed(2) ?? '--'}</span>
        <span>HIGH {high?.toFixed(2) ?? '--'}</span>
        <span>LOW {low?.toFixed(2) ?? '--'}</span>
        <span className={movePct >= 0 ? 'up' : 'down'}>MOVE {Number.isFinite(movePct) ? `${movePct.toFixed(2)}%` : '--'}</span>
        <span>BID {bid?.toFixed(2) ?? '--'}</span>
        <span>ASK {ask?.toFixed(2) ?? '--'}</span>
        <span>SPR {spread?.toFixed(2) ?? '--'}</span>
      </div>
      <div className="route-links">
        <a href="/">Live</a>
        <a href="/replay">Replay</a>
      </div>
    </header>
  );
}
