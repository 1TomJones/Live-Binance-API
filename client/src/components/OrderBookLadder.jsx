import React, { memo, useMemo } from 'react';

function fmtPrice(v) {
  return Number(v).toFixed(2);
}

function fmtQty(v) {
  return Number(v).toFixed(4);
}

function OrderBookLadderComponent({ depth }) {
  const asks = depth?.asks || [];
  const bids = depth?.bids || [];

  const maxCum = useMemo(() => {
    const askMax = asks.at(-1)?.cumulative || 0;
    const bidMax = bids.at(-1)?.cumulative || 0;
    return Math.max(askMax, bidMax, 1);
  }, [asks, bids]);

  return (
    <aside className="book-panel">
      <div className="pane-title">ORDER BOOK · DEPTH 100</div>
      <div className="book-columns"><span>Price</span><span>Size</span><span>Cum</span></div>
      <div className="book-scroll">
        {asks.slice().reverse().map((level) => (
          <div key={`a-${level.price}`} className="book-row ask">
            <span className="depth-bg" style={{ width: `${(level.cumulative / maxCum) * 100}%` }} />
            <span className="price">{fmtPrice(level.price)}</span>
            <span>{fmtQty(level.quantity)}</span>
            <span>{fmtQty(level.cumulative)}</span>
          </div>
        ))}
        <div className="spread-row">
          <span>Spread</span>
          <span>{depth?.spread ? depth.spread.toFixed(2) : '--'}</span>
          <span>{depth?.bestBid && depth?.bestAsk ? `${fmtPrice(depth.bestBid.price)} / ${fmtPrice(depth.bestAsk.price)}` : '--'}</span>
        </div>
        {bids.map((level) => (
          <div key={`b-${level.price}`} className="book-row bid">
            <span className="depth-bg" style={{ width: `${(level.cumulative / maxCum) * 100}%` }} />
            <span className="price">{fmtPrice(level.price)}</span>
            <span>{fmtQty(level.quantity)}</span>
            <span>{fmtQty(level.cumulative)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

export const OrderBookLadder = memo(OrderBookLadderComponent);
