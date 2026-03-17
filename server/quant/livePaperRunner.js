import { BacktestRunner } from './backtestRunner.js';

export class LivePaperRunner {
  constructor({ backtestRunner, saveLiveState, getLiveState }) {
    this.backtestRunner = backtestRunner;
    this.saveLiveState = saveLiveState;
    this.getLiveState = getLiveState;
    this.active = null;
  }

  start({ strategyId, strategy, runConfig }) {
    this.active = {
      strategyId,
      runConfig,
      strategy,
      status: 'running',
      startedAt: Date.now()
    };
    this.saveLiveState({ strategyId, status: 'running', stateJson: JSON.stringify(this.active) });
    return this.active;
  }

  stop() {
    if (!this.active) return null;
    this.active.status = 'stopped';
    this.saveLiveState({ strategyId: this.active.strategyId, status: 'stopped', stateJson: JSON.stringify(this.active) });
    const done = this.active;
    this.active = null;
    return done;
  }

  tick() {
    if (!this.active || this.active.status !== 'running') return null;
    const result = this.backtestRunner.run({
      strategy: this.active.strategy,
      runConfig: this.active.runConfig,
      progressCallback: null
    });

    const snapshot = {
      ...this.active,
      lastUpdatedAt: Date.now(),
      metrics: result.metrics,
      trades: result.trades.slice(-100),
      equitySeries: result.equitySeries.slice(-500)
    };
    this.active = snapshot;
    this.saveLiveState({ strategyId: this.active.strategyId, status: 'running', stateJson: JSON.stringify(snapshot) });
    return snapshot;
  }

  getSnapshot() {
    if (this.active) return this.active;
    const persisted = this.getLiveState();
    if (!persisted) return { status: 'idle', metrics: null, trades: [] };
    return JSON.parse(persisted.state_json);
  }
}

export function createDefaultLivePaperRunner(options) {
  const backtestRunner = new BacktestRunner({
    executionEngine: options.executionEngine,
    loadTrades: options.loadTrades
  });
  return new LivePaperRunner({
    backtestRunner,
    saveLiveState: options.saveLiveState,
    getLiveState: options.getLiveState
  });
}
