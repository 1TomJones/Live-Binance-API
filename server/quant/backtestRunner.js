import { buildReplayEnvironment } from './replayEnvironment.js';
import { buildHistoricalClosedCandleReplay, runClosedCandleReplay } from './replayOrchestrator.js';
import { REPLAY_EXECUTION_MODES } from './sessionReplayBuilder.js';

export class BacktestRunner {
  constructor({ executionEngine, loadMarketData }) {
    this.executionEngine = executionEngine;
    this.loadMarketData = loadMarketData;
  }

  async run({ strategy, runConfig, progressCallback, shouldStop }) {
    const startDate = normalizeDay(runConfig.startDate);
    const endDate = normalizeDay(runConfig.endDate || runConfig.startDate);
    const runState = this.executionEngine.createRunState({ strategy, runConfig });
    const totalDays = daysBetweenInclusive(startDate, endDate);
    const totalUnits = totalDays * 1000;
    const dayResults = [];
    const candleDebugLog = [];
    const executionMode = normalizeReplayExecutionMode(runConfig.executionMode);

    for (const { dayStartMs, dayEndMs, isoDate, dayIndex } of listUtcDays(startDate, endDate)) {
      shouldStop?.();
      const marketData = await this.loadMarketData({
        symbol: strategy.market.symbol,
        startMs: dayStartMs,
        endMs: dayEndMs,
        timeframe: strategy.market.timeframe,
        executionMode
      });
      const { replay, trades: observedTrades = [], minuteCandles = [] } = buildReplayEnvironment({
        replayMode: 'backtest',
        executionMode,
        timeframe: strategy.market.timeframe,
        sessionStartMs: dayStartMs,
        nowMs: dayEndMs,
        input: marketData?.input,
        settings: runState.settings
      });
      const closedCandles = replay.closedEngineCandles;
      const { pendingCandles } = buildHistoricalClosedCandleReplay({
        state: runState,
        closedCandles
      });

      const fillModel = this.executionEngine.createFillModel({
        syntheticSpreadBps: runState.settings.syntheticSpreadBps
      });

      const endOfDayClose = runClosedCandleReplay({
        strategy,
        state: runState,
        candles: pendingCandles,
        executionEngine: this.executionEngine,
        fillModel,
        currentDateLabel: isoDate,
        finalizeSession: true,
        onCandle: ({ candle, candleIndex, outcome, state }) => {
          shouldStop?.();
          candleDebugLog.push({
            date: isoDate,
            time: candle.time,
            close: outcome.entryEvaluation.close,
            vwap_session: outcome.entryEvaluation.vwap_session,
            cvd_close: outcome.entryEvaluation.cvd_close,
            prev_cvd_close: outcome.entryEvaluation.prev_cvd_close,
            longSignal: outcome.entryEvaluation.longSignal,
            shortSignal: outcome.entryEvaluation.shortSignal
          });

          const dayProgress = pendingCandles.length ? Math.floor(((candleIndex + 1) / pendingCandles.length) * 1000) : 1000;
          progressCallback?.({
            processed: dayIndex * 1000 + dayProgress,
            total: totalUnits,
            currentDate: isoDate,
            totalTrades: state.trades.length,
            elapsedMs: Date.now() - Date.parse(runConfig.startedAtIso || new Date().toISOString()),
            marker: `Simulating ${isoDate} · candle ${candleIndex + 1}/${pendingCandles.length}`,
            dayIndex: dayIndex + 1,
            totalDays
          });
        }
      });

      if (!pendingCandles.length) {
        progressCallback?.({
          processed: (dayIndex + 1) * 1000,
          total: totalUnits,
          currentDate: isoDate,
          totalTrades: runState.trades.length,
          elapsedMs: Date.now() - Date.parse(runConfig.startedAtIso || new Date().toISOString()),
          marker: `Simulating ${isoDate} · warmup only`,
          dayIndex: dayIndex + 1,
          totalDays
        });
      }

      dayResults.push({
        date: isoDate,
        tradeCount: runState.trades.filter((trade) => trade.entryDate === isoDate).length,
        candleCount: pendingCandles.length,
        inputCandleCount: minuteCandles.length,
        observedTradeCount: observedTrades.length,
        source: marketData?.source || marketData?.input?.mode || 'unknown',
        endOfDayExit: endOfDayClose ? endOfDayClose.exitReason : null
      });
    }

    const result = this.executionEngine.finalizeRun({
      strategy,
      state: runState,
      lastPrice: runState.session.previousCandle?.close || null
    });

    return {
      ...result,
      dayResults,
      candleDebugLog,
      replaySpeed: Number(runConfig.replaySpeed || 1),
      executionMode
    };
  }
}

function normalizeReplayExecutionMode(value) {
  return value === REPLAY_EXECUTION_MODES.TRADE_ONLY
    ? REPLAY_EXECUTION_MODES.TRADE_ONLY
    : REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY;
}

function normalizeDay(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function listUtcDays(startDate, endDate) {
  const days = [];
  let cursor = startDate.getTime();
  let dayIndex = 0;
  while (cursor <= endDate.getTime()) {
    const dayStartMs = cursor;
    days.push({
      dayStartMs,
      dayEndMs: cursor + 86400000 - 1,
      isoDate: new Date(dayStartMs).toISOString().slice(0, 10),
      dayIndex
    });
    cursor += 86400000;
    dayIndex += 1;
  }
  return days;
}

function daysBetweenInclusive(startDate, endDate) {
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}
