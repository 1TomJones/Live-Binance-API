export class BacktestJobService {
  constructor({
    backtestRunner,
    strategyParser,
    getStrategyById,
    createJob,
    updateJob,
    completeJob,
    failJob,
    saveResult,
    listJobProgress,
    getJobById
  }) {
    this.backtestRunner = backtestRunner;
    this.strategyParser = strategyParser;
    this.getStrategyById = getStrategyById;
    this.createJob = createJob;
    this.updateJob = updateJob;
    this.completeJob = completeJob;
    this.failJob = failJob;
    this.saveResult = saveResult;
    this.listJobProgress = listJobProgress;
    this.getJobById = getJobById;
  }

  start({ strategyId, runConfig }) {
    const job = this.createJob({ strategy_id: strategyId, run_config_json: JSON.stringify(runConfig) });
    setTimeout(() => this.#run(job.id, strategyId, runConfig), 0);
    return job;
  }

  async #run(jobId, strategyId, runConfig) {
    try {
      const strategyRecord = this.getStrategyById(strategyId);
      if (!strategyRecord) throw new Error('Strategy not found');
      const parsed = this.strategyParser.parse(strategyRecord.raw_content);
      if (!parsed.valid) throw new Error(`Strategy invalid: ${parsed.errors.join('; ')}`);

      this.updateJob(jobId, { status: 'running', progress_pct: 1, current_marker: 'Preparing backtest data' });

      const resultPayload = this.backtestRunner.run({
        strategy: parsed.strategy,
        runConfig,
        progressCallback: ({ processed, total, marker }) => {
          const dbJob = this.getJobById(jobId);
          if (!dbJob || dbJob.status === 'cancelled') throw new Error('cancelled');
          this.updateJob(jobId, {
            status: 'running',
            progress_pct: Math.min(Math.floor((processed / Math.max(total, 1)) * 100), 99),
            processed_items: processed,
            current_marker: marker
          });
        }
      });

      const result = this.saveResult({
        job_id: jobId,
        summary_json: JSON.stringify(resultPayload.metrics),
        equity_series_json: JSON.stringify(resultPayload.equitySeries),
        trade_log_json: JSON.stringify(resultPayload.trades)
      });

      this.completeJob(jobId, {
        progress_pct: 100,
        current_marker: 'Completed',
        result_id: result.id
      });
    } catch (error) {
      if (String(error.message).includes('cancelled')) return;
      this.failJob(jobId, error.message || 'Backtest job failed.');
    }
  }

  cancel(jobId) {
    this.updateJob(jobId, { status: 'cancelled', current_marker: 'Cancelled by operator' });
  }

  getProgress(jobId) {
    return this.listJobProgress(jobId);
  }
}
