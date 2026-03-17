import React, { memo } from 'react';

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function TradeTapeComponent({ trades }) {
  return (
    <aside className="tape-panel">
      <div className="pane-title">LIVE TRADE TAPE</div>
      <div className="tape-columns">
        <span>Time</span><span>ID</span><span>Price</span><span>Qty</span><span>Notional</span><span>Side</span>
      </div>
      <div className="tape-scroll">
        {trades.map((t) => {
          const notional = t.price * t.quantity;
          return (
            <div key={`${t.trade_id}-${t.trade_time}`} className={`tape-row ${t.side}`}>
              <span>{fmtTime(t.trade_time)}</span>
              <span>{t.trade_id}</span>
              <span>{t.price.toFixed(2)}</span>
              <span>{t.quantity.toFixed(4)}</span>
              <span>{notional.toFixed(2)}</span>
              <span className="side-tag">{t.side.toUpperCase()}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export const TradeTape = memo(TradeTapeComponent);
