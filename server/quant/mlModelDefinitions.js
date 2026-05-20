/**
 * ML model definitions for demo backtesting.
 * Each model has a paramGrid for grid search and a signal() function.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function runBacktest(candles, indicators, signalFn, params, startIdx = 0) {
  const POSITION_SIZE = 0.02;   // 2% of equity
  const STOP_LOSS     = 0.015;  // 1.5%
  const TAKE_PROFIT   = 0.03;   // 3.0%
  const FEE           = 0.001;  // 0.1% per side

  let equity = 10000;
  let peakEquity = equity;
  let maxDrawdown = 0;
  let inTrade = false;
  let entryPrice = 0;
  let entryIdx = 0;
  let tradeSide = 0;

  const trades = [];
  const equityCurve = [{ time: candles[startIdx]?.time || 0, value: equity }];

  for (let i = startIdx; i < candles.length; i++) {
    const candle = candles[i];

    if (inTrade) {
      const holdBars = i - entryIdx;
      const priceMoved = tradeSide === 1
        ? (candle.close - entryPrice) / entryPrice
        : (entryPrice - candle.close) / entryPrice;

      let exitReason = null;

      if (tradeSide === 1) {
        if (candle.low <= entryPrice * (1 - STOP_LOSS)) {
          exitReason = 'stop_loss';
          const exitPrice = entryPrice * (1 - STOP_LOSS);
          const netPnl = equity * POSITION_SIZE * (-STOP_LOSS - FEE * 2);
          trades.push({ entryIdx, exitIdx: i, side: 'long', entryPrice, exitPrice, pnlPct: -STOP_LOSS, netPnl, exitReason, duration: holdBars });
          equity += netPnl;
        } else if (candle.high >= entryPrice * (1 + TAKE_PROFIT)) {
          exitReason = 'take_profit';
          const exitPrice = entryPrice * (1 + TAKE_PROFIT);
          const netPnl = equity * POSITION_SIZE * (TAKE_PROFIT - FEE * 2);
          trades.push({ entryIdx, exitIdx: i, side: 'long', entryPrice, exitPrice, pnlPct: TAKE_PROFIT, netPnl, exitReason, duration: holdBars });
          equity += netPnl;
        } else if (holdBars >= params.maxHoldingBars) {
          exitReason = 'timeout';
          const exitPrice = candle.close;
          const pnlPct = (exitPrice - entryPrice) / entryPrice;
          const netPnl = equity * POSITION_SIZE * (pnlPct - FEE * 2);
          trades.push({ entryIdx, exitIdx: i, side: 'long', entryPrice, exitPrice, pnlPct, netPnl, exitReason, duration: holdBars });
          equity += netPnl;
        }
      } else {
        if (candle.high >= entryPrice * (1 + STOP_LOSS)) {
          exitReason = 'stop_loss';
          const exitPrice = entryPrice * (1 + STOP_LOSS);
          const netPnl = equity * POSITION_SIZE * (-STOP_LOSS - FEE * 2);
          trades.push({ entryIdx, exitIdx: i, side: 'short', entryPrice, exitPrice, pnlPct: -STOP_LOSS, netPnl, exitReason, duration: holdBars });
          equity += netPnl;
        } else if (candle.low <= entryPrice * (1 - TAKE_PROFIT)) {
          exitReason = 'take_profit';
          const exitPrice = entryPrice * (1 - TAKE_PROFIT);
          const netPnl = equity * POSITION_SIZE * (TAKE_PROFIT - FEE * 2);
          trades.push({ entryIdx, exitIdx: i, side: 'short', entryPrice, exitPrice, pnlPct: TAKE_PROFIT, netPnl, exitReason, duration: holdBars });
          equity += netPnl;
        } else if (holdBars >= params.maxHoldingBars) {
          exitReason = 'timeout';
          const exitPrice = candle.close;
          const pnlPct = (entryPrice - exitPrice) / entryPrice;
          const netPnl = equity * POSITION_SIZE * (pnlPct - FEE * 2);
          trades.push({ entryIdx, exitIdx: i, side: 'short', entryPrice, exitPrice, pnlPct, netPnl, exitReason, duration: holdBars });
          equity += netPnl;
        }
      }

      if (exitReason) {
        inTrade = false;
        peakEquity = Math.max(peakEquity, equity);
        const dd = (peakEquity - equity) / peakEquity;
        maxDrawdown = Math.max(maxDrawdown, dd);
      }
    }

    if (!inTrade && i + 1 < candles.length) {
      const sig = signalFn(candles, indicators, i, params);
      if (sig !== 0) {
        inTrade = true;
        entryPrice = candles[i + 1].open;
        entryIdx = i + 1;
        tradeSide = sig;
      }
    }

    equityCurve.push({ time: candle.time, value: Math.round(equity * 100) / 100 });
  }

  return { trades, equityCurve, finalEquity: equity, maxDrawdown };
}

function calcMetrics(trades, equityCurve, startEquity = 10000) {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return { sharpe: 0, totalReturn: 0, winRate: 0, totalTrades: 0, profitFactor: 0, expectedValue: 0, maxDrawdown: 0, avgDuration: 0 };
  }

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const winRate = wins.length / totalTrades;
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;
  const expectedValue = trades.reduce((s, t) => s + t.netPnl, 0) / totalTrades;
  const finalEquity = equityCurve.at(-1)?.value || startEquity;
  const totalReturn = (finalEquity - startEquity) / startEquity;

  // Returns-based Sharpe
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].value;
    const curr = equityCurve[i].value;
    if (prev > 0) returns.push((curr - prev) / prev);
  }

  let sharpe = 0;
  if (returns.length > 1) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    sharpe = stdDev === 0 ? 0 : (mean / stdDev) * Math.sqrt(252);
  }

  // Max drawdown from equity curve
  let peak = startEquity;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const avgDuration = trades.reduce((s, t) => s + (t.duration || 0), 0) / totalTrades;

  return {
    sharpe: Math.round(sharpe * 100) / 100,
    totalReturn: Math.round(totalReturn * 10000) / 100,
    winRate: Math.round(winRate * 10000) / 100,
    totalTrades,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectedValue: Math.round(expectedValue * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    avgDuration: Math.round(avgDuration * 10) / 10
  };
}

// ─── Model Definitions ───────────────────────────────────────────────────────

export const MODEL_DEFINITIONS = [
  {
    id: 'ema_crossover',
    name: 'EMA Crossover',
    description: 'Buys when fast EMA crosses above slow EMA, sells on reversal',
    requiredIndicators: ['ema9', 'ema21', 'ema50', 'ema200'],
    paramGrid: [
      { fast: 'ema9',  slow: 'ema21',  maxHoldingBars: 20 },
      { fast: 'ema9',  slow: 'ema21',  maxHoldingBars: 50 },
      { fast: 'ema9',  slow: 'ema21',  maxHoldingBars: 100 },
      { fast: 'ema9',  slow: 'ema50',  maxHoldingBars: 20 },
      { fast: 'ema9',  slow: 'ema50',  maxHoldingBars: 50 },
      { fast: 'ema9',  slow: 'ema50',  maxHoldingBars: 100 },
      { fast: 'ema21', slow: 'ema50',  maxHoldingBars: 20 },
      { fast: 'ema21', slow: 'ema50',  maxHoldingBars: 50 },
      { fast: 'ema21', slow: 'ema50',  maxHoldingBars: 100 },
      { fast: 'ema21', slow: 'ema200', maxHoldingBars: 50 },
      { fast: 'ema21', slow: 'ema200', maxHoldingBars: 100 },
      { fast: 'ema50', slow: 'ema200', maxHoldingBars: 100 },
    ],
    signal(candles, indicators, i, params) {
      const fastArr = indicators[params.fast];
      const slowArr = indicators[params.slow];
      if (!fastArr || !slowArr) return 0;
      if (i < 1 || fastArr[i] === null || fastArr[i - 1] === null || slowArr[i] === null || slowArr[i - 1] === null) return 0;
      // Crossover: fast crosses above slow
      if (fastArr[i - 1] < slowArr[i - 1] && fastArr[i] >= slowArr[i]) return 1;
      // Crossunder: fast crosses below slow
      if (fastArr[i - 1] > slowArr[i - 1] && fastArr[i] <= slowArr[i]) return -1;
      return 0;
    }
  },

  {
    id: 'rsi_reversal',
    name: 'RSI Reversal',
    description: 'Buys on RSI crossing up from oversold, sells on crossing down from overbought',
    requiredIndicators: ['rsi'],
    paramGrid: [
      { oversold: 25, overbought: 75, maxHoldingBars: 15 },
      { oversold: 25, overbought: 75, maxHoldingBars: 20 },
      { oversold: 25, overbought: 75, maxHoldingBars: 30 },
      { oversold: 30, overbought: 70, maxHoldingBars: 15 },
      { oversold: 30, overbought: 70, maxHoldingBars: 20 },
      { oversold: 30, overbought: 70, maxHoldingBars: 30 },
      { oversold: 35, overbought: 65, maxHoldingBars: 15 },
      { oversold: 35, overbought: 65, maxHoldingBars: 20 },
      { oversold: 35, overbought: 65, maxHoldingBars: 30 },
    ],
    signal(candles, indicators, i, params) {
      const rsiArr = indicators.rsi;
      if (!rsiArr || i < 1 || rsiArr[i] === null || rsiArr[i - 1] === null) return 0;
      // Cross up from oversold
      if (rsiArr[i - 1] < params.oversold && rsiArr[i] >= params.oversold) return 1;
      // Cross down from overbought
      if (rsiArr[i - 1] > params.overbought && rsiArr[i] <= params.overbought) return -1;
      return 0;
    }
  },

  {
    id: 'macd_signal',
    name: 'MACD Signal',
    description: 'Trades MACD histogram zero-line crossovers',
    requiredIndicators: ['macd'],
    paramGrid: [
      { histogramThreshold: 0,     maxHoldingBars: 20 },
      { histogramThreshold: 0,     maxHoldingBars: 30 },
      { histogramThreshold: 0,     maxHoldingBars: 50 },
      { histogramThreshold: 0.005, maxHoldingBars: 20 },
      { histogramThreshold: 0.005, maxHoldingBars: 30 },
      { histogramThreshold: 0.005, maxHoldingBars: 50 },
      { histogramThreshold: 0.01,  maxHoldingBars: 20 },
      { histogramThreshold: 0.01,  maxHoldingBars: 30 },
      { histogramThreshold: 0.01,  maxHoldingBars: 50 },
    ],
    signal(candles, indicators, i, params) {
      const hist = indicators.macd?.histogram;
      if (!hist || i < 1 || hist[i] === null || hist[i - 1] === null) return 0;
      const threshold = params.histogramThreshold;
      // Cross from below threshold to above
      if (hist[i - 1] < -threshold && hist[i] >= -threshold) return 1;
      // Cross from above -threshold to below
      if (hist[i - 1] > threshold && hist[i] <= threshold) return -1;
      return 0;
    }
  },

  {
    id: 'bollinger_breakout',
    name: 'Bollinger Mean Reversion',
    description: 'Mean-reversion — buys below lower band, sells above upper band',
    requiredIndicators: ['bollinger'],
    paramGrid: [
      { entryOffset: 0,   maxHoldingBars: 15 },
      { entryOffset: 0,   maxHoldingBars: 20 },
      { entryOffset: 0,   maxHoldingBars: 30 },
      { entryOffset: 0.1, maxHoldingBars: 15 },
      { entryOffset: 0.1, maxHoldingBars: 20 },
      { entryOffset: 0.1, maxHoldingBars: 30 },
      { entryOffset: 0.2, maxHoldingBars: 15 },
      { entryOffset: 0.2, maxHoldingBars: 20 },
      { entryOffset: 0.2, maxHoldingBars: 30 },
    ],
    signal(candles, indicators, i, params) {
      const bb = indicators.bollinger;
      if (!bb || bb.lower[i] === null || bb.upper[i] === null) return 0;
      if (i < 1 || bb.lower[i - 1] === null || bb.upper[i - 1] === null) return 0;

      const close = candles[i].close;
      const prevClose = candles[i - 1].close;
      const lowerThresh = bb.lower[i] * (1 - params.entryOffset / 100);
      const upperThresh = bb.upper[i] * (1 + params.entryOffset / 100);

      // Price crossing back inside from below (mean reversion long)
      if (prevClose < bb.lower[i - 1] && close >= bb.lower[i]) return 1;
      // Price crossing back inside from above (mean reversion short)
      if (prevClose > bb.upper[i - 1] && close <= bb.upper[i]) return -1;
      return 0;
    }
  },

  {
    id: 'multi_factor',
    name: 'Multi-Factor Score',
    description: 'Scores EMA trend + RSI level + MACD direction, enters when score meets threshold',
    requiredIndicators: ['ema21', 'ema50', 'rsi', 'macd'],
    paramGrid: [
      { scoreThreshold: 2, rsiMidpoint: 50, maxHoldingBars: 20 },
      { scoreThreshold: 2, rsiMidpoint: 50, maxHoldingBars: 30 },
      { scoreThreshold: 2, rsiMidpoint: 50, maxHoldingBars: 50 },
      { scoreThreshold: 2, rsiMidpoint: 55, maxHoldingBars: 20 },
      { scoreThreshold: 2, rsiMidpoint: 55, maxHoldingBars: 30 },
      { scoreThreshold: 3, rsiMidpoint: 50, maxHoldingBars: 20 },
      { scoreThreshold: 3, rsiMidpoint: 50, maxHoldingBars: 30 },
      { scoreThreshold: 3, rsiMidpoint: 50, maxHoldingBars: 50 },
      { scoreThreshold: 3, rsiMidpoint: 55, maxHoldingBars: 30 },
    ],
    signal(candles, indicators, i, params) {
      if (i < 1) return 0;
      const { ema21, ema50, rsi: rsiArr, macd: macdObj } = indicators;
      if (!ema21 || !ema50 || !rsiArr || !macdObj) return 0;
      if ([ema21[i], ema50[i], rsiArr[i], macdObj.histogram[i]].some((v) => v === null)) return 0;
      if ([ema21[i - 1], ema50[i - 1], rsiArr[i - 1], macdObj.histogram[i - 1]].some((v) => v === null)) return 0;

      // Only enter on a signal change (score crosses threshold)
      const scorePrev = calcMultiScore(indicators, i - 1, params);
      const scoreCurr = calcMultiScore(indicators, i, params);

      if (scorePrev.bull < params.scoreThreshold && scoreCurr.bull >= params.scoreThreshold) return 1;
      if (scorePrev.bear < params.scoreThreshold && scoreCurr.bear >= params.scoreThreshold) return -1;
      return 0;
    }
  }
];

function calcMultiScore(indicators, i, params) {
  const { ema21, ema50, rsi: rsiArr, macd: macdObj } = indicators;
  let bull = 0;
  let bear = 0;

  // EMA trend
  if (ema21[i] > ema50[i]) bull++; else bear++;
  // RSI
  if (rsiArr[i] > params.rsiMidpoint) bull++; else bear++;
  // MACD histogram direction
  if (macdObj.histogram[i] > 0) bull++; else bear++;

  return { bull, bear };
}

/**
 * Train a model via grid search on training split, evaluate on test split.
 */
