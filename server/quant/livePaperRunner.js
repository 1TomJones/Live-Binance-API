import { getBuiltInLiveStrategy } from './builtinStrategies.js';

const DEFAULT_INITIAL_BALANCE = 10000;
const ORDER_SIZE_MIN = 0.0001;
const ORDER_SIZE_MAX = 0.005;
const ORDER_SIZE_STEP = 0.0001;
const MAX_CANDLE_WINDOW = 100;
const MAX_TRADE_LOG = 200;
const ROUND_TRIP_PRECISION = 8;

export class LivePaperRunner {
  constructor({ getMarketSnapshot, saveLiveState, getLiveState }) {
    this.getMarketSnapshot = getMarketSnapshot;
    this.saveLiveState = saveLiveState;
    this.getLiveState = getLiveState;
    this.active = null;
  }

  start({ strategyKey, runConfig = {} }) {
    const strategy = getBuiltInLiveStrategy(strategyKey);
    if (!strategy) {
      throw new Error(`Unknown built-in live strategy: ${strategyKey}`);
    }

    const settings = normalizeRunConfig(runConfig);
    const state = {
      strategyKey: strategy.key,
      strategyName: strategy.name,
      strategy,
      symbol: strategy.symbol,
      timeframe: strategy.timeframe,
      mode: 'Paper Trading Only',
      startedAt: Date.now(),
      stoppedAt: null,
      status: 'running',
      settings,
      initialBalance: DEFAULT_INITIAL_BALANCE,
      position: null,
      closedTrades: [],
      tradeLog: [],
      lastAction: 'Waiting',
      lastSignalReason: 'Waiting for the next closed candle.',
      strategyStatus: 'Monitoring live flow',
      lastProcessedCandleTime: null,
      lastUpdatedAt: Date.now()
    };

    this.active = state;
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
    if (this.active) {
      return composeSnapshot(this.active, market);
    }

    const persisted = this.getLiveState?.();
    if (persisted?.state_json) {
      try {
        const parsed = JSON.parse(persisted.state_json);
        if (parsed) {
          this.active = parsed;
          return composeSnapshot(parsed, market);
        }
      } catch {
        // ignore invalid persisted state
      }
    }

    return buildIdleSnapshot(market);
  }

  #evaluate(market) {
    const closedCandles = market.analysis.closedCandles;
    if (!closedCandles.length) {
      this.active.lastSignalReason = 'Awaiting enough live candle history.';
      this.active.strategyStatus = 'Warming up';
      return;
    }

    const pendingCandles = this.active.lastProcessedCandleTime == null
      ? closedCandles.slice(-1)
      : closedCandles.filter((candle) => candle.time > this.active.lastProcessedCandleTime);

    if (!pendingCandles.length) {
      this.active.strategyStatus = this.active.status === 'running' ? 'Monitoring live flow' : 'Stopped';
      return;
    }

