import { RuleEvaluator } from './ruleEvaluator.js';
import { MetricsCalculator } from './metricsCalculator.js';

export class StrategyExecutionEngine {
  constructor({ ruleEvaluator = new RuleEvaluator(), metricsCalculator = new MetricsCalculator() } = {}) {
    this.ruleEvaluator = ruleEvaluator;
    this.metricsCalculator = metricsCalculator;
  }

  run({ strategy, candles, progressCallback }) {
    let equity = Number(strategy.backtestDefaults.initial_balance || 10000);
    let peakEquity = equity;
    const initialBalance = equity;
    const trades = [];
    const equitySeries = [];
    let position = null;
    let cooldownBars = 0;

    for (let i = 1; i < candles.length; i += 1) {
      const candle = candles[i];
      const context = this.#buildContext(candles, i, position, strategy);

      if (position) {
        position.holdingBars += 1;
        if (strategy.positionManagement.enable_break_even && !position.breakEvenMoved) {
          const profitPct = this.#positionPnlPct(position, candle.close);
          if (profitPct >= strategy.positionManagement.move_stop_to_break_even_at_profit_pct) {
            position.stopPrice = position.entryPrice;
            position.breakEvenMoved = true;
          }
        }

        const sideExitRules = position.side === 'long' ? strategy.exitRules.long : strategy.exitRules.short;
        if (this.ruleEvaluator.evaluateBlock(sideExitRules, context)) {
          const closed = this.#closePosition(position, candle, strategy);
          equity += closed.realizedPnl;
          trades.push(closed);
          position = null;
          cooldownBars = strategy.execution.cooldown_bars_after_exit;
        }
      }

      if (!position && cooldownBars > 0) cooldownBars -= 1;

      if (!position && cooldownBars === 0) {
        const longSignal = strategy.market.allow_long && this.ruleEvaluator.evaluateBlock(strategy.entryRules.long, context);
        const shortSignal = strategy.market.allow_short && this.ruleEvaluator.evaluateBlock(strategy.entryRules.short, context);

        if (longSignal) position = this.#openPosition('long', candle, equity, strategy);
        else if (shortSignal) position = this.#openPosition('short', candle, equity, strategy);
      }

      peakEquity = Math.max(peakEquity, equity);
      const drawdownPct = peakEquity ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      equitySeries.push({ time: candle.time, equity: round(equity), drawdownPct: round(drawdownPct) });

      if (progressCallback) {
        progressCallback({ processed: i, total: candles.length - 1, marker: `Processed ${i}/${candles.length - 1} candles` });
      }
    }

    const metrics = this.metricsCalculator.calculate({
      initialBalance,
      equitySeries,
      trades,
      openPosition: position,
      lastPrice: candles.at(-1)?.close
    });

    return {
      metrics,
      equitySeries,
      drawdownSeries: equitySeries.map((point) => ({ time: point.time, drawdownPct: point.drawdownPct })),
      trades,
      endingBalance: metrics.currentEquity,
      initialBalance
    };
  }

  #buildContext(candles, index, position, strategy) {
    const candle = candles[index];
    const prev = candles[index - 1] || candle;
    const values = {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      prev_close: prev.close,
      prev_high: prev.high,
      prev_low: prev.low,
      prev_volume: prev.volume,
      vwap_session: candle.vwap_session,
      cvd_open: candle.cvd_open,
      cvd_high: candle.cvd_high,
      cvd_low: candle.cvd_low,
      cvd_close: candle.cvd_close,
      prev_cvd_close: prev.cvd_close,
      dom_visible_buy_limits: candle.dom_visible_buy_limits,
      dom_visible_sell_limits: candle.dom_visible_sell_limits,
      avg_volume_20: candle.avg_volume_20
    };

    const builtin = {
      stop_loss: false,
      take_profit: false,
      max_holding_bars: false
    };

    if (position) {
      if (position.side === 'long') {
        builtin.stop_loss = candle.close <= position.stopPrice;
        builtin.take_profit = candle.close >= position.takeProfitPrice;
      } else {
        builtin.stop_loss = candle.close >= position.stopPrice;
        builtin.take_profit = candle.close <= position.takeProfitPrice;
      }
      builtin.max_holding_bars = position.holdingBars >= strategy.risk.max_holding_bars;
    }

    return { values, builtin };
  }

  #openPosition(side, candle, equity, strategy) {
    const slippagePct = strategy.risk.slippage_pct_per_side / 100;
    const close = candle.close;
    const entryPrice = side === 'long' ? close * (1 + slippagePct) : close * (1 - slippagePct);
    const notional = equity * (strategy.risk.position_size_pct_of_equity / 100);
    const quantity = notional / entryPrice;
    const stopMult = strategy.risk.stop_loss_pct / 100;
    const tpMult = strategy.risk.take_profit_pct / 100;

    return {
      status: 'open',
      side,
      entryTime: candle.time,
      entryPrice,
      quantity,
      notional,
      entryNotional: entryPrice * quantity,
      feesPaid: entryPrice * quantity * (strategy.risk.fee_pct_per_side / 100),
      slippagePaid: Math.abs(entryPrice - close) * quantity,
      holdingBars: 0,
      breakEvenMoved: false,
      stopPrice: side === 'long' ? entryPrice * (1 - stopMult) : entryPrice * (1 + stopMult),
      takeProfitPrice: side === 'long' ? entryPrice * (1 + tpMult) : entryPrice * (1 - tpMult)
    };
  }

  #closePosition(position, candle, strategy) {
    const slippagePct = strategy.risk.slippage_pct_per_side / 100;
    const close = candle.close;
    const exitPrice = position.side === 'long' ? close * (1 - slippagePct) : close * (1 + slippagePct);
    const exitNotional = exitPrice * position.quantity;
    const exitFees = exitNotional * (strategy.risk.fee_pct_per_side / 100);
    const grossPnl = position.side === 'long'
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;
    const realizedPnl = grossPnl - position.feesPaid - exitFees;

    return {
      ...position,
      status: 'closed',
      exitTime: candle.time,
      exitPrice,
      fees: position.feesPaid + exitFees,
      slippage: position.slippagePaid + Math.abs(exitPrice - close) * position.quantity,
      realizedPnl: round(realizedPnl),
      returnPct: round((realizedPnl / position.entryNotional) * 100),
      exitReason: 'rule_exit',
      holdingBars: position.holdingBars
    };
  }

  #positionPnlPct(position, markPrice) {
    const pnl = position.side === 'long'
      ? (markPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - markPrice) * position.quantity;
    return (pnl / Math.max(position.entryNotional, 1e-9)) * 100;
  }
}

function round(value) {
  return Number((value || 0).toFixed(6));
}
