import { PAPER_EXECUTION_LIMITS, StrategyExecutionEngine } from './strategyExecutionEngine.js';
import { buildLiveClosedCandleReplay, runClosedCandleReplay } from './replayOrchestrator.js';

const MAX_CANDLE_WINDOW = 120;
const MAX_TRADE_LOG = 200;

export const LIVE_PAPER_LIMITS = PAPER_EXECUTION_LIMITS;

export class LivePaperRunner {
  constructor({ getMarketSnapshot, saveLiveState, getLiveState, strategyResolver, executionEngine = new StrategyExecutionEngine() }) {
    this.getMarketSnapshot = getMarketSnapshot;
    this.saveLiveState = saveLiveState;
    this.getLiveState = getLiveState;
    this.strategyResolver = strategyResolver;
    this.executionEngine = executionEngine;
    this.active = null;
  }

  start({ strategyRef, runConfig = {} }) {
    const resolved = this.strategyResolver(strategyRef);
    if (!resolved) {
      throw new Error('Unknown strategy selection.');
    }

    const state = this.executionEngine.createRunState({
      strategy: resolved.strategy,
      runConfig
    });

    const market = this.getMarketSnapshot();

    this.active = {
      strategyRef,
      strategyName: resolved.summary.name,
      strategySummary: resolved.summary,
      strategy: resolved.strategy,
      symbol: resolved.strategy.market.symbol,
      timeframe: resolved.strategy.market.timeframe,
      mode: 'Paper Trading Only',
      startedAt: Date.now(),
      stoppedAt: null,
      status: 'running',
      settings: {
        orderSize: state.orderSize,
        stopLossPct: state.settings.stopLossPct,
        takeProfitPct: state.settings.takeProfitPct,
        enableLong: state.settings.enableLong,
        enableShort: state.settings.enableShort
      },
      engineState: state,
      lastAction: 'Waiting',
      lastSignalReason: 'Waiting for the next closed candle.',
      strategyStatus: 'Monitoring live flow',
      lastUpdatedAt: Date.now(),
      chartCandles: market.analysis.candles.slice(-MAX_CANDLE_WINDOW)
    };

    this.#persist();
    return this.getSnapshot();
  }

  stop() {
    if (!this.active) return this.getSnapshot();
    this.active.status = 'stopped';
    this.active.stoppedAt = Date.now();
    this.active.strategyStatus = 'Stopped';
    this.active.lastAction = 'Stopped';
    this.active.lastUpdatedAt = Date.now();
    this.#persist();
    return this.getSnapshot();
  }

  tick() {
    const market = this.getMarketSnapshot();
    if (!this.active) {
      return buildIdleSnapshot(market);
    }

    if (this.active.status === 'running') {
      this.#evaluate(market);
      this.active.lastUpdatedAt = Date.now();
      this.#persist();
    }

    return composeSnapshot(this.active, market);
  }

  getSnapshot() {
    const market = this.getMarketSnapshot();
    if (this.active) return composeSnapshot(this.active, market);
    return buildIdleSnapshot(market);
  }

  #evaluate(market) {
    const closedCandles = market.analysis.closedCandles;
    if (!closedCandles.length) {
      this.active.lastSignalReason = 'Awaiting enough live candle history.';
      this.active.strategyStatus = 'Warming up';
      return;
    }

    const { pendingCandles, seededPreviousCandle } = buildLiveClosedCandleReplay({
      state: this.active.engineState,
      closedCandles
    });

    if (!pendingCandles.length) {
      this.active.lastSignalReason = seededPreviousCandle
        ? 'Seeded the prior closed candle and waiting for the next evaluation.'
        : this.active.lastSignalReason;
      this.active.strategyStatus = this.active.status === 'running' ? 'Monitoring live flow' : 'Stopped';
      return;
    }

    const fillModel = this.executionEngine.createFillModel({
      quoteResolver: () => ({
        bid: Number(market.bestBid || market.markPrice || 0),
        ask: Number(market.bestAsk || market.markPrice || 0)
      })
    });

    runClosedCandleReplay({
      strategy: this.active.strategy,
      state: this.active.engineState,
      candles: pendingCandles.map((candle) => ({
        ...candle,
        stopLossPct: this.active.settings.stopLossPct,
        takeProfitPct: this.active.settings.takeProfitPct
      })),
      executionEngine: this.executionEngine,
      fillModel,
      onCandle: ({ candle, before, state }) => {
        this.active.chartCandles = [...this.active.chartCandles, candle].slice(-MAX_CANDLE_WINDOW);

        if (!before.hadPosition && state.position) {
          this.active.lastAction = state.position.side === 'long' ? 'BUY' : 'SELL';
          this.active.lastSignalReason = state.position.entryReason;
          this.active.strategyStatus = `Position opened · ${state.position.side}`;
        } else if (state.trades.length > before.tradeCount) {
          const trade = state.trades.at(-1);
          this.active.lastAction = 'EXIT';
          this.active.lastSignalReason = formatExitReason(trade.exitReason);
          this.active.strategyStatus = 'Flat · monitoring live flow';
        } else {
          this.active.lastAction = 'No Trade';
          this.active.lastSignalReason = 'No entry trigger on the latest closed candle.';
          this.active.strategyStatus = state.position ? 'Position active' : 'Monitoring live flow';
        }
      },
      currentDateLabel: (candle) => new Date(candle.time * 1000).toISOString().slice(0, 10)
    });
  }

  #persist() {
    if (!this.active) return;
    this.saveLiveState?.({
      strategyId: 0,
      status: this.active.status,
      stateJson: JSON.stringify({
        strategyRef: this.active.strategyRef,
        status: this.active.status,
        startedAt: this.active.startedAt,
        stoppedAt: this.active.stoppedAt,
        settings: this.active.settings,
        lastUpdatedAt: this.active.lastUpdatedAt
      })
    });
  }
}

