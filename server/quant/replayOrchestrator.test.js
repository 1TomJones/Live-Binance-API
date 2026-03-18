import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './__fixtures__/marketReplayParity.json' with { type: 'json' };
import { getBuiltInStrategyDefinition } from './builtinStrategies.js';
import { BacktestRunner } from './backtestRunner.js';
import { buildSessionReplay, REPLAY_EXECUTION_MODES } from './sessionReplayBuilder.js';
import {
  buildHistoricalClosedCandleReplay,
  buildLiveClosedCandleReplay,
  runClosedCandleReplay
} from './replayOrchestrator.js';
import { StrategyExecutionEngine } from './strategyExecutionEngine.js';

test('historical replay seeds previous candle before the first evaluable candle', () => {
  const state = new StrategyExecutionEngine().createRunState({
    strategy: getBuiltInStrategyDefinition('VWAP_CVD_Live_Trend_01').strategy,
    runConfig: {}
  });
  const closedCandles = [
    { time: 100, close: 1, cvd_close: 1 },
    { time: 160, close: 2, cvd_close: 2 },
    { time: 220, close: 3, cvd_close: 3 }
  ];

  const replay = buildHistoricalClosedCandleReplay({ state, closedCandles });

  assert.equal(state.session.previousCandle.time, 100);
  assert.deepStrictEqual(replay.pendingCandles.map((candle) => candle.time), [160, 220]);
});

test('live replay evaluates only newly closed candles while preserving the prior closed candle as context', () => {
  const state = new StrategyExecutionEngine().createRunState({
    strategy: getBuiltInStrategyDefinition('VWAP_CVD_Live_Trend_01').strategy,
    runConfig: {}
  });
  const closedCandles = [
    { time: 100, close: 1, cvd_close: 1 },
    { time: 160, close: 2, cvd_close: 2 },
    { time: 220, close: 3, cvd_close: 3 }
  ];

  const replay = buildLiveClosedCandleReplay({ state, closedCandles });

  assert.equal(state.session.previousCandle.time, 160);
  assert.deepStrictEqual(replay.pendingCandles.map((candle) => candle.time), [220]);
});

test('backtest runner defaults to live-parity execution mode and emits entry debug output from the parity feed', () => {
  const { trades, sessionStartMs } = fixture;
  const strategy = getBuiltInStrategyDefinition('VWAP_CVD_Live_Trend_01').strategy;
  const dayEndMs = sessionStartMs + 86400000 - 1;
  const expectedReplay = buildSessionReplay({
    replayMode: 'backtest',
    executionMode: REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY,
    timeframe: strategy.market.timeframe,
    sessionStartMs,
    nowMs: dayEndMs,
    trades,
    settings: {
      stopLossPct: strategy.risk.stop_loss_pct,
      takeProfitPct: strategy.risk.take_profit_pct
    }
  }).closedEngineCandles;
  const runner = new BacktestRunner({
    executionEngine: new StrategyExecutionEngine(),
    loadTrades: ({ startMs, endMs }) => trades.filter((trade) => trade.trade_time >= startMs && trade.trade_time <= endMs)
  });

  const result = runner.run({
    strategy,
    runConfig: {
      startDate: new Date(sessionStartMs).toISOString().slice(0, 10),
      endDate: new Date(sessionStartMs).toISOString().slice(0, 10),
      replaySpeed: 48
    }
  });

  assert.equal(result.replaySpeed, 48);
  assert.equal(result.executionMode, REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY);
  assert.equal(result.candleDebugLog.length, Math.max(expectedReplay.length - 1, 0));
  assert.deepStrictEqual(
    result.candleDebugLog[0],
    {
      date: new Date(sessionStartMs).toISOString().slice(0, 10),
      time: expectedReplay[1].time,
      close: expectedReplay[1].close,
      vwap_session: expectedReplay[1].vwap_session,
      cvd_close: expectedReplay[1].cvd_close,
      prev_cvd_close: expectedReplay[1].prev_cvd_close,
      longSignal: expectedReplay[1].close > expectedReplay[1].vwap_session && expectedReplay[1].cvd_close > expectedReplay[1].prev_cvd_close,
      shortSignal: expectedReplay[1].close < expectedReplay[1].vwap_session && expectedReplay[1].cvd_close < expectedReplay[1].prev_cvd_close
    }
  );
});

