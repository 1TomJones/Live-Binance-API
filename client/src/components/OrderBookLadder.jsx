import React, { memo, useMemo, useState } from 'react';

function fmtPrice(v) {
  return Number(v).toFixed(2);
}

function fmtQty(v) {
  return Number(v).toFixed(4);
}

function fmtNotional(v) {
  return Number(v).toFixed(2);
}

function buildAggregatedBands(depth) {
  const bestAsk = depth?.bestAsk?.price;
  const bestBid = depth?.bestBid?.price;
  if (!Number.isFinite(bestAsk) || !Number.isFinite(bestBid)) {
    return { asks: [], bids: [] };
  }

  const bandsPerSide = 35;
  const askStart = Math.floor(bestAsk);
  const bidStart = Math.floor(bestBid);

  const askMap = new Map();
  (depth?.asks || []).forEach((level) => {
    const band = Math.floor(level.price);
    askMap.set(band, (askMap.get(band) || 0) + Number(level.quantity || 0));
  });

  const bidMap = new Map();
  (depth?.bids || []).forEach((level) => {
    const band = Math.floor(level.price);
    bidMap.set(band, (bidMap.get(band) || 0) + Number(level.quantity || 0));
  });

  const asks = Array.from({ length: bandsPerSide }, (_, idx) => {
    const price = askStart + idx;
    return { price, quantity: askMap.get(price) || 0 };
  });

  const bids = Array.from({ length: bandsPerSide }, (_, idx) => {
    const price = bidStart - idx;
    return { price, quantity: bidMap.get(price) || 0 };
  });

  return { asks, bids };
}

function OrderBookLadderComponent({ depth }) {
  const [mode, setMode] = useState('raw');
  const asks = depth?.asks || [];
  const bids = depth?.bids || [];

  const display = useMemo(() => {
    if (mode === 'raw') {
      return {
        asks: asks.slice(0, 35),
        bids: bids.slice(0, 35)
      };
    }
    return buildAggregatedBands(depth);
  }, [mode, asks, bids, depth]);

  const maxSize = useMemo(() => {
    const values = [...display.asks, ...display.bids].map((level) => Number(level.quantity || 0));
    return Math.max(...values, 1);
  }, [display]);

  const totalVisibleAsks = useMemo(
    () => display.asks.reduce((sum, level) => sum + Number(level.quantity || 0), 0),
    [display.asks]
  );

  const totalVisibleBids = useMemo(
    () => display.bids.reduce((sum, level) => sum + Number(level.quantity || 0), 0),
    [display.bids]
  );

  return (
    <aside className="book-panel">
      <div className="pane-title">ORDER BOOK · DEPTH 100</div>
      <div className="dom-summary">
        <span className="sell">Sell Limits: {fmtQty(totalVisibleAsks)}</span>
        <span className="buy">Buy Limits: {fmtQty(totalVisibleBids)}</span>
      </div>
      <div className="dom-mode-toggle">
        <button type="button" className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>Raw Levels</button>
        <button type="button" className={mode === 'agg' ? 'active' : ''} onClick={() => setMode('agg')}>$1 Aggregation</button>
      </div>
      <div className="book-columns"><span>Price</span><span>Size</span><span>Notional</span></div>
      <div className="book-scroll">
        {display.asks.slice().reverse().map((level) => (
          <div key={`a-${level.price}`} className="book-row ask">
            <span className="depth-bg" style={{ width: `${(Number(level.quantity || 0) / maxSize) * 100}%` }} />
            <span className="price">{fmtPrice(level.price)}</span>
            <span>{fmtQty(level.quantity)}</span>
            <span>{fmtNotional(level.price * level.quantity)}</span>
          </div>
        ))}
        <div className="spread-row">
          <span>Spread</span>
          <span>{depth?.spread ? depth.spread.toFixed(2) : '--'}</span>
          <span>{depth?.bestBid && depth?.bestAsk ? `${fmtPrice(depth.bestBid.price)} / ${fmtPrice(depth.bestAsk.price)}` : '--'}</span>
        </div>
        {display.bids.map((level) => (
          <div key={`b-${level.price}`} className="book-row bid">
            <span className="depth-bg" style={{ width: `${(Number(level.quantity || 0) / maxSize) * 100}%` }} />
            <span className="price">{fmtPrice(level.price)}</span>
            <span>{fmtQty(level.quantity)}</span>
            <span>{fmtNotional(level.price * level.quantity)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

export const OrderBookLadder = memo(OrderBookLadderComponent);
