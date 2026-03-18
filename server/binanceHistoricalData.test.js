import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateTradeBuckets,
  buildCvdMinuteCandlesFromKlines,
  buildTradeBucketMapFromKlines
} from './binanceHistoricalData.js';

test('kline-derived replay inputs preserve aggressor flow and cumulative delta', () => {
  const minuteCandles = [
    {
      time: Date.UTC(2025, 0, 1, 0, 0, 0, 0) / 1000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
      takerBuyBaseVolume: 7,
      takerSellBaseVolume: 3,
      hasTrades: true
    },
    {
      time: Date.UTC(2025, 0, 1, 0, 1, 0, 0) / 1000,
      open: 100.5,
      high: 101,
      low: 100,
      close: 100.25,
      volume: 8,
      takerBuyBaseVolume: 2,
      takerSellBaseVolume: 6,
      hasTrades: true
    }
  ];

  assert.deepStrictEqual(buildCvdMinuteCandlesFromKlines(minuteCandles), [
    { time: minuteCandles[0].time, open: 0, high: 4, low: 0, close: 4, hasTrades: true },
    { time: minuteCandles[1].time, open: 4, high: 4, low: 0, close: 0, hasTrades: true }
  ]);

  const minuteBuckets = buildTradeBucketMapFromKlines(minuteCandles, '1m');
  assert.deepStrictEqual([...minuteBuckets.entries()], [
    [minuteCandles[0].time, { buy: 7, sell: 3 }],
    [minuteCandles[1].time, { buy: 2, sell: 6 }]
  ]);

  const fiveMinuteBuckets = aggregateTradeBuckets(minuteBuckets, '5m');
  assert.deepStrictEqual([...fiveMinuteBuckets.entries()], [
    [minuteCandles[0].time, { buy: 9, sell: 9 }]
  ]);
});