test('live-parity backtest and incremental live replay stay aligned on entry and exit timestamps', () => {
  const { trades, sessionStartMs } = fixture;
  const strategy = getBuiltInStrategyDefinition('VWAP_CVD_Live_Trend_01').strategy;
  const dayEndMs = sessionStartMs + 86400000 - 1;
  const executionEngine = new StrategyExecutionEngine();
  const settings = {
    stopLossPct: strategy.risk.stop_loss_pct,
    takeProfitPct: strategy.risk.take_profit_pct
  };
  const closedCandles = buildSessionReplay({
    replayMode: 'backtest',
    executionMode: REPLAY_EXECUTION_MODES.STRICT_LIVE_PARITY,
    timeframe: strategy.market.timeframe,
    sessionStartMs,
    nowMs: dayEndMs,
    trades,
    settings
  }).closedEngineCandles;

  const historicalState = executionEngine.createRunState({ strategy, runConfig: settings });
  const liveState = executionEngine.createRunState({ strategy, runConfig: settings });
  const historicalFillModel = executionEngine.createFillModel({ syntheticSpreadBps: historicalState.settings.syntheticSpreadBps });
  const liveFillModel = executionEngine.createFillModel({ syntheticSpreadBps: liveState.settings.syntheticSpreadBps });

  const { pendingCandles } = buildHistoricalClosedCandleReplay({
    state: historicalState,
    closedCandles
  });
  runClosedCandleReplay({
    strategy,
    state: historicalState,
    candles: pendingCandles,
    executionEngine,
    fillModel: historicalFillModel,
    currentDateLabel: new Date(sessionStartMs).toISOString().slice(0, 10),
    finalizeSession: true
  });

  closedCandles.forEach((_candle, index) => {
    const replay = buildLiveClosedCandleReplay({
      state: liveState,
      closedCandles: closedCandles.slice(0, index + 1)
    });

    runClosedCandleReplay({
      strategy,
      state: liveState,
      candles: replay.pendingCandles,
      executionEngine,
      fillModel: liveFillModel,
      currentDateLabel: new Date(sessionStartMs).toISOString().slice(0, 10),
      finalizeSession: false
    });
  });

  executionEngine.finalizeDay({
    strategy,
    state: liveState,
    fillModel: liveFillModel,
    dateLabel: new Date(sessionStartMs).toISOString().slice(0, 10)
  });

  assert.deepStrictEqual(
    summarizeTrades(liveState.trades),
    summarizeTrades(historicalState.trades)
  );
});

test('shared replay loop keeps end-of-day flattening in the common execution path', () => {
  const strategy = getBuiltInStrategyDefinition('VWAP_CVD_Live_Trend_01').strategy;
  const executionEngine = new StrategyExecutionEngine();
  const state = executionEngine.createRunState({ strategy, runConfig: {} });
  const fillModel = executionEngine.createFillModel({ syntheticSpreadBps: 0 });
  const candles = [
    {
      time: 100,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1,
      vwap_session: 99,
      cvd_open: 0,
      cvd_high: 1,
      cvd_low: 0,
      cvd_close: 1,
      prev_cvd_close: 0,
      stopLossPct: 0.35,
      takeProfitPct: 0.7
    },
    {
      time: 160,
      open: 101,
      high: 101,
      low: 101,
      close: 101,
      volume: 1,
      vwap_session: 100,
      cvd_open: 1,
      cvd_high: 2,
      cvd_low: 1,
      cvd_close: 2,
      prev_cvd_close: 1,
      stopLossPct: 0.35,
      takeProfitPct: 0.7
    }
  ];
  buildHistoricalClosedCandleReplay({ state, closedCandles: candles });

  const endOfDayClose = runClosedCandleReplay({
    strategy,
    state,
    candles: candles.slice(1),
    executionEngine,
    fillModel,
    currentDateLabel: '2025-01-01',
    finalizeSession: true
  });

  assert.equal(endOfDayClose?.exitReason, 'end_of_day_exit');
  assert.equal(state.position, null);
});

function summarizeTrades(trades = []) {
  return trades.map((trade) => ({
    side: trade.side,
    entryTime: trade.entryTime,
    entryCandleTime: trade.entryCandleTime,
    exitTime: trade.exitTime,
    exitReason: trade.exitReason
  }));
}