export function trainModel(modelDef, candles, indicators, opts = {}) {
  const splitRatio = opts.splitRatio || 0.7;
  const trainEnd = Math.floor(candles.length * splitRatio);
  const trainCandles = candles.slice(0, trainEnd);
  const testCandles = candles.slice(trainEnd);

  // Slice indicators to match training candles
  const sliceIndicators = (indic, start, end) => {
    const sliced = {};
    for (const [key, val] of Object.entries(indic)) {
      if (Array.isArray(val)) {
        sliced[key] = val.slice(start, end);
      } else if (val && typeof val === 'object') {
        // e.g. macd: { macd, signal, histogram }
        sliced[key] = {};
        for (const [k2, v2] of Object.entries(val)) {
          sliced[key][k2] = Array.isArray(v2) ? v2.slice(start, end) : v2;
        }
      }
    }
    return sliced;
  };

  const trainIndicators = sliceIndicators(indicators, 0, trainEnd);
  const testIndicators = sliceIndicators(indicators, trainEnd, candles.length);

  // Check required indicators are available
  for (const req of modelDef.requiredIndicators) {
    if (!indicators[req]) {
      return null; // skip model
    }
  }

  // Grid search on training set
  let bestParams = modelDef.paramGrid[0];
  let bestSharpe = -Infinity;
  let bestTrainResult = null;

  for (const params of modelDef.paramGrid) {
    const result = runBacktest(trainCandles, trainIndicators, modelDef.signal.bind(modelDef), params);
    const metrics = calcMetrics(result.trades, result.equityCurve);
    if (metrics.sharpe > bestSharpe) {
      bestSharpe = metrics.sharpe;
      bestParams = params;
      bestTrainResult = { result, metrics };
    }
  }

  // Run out-of-sample test on test set
  const testResult = runBacktest(testCandles, testIndicators, modelDef.signal.bind(modelDef), bestParams);
  const testMetrics = calcMetrics(testResult.trades, testResult.equityCurve);

  return {
    modelId: modelDef.id,
    name: modelDef.name,
    description: modelDef.description,
    trainedParams: bestParams,
    trainMetrics: bestTrainResult?.metrics || {},
    testMetrics,
    tradesCount: testResult.trades.length
  };
}

export { runBacktest, calcMetrics };