    pendingCandles.forEach((candle) => {
      this.#processCandle(candle, market);
      this.active.lastProcessedCandleTime = candle.time;
    });
  }

  #processCandle(candle, market) {
    const { settings } = this.active;
    const close = Number(candle.close);
    const vwap = Number(candle.vwap ?? close);
    const currentCvd = Number(candle.cvd_close ?? 0);
    const previousCvd = Number(candle.prev_cvd_close ?? currentCvd);
    const timestampMs = Number(candle.time) * 1000;

    if (this.active.position) {
      const exitReason = getExitReason({ position: this.active.position, close, vwap, settings });
      if (exitReason) {
        const exitPrice = this.active.position.side === 'long'
          ? market.bestBid ?? market.markPrice ?? close
          : market.bestAsk ?? market.markPrice ?? close;
        this.#closePosition({ candle, timestampMs, price: exitPrice, reason: exitReason });
        return;
      }

      this.active.lastAction = 'Hold';
      this.active.lastSignalReason = `${this.active.position.side.toUpperCase()} open · monitoring for VWAP/SL/TP exit.`;
      this.active.strategyStatus = 'Position active';
      return;
    }

    if (settings.enableLong && close > vwap && currentCvd > previousCvd) {
      const entryPrice = market.bestAsk ?? market.markPrice ?? close;
      this.#openPosition({ candle, timestampMs, side: 'long', action: 'BUY', price: entryPrice, reason: 'Close above VWAP with rising CVD.' });
      return;
    }

    if (settings.enableShort && close < vwap && currentCvd < previousCvd) {
      const entryPrice = market.bestBid ?? market.markPrice ?? close;
      this.#openPosition({ candle, timestampMs, side: 'short', action: 'SELL', price: entryPrice, reason: 'Close below VWAP with falling CVD.' });
      return;
    }

    this.active.lastAction = 'No Trade';
    this.active.lastSignalReason = 'No entry trigger on the latest closed candle.';
    this.active.strategyStatus = 'Monitoring live flow';
  }

  #openPosition({ candle, timestampMs, side, action, price, reason }) {
    const quantity = this.active.settings.orderSize;
    const roundedPrice = round(price, 2);
    this.active.position = {
      side,
      quantity,
      entryPrice: roundedPrice,
      entryTime: timestampMs,
      entryCandleTime: candle.time,
      entryReason: reason,
      lastUpdateTime: timestampMs
    };
    this.active.tradeLog = trimLog([
      {
        id: `${timestampMs}-${action}-${this.active.tradeLog.length}`,
        timestamp: timestampMs,
        candleTime: candle.time,
        action,
        side,
        size: quantity,
        fillPrice: roundedPrice,
        reason,
        resultingPosition: side === 'long' ? `Long ${quantity.toFixed(4)}` : `Short ${quantity.toFixed(4)}`,
        realizedPnl: null
      },
      ...this.active.tradeLog
    ]);
    this.active.lastAction = action;
    this.active.lastSignalReason = reason;
    this.active.strategyStatus = `Position opened · ${side}`;
  }

  #closePosition({ candle, timestampMs, price, reason }) {
    const position = this.active.position;
    if (!position) return;

    const roundedPrice = round(price, 2);
    const realizedPnl = round(calcRealizedPnl(position, roundedPrice), 2);
    const closedTrade = {
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice: roundedPrice,
      entryTime: position.entryTime,
      exitTime: timestampMs,
      realizedPnl,
      reason,
      holdingBars: Math.max((candle.time - position.entryCandleTime) / 60, 1)
    };

    const exitAction = 'EXIT';
    this.active.closedTrades.push(closedTrade);
    this.active.tradeLog = trimLog([
      {
        id: `${timestampMs}-${exitAction}-${this.active.tradeLog.length}`,
        timestamp: timestampMs,
        candleTime: candle.time,
        action: exitAction,
        side: position.side,
        size: position.quantity,
        fillPrice: roundedPrice,
        reason,
        resultingPosition: 'Flat',
        realizedPnl
      },
      ...this.active.tradeLog
    ]);
    this.active.position = null;
    this.active.lastAction = exitAction;
    this.active.lastSignalReason = reason;
    this.active.strategyStatus = 'Flat · monitoring live flow';
  }

  #persist() {
    if (!this.active) return;
    this.saveLiveState?.({
      strategyId: 0,
      status: this.active.status,
      stateJson: JSON.stringify(this.active)
    });
  }
}

function composeSnapshot(active, market) {
  const position = active.position ? buildPositionView(active.position, market) : buildFlatPosition(market);
  const performance = buildPerformance(active, market.markPrice);
  const chart = buildChartPayload({ market, active });

  return {
    status: active.status,
    symbol: active.symbol,
    mode: active.mode,
    startedAt: active.startedAt,
    stoppedAt: active.stoppedAt,
    strategy: {
      key: active.strategyKey,
      name: active.strategyName,
      description: active.strategy.description,
      timeframe: active.timeframe,
      entryRules: active.strategy.entryRules,
      exitRules: active.strategy.exitRules
    },
    controls: {
      orderSize: active.settings.orderSize,
      stopLossPct: active.settings.stopLossPct,
      takeProfitPct: active.settings.takeProfitPct,
      enableLong: active.settings.enableLong,
      enableShort: active.settings.enableShort
    },
    market: {
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
      markPrice: market.markPrice,
      lastClose: market.lastClose,
      candleCount: market.analysis.candles.length
    },
    position,
    performance,
    chart,
    tradeLog: active.tradeLog,
    lastAction: active.lastAction,
    lastSignalReason: active.lastSignalReason,
    strategyStatus: active.strategyStatus,
    lastUpdatedAt: active.lastUpdatedAt
  };
}

