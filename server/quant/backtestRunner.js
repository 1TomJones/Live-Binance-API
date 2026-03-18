import {
  buildCandlesFromTrades,
  computeSessionCvdFromTrades,
  computeSessionVwapFromTrades,
  timeframeToSeconds
} from '../sessionAnalytics.js';

export class BacktestRunner {
  constructor({ executionEngine, loadTrades }) {
    this.executionEngine = executionEngine;
    this.loadTrades = loadTrades;
  }

  run({ strategy, runConfig, progressCallback, shouldStop }) {
    const startDate = normalizeDay(runConfig.startDate);
    const endDate = normalizeDay(runConfig.endDate || runConfig.startDate);
    const runState = this.executionEngine.createRunState({ strategy, runConfig });
    const totalDays = daysBetweenInclusive(startDate, endDate);
    const totalUnits = totalDays * 1000;
    const dayResults = [];

    forEachUtcDay(startDate, endDate, ({ dayStartMs, dayEndMs, isoDate, dayIndex }) => {
      shouldStop?.();
      const dayTrades = this.loadTrades({
        symbol: strategy.market.symbol,
        startMs: dayStartMs,
        endMs: dayEndMs,
        limit: null
      });
      const candles = enrichCandles(dayTrades, strategy.market.timeframe, runState.settings);

      const fillModel = this.executionEngine.createFillModel({
        syntheticSpreadBps: runState.settings.syntheticSpreadBps
      });

      candles.forEach((candle, candleIndex) => {
        shouldStop?.();
        this.executionEngine.processCandle({
          strategy,
          state: runState,
          candle,
          fillModel,
          currentDateLabel: isoDate
        });
        const dayProgress = candles.length ? Math.floor(((candleIndex + 1) / candles.length) * 1000) : 1000;
        progressCallback?.({
          processed: dayIndex * 1000 + dayProgress,
          total: totalUnits,
          currentDate: isoDate,
          totalTrades: runState.trades.length,
          elapsedMs: Date.now() - Date.parse(runConfig.startedAtIso || new Date().toISOString()),
          marker: `Simulating ${isoDate} · candle ${candleIndex + 1}/${candles.length}`,
          dayIndex: dayIndex + 1,
          totalDays
        });
      });

      const endOfDayClose = this.executionEngine.finalizeDay({
        strategy,
        state: runState,
        fillModel,
        dateLabel: isoDate
      });

      dayResults.push({
        date: isoDate,
        tradeCount: runState.trades.filter((trade) => trade.entryDate === isoDate).length,
        candleCount: candles.length,
        endOfDayExit: endOfDayClose ? endOfDayClose.exitReason : null
      });
    });

    const result = this.executionEngine.finalizeRun({
      strategy,
      state: runState,
      lastPrice: runState.session.previousCandle?.close || null
    });

    return {
      ...result,
      dayResults
    };
  }
}

function enrichCandles(trades, timeframe, settings) {
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
      avg_volume_20: avgVolume20,
      stopLossPct: settings.stopLossPct,
      takeProfitPct: settings.takeProfitPct
    };
  });
}

function normalizeDay(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function forEachUtcDay(startDate, endDate, callback) {
  let cursor = startDate.getTime();
  let dayIndex = 0;
  while (cursor <= endDate.getTime()) {
    const dayStartMs = cursor;
    const dayEndMs = cursor + 86400000 - 1;
    callback({
      dayStartMs,
      dayEndMs,
      isoDate: new Date(dayStartMs).toISOString().slice(0, 10),
      dayIndex
    });
    cursor += 86400000;
    dayIndex += 1;
  }
}

function daysBetweenInclusive(startDate, endDate) {
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}