function composeSnapshot(active, market) {
  const finalized = new StrategyExecutionEngine().finalizeRun({
    strategy: active.strategy,
    state: active.engineState,
    lastPrice: market.markPrice
  });
  const position = active.engineState.position ? buildPositionView(active.engineState.position, market) : buildFlatPosition(market);
  const chart = buildChartPayload({ market, active });

  return {
    status: active.status,
    symbol: active.symbol,
    mode: active.mode,
    startedAt: active.startedAt,
    stoppedAt: active.stoppedAt,
    strategy: {
      key: active.strategySummary.id,
      name: active.strategySummary.name,
      description: active.strategySummary.description,
      timeframe: active.timeframe,
      entryRules: active.strategySummary.entryRules,
      exitRules: active.strategySummary.exitRules
    },
    controls: active.settings,
    market: {
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
      markPrice: market.markPrice,
      lastClose: market.lastClose,
      candleCount: market.analysis.candles.length
    },
    position,
    performance: {
      totalTrades: finalized.metrics.totalTrades,
      wins: finalized.metrics.wins,
      losses: finalized.metrics.losses,
      winRate: finalized.metrics.winRate,
      bestTrade: finalized.metrics.bestTrade,
      worstTrade: finalized.metrics.worstTrade,
      averageTrade: finalized.metrics.averageTradePnl,
      cumulativeRealizedPnl: finalized.metrics.realizedPnl,
      cumulativeUnrealizedPnl: finalized.metrics.unrealizedPnl,
      totalPnl: finalized.metrics.netPnl,
      totalReturn: finalized.metrics.returnPct
    },
    chart,
    tradeLog: active.engineState.tradeLog.slice(0, MAX_TRADE_LOG),
    lastAction: active.lastAction,
    lastSignalReason: active.lastSignalReason,
    strategyStatus: active.strategyStatus,
    lastUpdatedAt: active.lastUpdatedAt
  };
}

function buildIdleSnapshot(market) {
  return {
    status: 'idle',
    symbol: market.symbol,
    mode: 'Paper Trading Only',
    startedAt: null,
    stoppedAt: null,
    strategy: null,
    controls: {
      orderSize: 0.001,
      stopLossPct: 0.35,
      takeProfitPct: 0.7,
      enableLong: true,
      enableShort: true
    },
    market: {
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
      markPrice: market.markPrice,
      lastClose: market.lastClose,
      candleCount: market.analysis.candles.length
    },
    position: buildFlatPosition(market),
    performance: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      bestTrade: 0,
      worstTrade: 0,
      averageTrade: 0,
      cumulativeRealizedPnl: 0,
      cumulativeUnrealizedPnl: 0,
      totalPnl: 0,
      totalReturn: 0
    },
    chart: buildChartPayload({ market, active: { engineState: { tradeLog: [], trades: [] }, chartCandles: [] } }),
    tradeLog: [],
    lastAction: 'Stopped',
    lastSignalReason: 'Start the live paper strategy to begin evaluating signals.',
    strategyStatus: 'Stopped',
    lastUpdatedAt: Date.now()
  };
}

function buildPositionView(position, market) {
  const currentMarkPrice = Number(market.markPrice || market.lastClose || position.entryPrice || 0);
  const unrealizedPnl = position.side === 'long'
    ? (currentMarkPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - currentMarkPrice) * position.quantity;

  return {
    state: position.side.toUpperCase(),
    size: position.quantity,
    entryPrice: position.entryPrice,
    currentMarkPrice,
    notionalExposure: currentMarkPrice * position.quantity,
    unrealizedPnl
  };
}

function buildFlatPosition(market) {
  return {
    state: 'Flat',
    size: 0,
    entryPrice: null,
    currentMarkPrice: market.markPrice,
    notionalExposure: 0,
    unrealizedPnl: 0
  };
}

function buildChartPayload({ market, active }) {
  const mergedCandles = new Map();

  (market.analysis.candles || []).slice(-MAX_CANDLE_WINDOW).forEach((candle) => {
    mergedCandles.set(candle.time, candle);
  });
  (active.chartCandles || []).slice(-MAX_CANDLE_WINDOW).forEach((candle) => {
    mergedCandles.set(candle.time, candle);
  });

  const candles = [...mergedCandles.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_CANDLE_WINDOW);
  const markers = (active.engineState?.tradeLog || [])
    .slice(0, MAX_TRADE_LOG)
    .map((row) => ({
      time: Math.floor(Number(row.timestamp || 0) / 1000),
      action: row.action,
      price: row.fillPrice
    }));

  return {
    candles: candles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      vwap: candle.vwap ?? candle.vwap_session ?? candle.close
    })),
    averageEntryPrice: active.engineState?.position?.entryPrice || null,
    markers
  };
}

function formatExitReason(reason) {
  const map = {
    stop_loss: 'Stop loss triggered.',
    take_profit: 'Take profit triggered.',
    signal_exit: 'Signal exit triggered.',
    end_of_day_exit: 'Position flattened at end of session.',
    max_holding_bars: 'Max holding time reached.'
  };
  return map[reason] || 'Position closed.';
}
