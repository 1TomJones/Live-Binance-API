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
  getLiveStrategies: () => request('/api/quant/live/strategies'),
  getLiveWorkspace: () => request('/api/quant/live-metrics'),
  startLivePaper: (payload) => request('/api/quant/live/start', { method: 'POST', body: JSON.stringify(payload) }),
  stopLivePaper: () => request('/api/quant/live/stop', { method: 'POST', body: '{}' })
};
