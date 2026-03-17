export class MetricsCalculator {
  calculate({ initialBalance, equitySeries, trades, openPosition, lastPrice }) {
    const closedTrades = trades.filter((trade) => trade.status === 'closed');
    const ending = equitySeries.at(-1)?.equity ?? initialBalance;
    const realizedPnl = closedTrades.reduce((acc, trade) => acc + trade.realizedPnl, 0);
    const unrealizedPnl = openPosition ? this.#calcUnrealized(openPosition, lastPrice) : 0;
    const wins = closedTrades.filter((trade) => trade.realizedPnl > 0);
    const losses = closedTrades.filter((trade) => trade.realizedPnl < 0);
    const grossProfit = wins.reduce((acc, trade) => acc + trade.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((acc, trade) => acc + trade.realizedPnl, 0));
    const returns = this.#seriesReturns(equitySeries);

    return {
      netPnl: round(ending + unrealizedPnl - initialBalance),
      returnPct: round(((ending + unrealizedPnl - initialBalance) / initialBalance) * 100),
      winRate: round((wins.length / Math.max(closedTrades.length, 1)) * 100),
      totalTrades: closedTrades.length,
      openTrades: openPosition ? 1 : 0,
      averageTradePnl: round(avg(closedTrades.map((x) => x.realizedPnl))),
      bestTrade: round(Math.max(...closedTrades.map((x) => x.realizedPnl), 0)),
      worstTrade: round(Math.min(...closedTrades.map((x) => x.realizedPnl), 0)),
      profitFactor: round(grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0),
      maxDrawdown: round(Math.max(...equitySeries.map((p) => p.drawdownPct || 0), 0)),
      sharpeRatio: round(this.#sharpe(returns)),
      expectancy: round(avg(closedTrades.map((x) => x.realizedPnl))),
      averageHoldingBars: round(avg(closedTrades.map((x) => x.holdingBars))),
      realizedPnl: round(realizedPnl),
      unrealizedPnl: round(unrealizedPnl),
      currentEquity: round(ending + unrealizedPnl)
    };
  }

  #calcUnrealized(position, markPrice) {
    if (!markPrice) return 0;
    if (position.side === 'long') return (markPrice - position.entryPrice) * position.quantity;
    return (position.entryPrice - markPrice) * position.quantity;
  }

  #seriesReturns(series) {
    const values = [];
    for (let i = 1; i < series.length; i += 1) {
      const prev = series[i - 1].equity;
      const cur = series[i].equity;
      values.push(prev ? (cur - prev) / prev : 0);
    }
    return values;
  }

  #sharpe(returns) {
    if (!returns.length) return 0;
    const mean = avg(returns);
    const variance = avg(returns.map((ret) => (ret - mean) ** 2));
    const std = Math.sqrt(variance);
    if (!std) return 0;
    return (mean / std) * Math.sqrt(returns.length);
  }
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value) {
  return Number((value || 0).toFixed(4));
}