function buildIdleSnapshot(market) {
  const chart = buildChartPayload({
    market,
    active: {
      position: null,
      tradeLog: [],
      closedTrades: []
    }
  });

  return {
    status: 'idle',
    symbol: market.symbol,
    mode: 'Paper Trading Only',
    startedAt: null,
    stoppedAt: null,
    strategy: {
      key: 'VWAP_CVD_Live_Trend_01',
      name: 'VWAP_CVD_Live_Trend_01',
      description: getBuiltInLiveStrategy('VWAP_CVD_Live_Trend_01')?.description || '',
      timeframe: '1m',
      entryRules: getBuiltInLiveStrategy('VWAP_CVD_Live_Trend_01')?.entryRules || {},
      exitRules: getBuiltInLiveStrategy('VWAP_CVD_Live_Trend_01')?.exitRules || {}
    },
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
    performance: buildPerformance({ initialBalance: DEFAULT_INITIAL_BALANCE, closedTrades: [], position: null }, market.markPrice),
    chart,
    tradeLog: [],
    lastAction: 'Stopped',
    lastSignalReason: 'Start the live paper strategy to begin evaluating signals.',
    strategyStatus: 'Stopped',
    lastUpdatedAt: Date.now()
  };
}

function buildChartPayload({ market, active }) {
  const candles = market.analysis.candles.slice(-MAX_CANDLE_WINDOW).map((candle) => ({
    time: candle.time,
    open: round(candle.open, 2),
    high: round(candle.high, 2),
    low: round(candle.low, 2),
    close: round(candle.close, 2),
    vwap: round(candle.vwap ?? candle.close, 2)
  }));

  const visibleTimes = new Set(candles.map((candle) => candle.time));
  const markers = (active.tradeLog || [])
    .filter((row) => visibleTimes.has(row.candleTime))
    .map((row) => ({
      time: row.candleTime,
      action: row.action,
      side: row.side,
      price: round(row.fillPrice, 2),
      reason: row.reason
    }));

  return {
    candles,
    markers,
    averageEntryPrice: active.position ? round(active.position.entryPrice, 2) : null
  };
}

function buildPositionView(position, market) {
  const markPrice = market.markPrice;
  const notionalExposure = markPrice ? markPrice * position.quantity : position.entryPrice * position.quantity;
  const unrealizedPnl = markPrice ? calcRealizedPnl(position, markPrice) : 0;

  return {
    state: position.side === 'long' ? 'Long' : 'Short',
    size: round(position.quantity, 4),
    entryPrice: round(position.entryPrice, 2),
    currentMarkPrice: round(markPrice, 2),
    notionalExposure: round(notionalExposure, 2),
    unrealizedPnl: round(unrealizedPnl, 2),
    entryTime: position.entryTime
  };
}

function buildFlatPosition(market) {
  return {
    state: 'Flat',
    size: 0,
    entryPrice: null,
    currentMarkPrice: round(market.markPrice, 2),
    notionalExposure: 0,
    unrealizedPnl: 0,
    entryTime: null
  };
}

