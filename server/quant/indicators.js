/**
 * Pure indicator calculations from OHLCV candle arrays.
 * All functions return arrays with nulls during warmup period.
 */

export function ema(values, period) {
  const result = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;

  const k = 2 / (period + 1);

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }

  return result;
}

export function sma(values, period) {
  const result = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    result[i] = sum / period;
  }

  return result;
}

export function rsi(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const calcRsi = (ag, al) => {
    if (al === 0) return 100;
    if (ag === 0) return 0;
    return 100 - 100 / (1 + ag / al);
  };

  result[period] = calcRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = calcRsi(avgGain, avgLoss);
  }

  return result;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  const macdLine = closes.map((_, i) => {
    if (fastEma[i] === null || slowEma[i] === null) return null;
    return fastEma[i] - slowEma[i];
  });

  // Signal line: EMA of macdLine (only on valid values)
  const validMacd = macdLine.map((v) => (v === null ? 0 : v));
  const rawSignal = ema(validMacd, signal);

  const signalLine = macdLine.map((v, i) => {
    if (v === null) return null;
    // Signal needs slow + signal - 1 bars minimum
    if (i < slow + signal - 2) return null;
    return rawSignal[i];
  });

  const histogram = macdLine.map((v, i) => {
    if (v === null || signalLine[i] === null) return null;
    return v - signalLine[i];
  });

  return { macd: macdLine, signal: signalLine, histogram };
}

export function bollingerBands(closes, period = 20, mult = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    if (middle[i] === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += Math.pow(closes[j] - middle[i], 2);
    }
    const stdDev = Math.sqrt(sumSq / period);
    upper[i] = middle[i] + mult * stdDev;
    lower[i] = middle[i] - mult * stdDev;
  }

  return { upper, middle, lower };
}

export function atr(candles, period = 14) {
  const result = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;

  const trueRanges = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });

  let sumTr = 0;
  for (let i = 0; i < period; i++) {
    sumTr += trueRanges[i];
  }
  result[period - 1] = sumTr / period;

  for (let i = period; i < candles.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + trueRanges[i]) / period;
  }

  return result;
}

export function obv(candles) {
  const result = new Array(candles.length).fill(null);
  if (!candles.length) return result;

  result[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (curr.close > prev.close) {
      result[i] = result[i - 1] + curr.volume;
    } else if (curr.close < prev.close) {
      result[i] = result[i - 1] - curr.volume;
    } else {
      result[i] = result[i - 1];
    }
  }

  return result;
}

export function stochastic(candles, period = 14, signalPeriod = 3) {
  const k = new Array(candles.length).fill(null);
  const d = new Array(candles.length).fill(null);

  for (let i = period - 1; i < candles.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      highest = Math.max(highest, candles[j].high);
      lowest = Math.min(lowest, candles[j].low);
    }
    if (highest === lowest) {
      k[i] = 50;
    } else {
      k[i] = ((candles[i].close - lowest) / (highest - lowest)) * 100;
    }
  }

  // D is SMA of K
  for (let i = period - 1 + signalPeriod - 1; i < candles.length; i++) {
    if (k[i] === null) continue;
    let sum = 0;
    let count = 0;
    for (let j = i - signalPeriod + 1; j <= i; j++) {
      if (k[j] !== null) {
        sum += k[j];
        count++;
      }
    }
    if (count === signalPeriod) d[i] = sum / signalPeriod;
  }

  return { k, d };
}

/**
 * Compute all selected indicators from candles.
 * selection is a boolean flags object.
 */
export function computeIndicators(candles, selection = {}) {
  const closes = candles.map((c) => c.close);
  const result = {};

  if (selection.ema9) result.ema9 = ema(closes, 9);
  if (selection.ema21) result.ema21 = ema(closes, 21);
  if (selection.ema50) result.ema50 = ema(closes, 50);
  if (selection.ema200) result.ema200 = ema(closes, 200);
  if (selection.sma20) result.sma20 = sma(closes, 20);
  if (selection.sma50) result.sma50 = sma(closes, 50);
  if (selection.rsi) result.rsi = rsi(closes, 14);
  if (selection.macd) result.macd = macd(closes);
  if (selection.bollinger) result.bollinger = bollingerBands(closes, 20, 2);
  if (selection.atr) result.atr = atr(candles, 14);
  if (selection.obv) result.obv = obv(candles);
  if (selection.stochastic) result.stochastic = stochastic(candles, 14, 3);

  return result;
}
