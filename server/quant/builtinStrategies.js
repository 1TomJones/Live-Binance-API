export const LIVE_STRATEGY_DEFINITIONS = {
  VWAP_CVD_Live_Trend_01: {
    key: 'VWAP_CVD_Live_Trend_01',
    name: 'VWAP_CVD_Live_Trend_01',
    label: 'VWAP_CVD_Live_Trend_01',
    symbol: 'BTCUSDT',
    timeframe: '1m',
    description: 'Live paper trend follower using session VWAP alignment and rising/falling CVD confirmation.',
    entryRules: {
      long: 'close > VWAP and current CVD > previous CVD while flat',
      short: 'close < VWAP and current CVD < previous CVD while flat'
    },
    exitRules: {
      long: 'close < VWAP or stop loss or take profit',
      short: 'close > VWAP or stop loss or take profit'
    }
  }
};

export function listBuiltInLiveStrategies() {
  return Object.values(LIVE_STRATEGY_DEFINITIONS);
}

export function getBuiltInLiveStrategy(strategyKey) {
  return LIVE_STRATEGY_DEFINITIONS[strategyKey] || null;
}
