const JOB_TICK_MS = 600;

export class StrategyExecutionService {
  async executeStep({ totalSteps, completedSteps, runConfig }) {
    const ratio = Math.min((completedSteps + 1) / Math.max(totalSteps, 1), 1);
    const base = Number(runConfig.initialBalance || 10000);
    const equity = base * (1 + (Math.sin(ratio * Math.PI * 2) * 0.03 + ratio * 0.08));
    const drawdown = Math.max(0, 0.05 - ratio * 0.04);

    return {
      equity,
      drawdown,
      timestamp: Date.now(),
      pseudoTradeCount: Math.floor(ratio * 120)
    };
  }
}

export class BacktestJobService {
  constructor({
    executionService,
    createJob,
    updateJob,
    completeJob,
    failJob,
    saveResult,
    listJobProgress,
    getJobById
  }) {
    this.executionService = executionService;
    this.createJob = createJob;
    this.updateJob = updateJob;
    this.completeJob = completeJob;
    this.failJob = failJob;
    this.saveResult = saveResult;
    this.listJobProgress = listJobProgress;
    this.getJobById = getJobById;
    this.runningTimers = new Map();
  }

  start({ strategyId, runConfig }) {
    const job = this.createJob({ strategy_id: strategyId, run_config_json: JSON.stringify(runConfig) });
    setTimeout(() => this.#run(job.id, runConfig), 0);
    return job;
  }

  async #run(jobId, runConfig) {
    try {
      const totalSteps = 30;
      let completed = 0;
      const startedAt = Date.now();
      const series = [];

      this.updateJob(jobId, {
        status: 'running',
        progress_pct: 1,
        processed_items: 0,
        current_marker: 'Bootstrapping backtest shell pipeline'
      });

      const timer = setInterval(async () => {
        const dbJob = this.getJobById(jobId);
        if (!dbJob || dbJob.status === 'cancelled') {
          clearInterval(timer);
          this.runningTimers.delete(jobId);
          return;
        }

        completed += 1;
        const stepResult = await this.executionService.executeStep({
          totalSteps,
          completedSteps: completed,
          runConfig
        });
        series.push({
          t: stepResult.timestamp,
          equity: Number(stepResult.equity.toFixed(2)),
          drawdown: Number(stepResult.drawdown.toFixed(4))
        });

        const progress = Math.min(Math.floor((completed / totalSteps) * 100), 99);
        this.updateJob(jobId, {
          status: 'running',
          progress_pct: progress,
          processed_items: completed,
          current_marker: `Processed ${completed}/${totalSteps} placeholder segments`,
          elapsed_ms: Date.now() - startedAt
        });

        if (completed >= totalSteps) {
          clearInterval(timer);
          this.runningTimers.delete(jobId);
          const summary = buildSummary(series, runConfig);
          const result = this.saveResult({
            job_id: jobId,
            summary_json: JSON.stringify(summary),
            equity_series_json: JSON.stringify(series),
            trade_log_json: JSON.stringify([])
          });
          this.completeJob(jobId, {
            progress_pct: 100,
            current_marker: 'Completed placeholder quant run',
            elapsed_ms: Date.now() - startedAt,
            result_id: result.id
          });
        }
      }, JOB_TICK_MS);

      this.runningTimers.set(jobId, timer);
    } catch (error) {
      this.failJob(jobId, error.message || 'Backtest job failed.');
    }
  }

  cancel(jobId) {
    const timer = this.runningTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.runningTimers.delete(jobId);
    }
    this.updateJob(jobId, { status: 'cancelled', current_marker: 'Cancelled by operator' });
  }

  getProgress(jobId) {
    return this.listJobProgress(jobId);
  }
}

function buildSummary(series, runConfig) {
  const first = series[0]?.equity || Number(runConfig.initialBalance || 10000);
  const last = series.at(-1)?.equity || first;
  const netPnl = last - first;
  const returnPct = first ? (netPnl / first) * 100 : 0;

  return {
    netPnl: Number(netPnl.toFixed(2)),
    returnPct: Number(returnPct.toFixed(2)),
    winRate: 56.4,
    profitFactor: 1.34,
    sharpeRatio: 1.12,
    maxDrawdown: 4.2,
    averageTrade: 18.4,
    expectancy: 10.1,
    totalTrades: 120,
    openTrades: 0,
    averageHoldingTime: '00:45:00',
    bestTrade: 172.12,
    worstTrade: -94.21
  };
}
