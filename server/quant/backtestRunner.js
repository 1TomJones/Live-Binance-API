import { buildCandlesFromTrades, computeSessionCvdFromTrades, computeSessionVwapFromTrades, timeframeToSeconds } from '../sessionAnalytics.js';
import { StrategyExecutionEngine } from './strategyExecutionEngine.js';

export class BacktestRunner {
  constructor({ executionEngine = new StrategyExecutionEngine(), loadTrades }) {
    this.executionEngine = executionEngine;
    this.loadTrades = loadTrades;
  }

  run({ strategy, runConfig, progressCallback }) {
    const startMs = runConfig.startDate ? Date.parse(runConfig.startDate) : 0;
    const endMs = runConfig.endDate ? Date.parse(runConfig.endDate) + 86400000 - 1 : Date.now();
    const trades = this.loadTrades({
      symbol: strategy.market.symbol,
      startMs,
      endMs,
      limit: 400000
    });

    const candles = enrichCandles(trades, strategy.market.timeframe);
    return this.executionEngine.run({ strategy: withRunConfig(strategy, runConfig), candles, progressCallback });
  }
}

function withRunConfig(strategy, runConfig) {
  return {
    ...strategy,
    backtestDefaults: {
      ...strategy.backtestDefaults,
      initial_balance: Number(runConfig.initialBalance || strategy.backtestDefaults.initial_balance)
    }
  };
}

function enrichCandles(trades, timeframe) {
  const candles = buildCandlesFromTrades(trades, timeframe);
  const vwap = new Map(computeSessionVwapFromTrades(trades, timeframe).map((x) => [x.time, x.value]));
  const cvd = new Map(computeSessionCvdFromTrades(trades, timeframe).map((x) => [x.time, x]));
  const byBucket = new Map();

  const tfSec = timeframeToSeconds(timeframe);
  for (const trade of trades) {
    const time = Math.floor((trade.trade_time / 1000) / tfSec) * tfSec;
    const bucket = byBucket.get(time) || { buy: 0, sell: 0 };
    if (trade.side === 'buy') bucket.buy += Number(trade.quantity || 0);
    else bucket.sell += Number(trade.quantity || 0);
    byBucket.set(time, bucket);
  }

  return candles.map((candle, idx, arr) => {
    const bucket = byBucket.get(candle.time) || { buy: 0, sell: 0 };
    const recent = arr.slice(Math.max(0, idx - 19), idx + 1);
    const avgVolume20 = recent.reduce((acc, x) => acc + x.volume, 0) / Math.max(recent.length, 1);
    const cvdCandle = cvd.get(candle.time) || { open: 0, high: 0, low: 0, close: 0 };
    return {
      ...candle,
      vwap_session: vwap.get(candle.time) ?? candle.close,
      cvd_open: cvdCandle.open,
      cvd_high: cvdCandle.high,
      cvd_low: cvdCandle.low,
      cvd_close: cvdCandle.close,
      dom_visible_buy_limits: bucket.buy,
      dom_visible_sell_limits: bucket.sell,
      avg_volume_20: avgVolume20
    };
  });
}
