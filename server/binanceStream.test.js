import test from 'node:test';
import assert from 'node:assert/strict';
import { BinanceStreamService } from './binanceStream.js';
import { RetryableBinanceRequestError } from './binanceHistoricalData.js';

test('depth resync delay honors Binance retry-after bans and clamps maximum', () => {
  const service = new BinanceStreamService({});

  const retryableError = new RetryableBinanceRequestError('rate limited', {
    retryAfterMs: 120_000
  });

  assert.equal(service.getDepthResyncDelayMs(retryableError), 60_000);
  assert.equal(service.getDepthResyncDelayMs(new Error('boom')), 15_000);
});

test('resyncDepth keeps process alive and schedules retry when snapshot fetch fails', async () => {
  const service = new BinanceStreamService({});
  let scheduledDelay = null;
  service.loadDepthSnapshot = async () => {
    throw new RetryableBinanceRequestError('rate limited', { retryAfterMs: 5_000 });
  };
  service.scheduleDepthSnapshotRetry = (delayMs) => {
    scheduledDelay = delayMs;
  };

  await assert.doesNotReject(async () => {
    await service.resyncDepth();
  });

  assert.equal(service.depthReady, false);
  assert.equal(scheduledDelay, 6_000);
});
