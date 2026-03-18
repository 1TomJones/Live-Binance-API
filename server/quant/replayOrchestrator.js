export function buildLiveClosedCandleReplay({ state, closedCandles = [] } = {}) {
  if (!closedCandles.length) {
    return { pendingCandles: [], seededPreviousCandle: false };
  }

  const pendingCandles = state.lastProcessedCandleTime == null
    ? closedCandles.slice(-1)
    : closedCandles.filter((candle) => candle.time > state.lastProcessedCandleTime);

  const seededPreviousCandle = seedPreviousCandle({
    state,
    closedCandles,
    firstPendingCandle: pendingCandles[0]
  });

  return {
    pendingCandles,
    seededPreviousCandle
  };
}

export function buildHistoricalClosedCandleReplay({ state, closedCandles = [] } = {}) {
  if (!closedCandles.length) {
    return { pendingCandles: [], seededPreviousCandle: false };
  }

  const pendingCandles = state.lastProcessedCandleTime == null
    ? closedCandles.slice(1)
    : closedCandles.filter((candle) => candle.time > state.lastProcessedCandleTime);

  const seededPreviousCandle = seedPreviousCandle({
    state,
    closedCandles,
    firstPendingCandle: pendingCandles[0] || closedCandles[0]
  });

  return {
    pendingCandles,
    seededPreviousCandle
  };
}

export function runClosedCandleReplay({
  strategy,
  state,
  candles = [],
  executionEngine,
  fillModel,
  currentDateLabel,
  onCandle,
  finalizeSession = false,
  onSessionFinalized
} = {}) {
  candles.forEach((candle, candleIndex) => {
    const before = {
      tradeCount: state.trades.length,
      hadPosition: Boolean(state.position)
    };

    const resolvedDateLabel = typeof currentDateLabel === 'function'
      ? currentDateLabel(candle, candleIndex)
      : currentDateLabel;

    const outcome = executionEngine.processCandle({
      strategy,
      state,
      candle,
      fillModel,
      currentDateLabel: resolvedDateLabel
    });

    onCandle?.({
      candle,
      candleIndex,
      outcome,
      before,
      state
    });
  });

  if (!finalizeSession) return null;

  const endOfDayClose = executionEngine.finalizeDay({
    strategy,
    state,
    fillModel,
    dateLabel: currentDateLabel
  });

  onSessionFinalized?.({
    currentDateLabel,
    endOfDayClose,
    state
  });

  return endOfDayClose;
}

function seedPreviousCandle({ state, closedCandles = [], firstPendingCandle } = {}) {
  if (
    state.lastProcessedCandleTime != null
    || state.session.previousCandle
    || !closedCandles.length
    || !firstPendingCandle
  ) {
    return false;
  }

  const seedIndex = closedCandles.findIndex((candle) => candle.time === firstPendingCandle.time);
  const seedCandle = seedIndex > 0 ? closedCandles[seedIndex - 1] : null;
  if (!seedCandle) return false;

  state.session.previousCandle = seedCandle;
  return true;
}
