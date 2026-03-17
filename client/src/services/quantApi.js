async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.validation?.errors?.join(', ') || 'Request failed');
  }
  return data;
}

export const quantApi = {
  uploadStrategy: (payload) => request('/api/quant/strategy/upload', { method: 'POST', body: JSON.stringify(payload) }),
  startBacktest: (payload) => request('/api/quant/backtests', { method: 'POST', body: JSON.stringify(payload) }),
  cancelBacktest: (jobId) => request(`/api/quant/backtests/${jobId}/cancel`, { method: 'POST', body: '{}' }),
  getBacktestJob: (jobId) => request(`/api/quant/backtests/${jobId}`),
  listRuns: () => request('/api/quant/runs'),
  getLiveMetrics: () => request('/api/quant/live-metrics')
};
