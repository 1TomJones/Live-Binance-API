import { buildSessionReplay, enrichReplayCandles } from './sessionReplayBuilder.js';

export function enrichCandlesFromTrades(trades, timeframe, settings, { sessionStartMs, nowMs } = {}) {
  return buildSessionReplay({
    timeframe,
    sessionStartMs,
    nowMs,
    trades,
    settings
  }).engineCandles;
}

export const enrichMarketCandles = enrichReplayCandles;