function buildPerformance(active, markPrice) {
  const closedTrades = active.closedTrades || [];
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + Number(trade.realizedPnl || 0), 0);
  const unrealizedPnl = active.position && markPrice ? calcRealizedPnl(active.position, markPrice) : 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const wins = closedTrades.filter((trade) => trade.realizedPnl > 0).length;
  const losses = closedTrades.filter((trade) => trade.realizedPnl < 0).length;
  const tradePnls = closedTrades.map((trade) => Number(trade.realizedPnl || 0));

  return {
    totalTrades: closedTrades.length,
    wins,
    losses,
    winRate: round((wins / Math.max(closedTrades.length, 1)) * 100, 2),
    bestTrade: round(tradePnls.length ? Math.max(...tradePnls) : 0, 2),
    worstTrade: round(tradePnls.length ? Math.min(...tradePnls) : 0, 2),
    averageTrade: round(tradePnls.length ? tradePnls.reduce((sum, value) => sum + value, 0) / tradePnls.length : 0, 2),
    cumulativeRealizedPnl: round(realizedPnl, 2),
    cumulativeUnrealizedPnl: round(unrealizedPnl, 2),
    totalPnl: round(totalPnl, 2),
    totalReturn: round((totalPnl / DEFAULT_INITIAL_BALANCE) * 100, 2)
  };
}

function calcRealizedPnl(position, exitPrice) {
  if (position.side === 'long') return (exitPrice - position.entryPrice) * position.quantity;
  return (position.entryPrice - exitPrice) * position.quantity;
}

function getExitReason({ position, close, vwap, settings }) {
  if (position.side === 'long') {
    if (close < vwap) return 'Exit long: close slipped below VWAP.';
    if (close <= position.entryPrice * (1 - settings.stopLossPct / 100)) return 'Exit long: stop loss hit.';
    if (close >= position.entryPrice * (1 + settings.takeProfitPct / 100)) return 'Exit long: take profit hit.';
    return null;
  }

  if (close > vwap) return 'Exit short: close reclaimed VWAP.';
  if (close >= position.entryPrice * (1 + settings.stopLossPct / 100)) return 'Exit short: stop loss hit.';
  if (close <= position.entryPrice * (1 - settings.takeProfitPct / 100)) return 'Exit short: take profit hit.';
  return null;
}

function normalizeRunConfig(runConfig) {
  const orderSize = Number(runConfig.orderSize ?? 0.001);
  const stopLossPct = Number(runConfig.stopLossPct ?? 0.35);
  const takeProfitPct = Number(runConfig.takeProfitPct ?? 0.7);
  const enableLong = runConfig.enableLong !== false;
  const enableShort = runConfig.enableShort !== false;

  if (!Number.isFinite(orderSize) || orderSize < ORDER_SIZE_MIN || orderSize > ORDER_SIZE_MAX) {
    throw new Error(`orderSize must be between ${ORDER_SIZE_MIN.toFixed(4)} and ${ORDER_SIZE_MAX.toFixed(4)} BTC.`);
  }

  const stepped = Math.round(orderSize / ORDER_SIZE_STEP) * ORDER_SIZE_STEP;
  if (Math.abs(stepped - orderSize) > 1e-9) {
    throw new Error(`orderSize must use ${ORDER_SIZE_STEP.toFixed(4)} BTC increments.`);
  }

  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0 || stopLossPct > 25) {
    throw new Error('stopLossPct must be greater than 0 and no more than 25.');
  }

  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0 || takeProfitPct > 25) {
    throw new Error('takeProfitPct must be greater than 0 and no more than 25.');
  }

  if (!enableLong && !enableShort) {
    throw new Error('At least one trade direction must be enabled.');
  }

  return {
    orderSize: round(orderSize, 4),
    stopLossPct: round(stopLossPct, 2),
    takeProfitPct: round(takeProfitPct, 2),
    enableLong,
    enableShort
  };
}

function trimLog(rows) {
  return rows.slice(0, MAX_TRADE_LOG);
}

function round(value, decimals = 2) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

export const LIVE_PAPER_LIMITS = {
  orderSizeMin: ORDER_SIZE_MIN,
  orderSizeMax: ORDER_SIZE_MAX,
  orderSizeStep: ORDER_SIZE_STEP,
  initialBalance: DEFAULT_INITIAL_BALANCE,
  precision: ROUND_TRIP_PRECISION
};
