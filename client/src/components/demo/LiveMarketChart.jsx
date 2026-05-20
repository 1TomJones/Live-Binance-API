import React, { useEffect, useRef, useState } from 'react';

let lwcLoader = null;

function loadLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (lwcLoader) return lwcLoader;
  lwcLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';
    script.async = true;
    script.onload = () => resolve(window.LightweightCharts);
    script.onerror = () => reject(new Error('Failed to load Lightweight Charts'));
    document.head.appendChild(script);
  });
  return lwcLoader;
}

export function LiveMarketChart({ symbol = 'BTCUSDT', timeframe = '1h', indicators = {}, height = 340 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const emaSeriesRef = useRef(null);
  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAndUpdate = async () => {
    try {
      const res = await fetch(`/api/candles?timeframe=${timeframe}&limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!mountedRef.current) return;

      const candles = (data.candles || [])
        .filter((c) => c && c.time && c.open && c.close)
        .map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));

      if (candleSeriesRef.current && candles.length) {
        candleSeriesRef.current.setData(candles);
      }

      // EMA21 overlay from VWAP endpoint (reuse for demo)
      if (indicators.ema21 && emaSeriesRef.current) {
        try {
          const vwapRes = await fetch(`/api/indicators/vwap?timeframe=${timeframe}`);
          const vwapData = await vwapRes.json();
          if (!mountedRef.current) return;
          const series = (vwapData.series || []).filter((p) => p && p.time && p.value != null);
          emaSeriesRef.current.setData(series);
          emaSeriesRef.current.applyOptions({ visible: true });
        } catch (_) {
          // ignore vwap overlay failures
        }
      } else if (emaSeriesRef.current) {
        emaSeriesRef.current.applyOptions({ visible: false });
      }

      setLoading(false);
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let chart = null;
    let pollInterval = null;

    loadLightweightCharts().then((lib) => {
      if (!mountedRef.current || !containerRef.current) return;

      chart = lib.createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { color: '#0d1520' },
          textColor: '#7a9cc8',
          fontFamily: 'Inter, system-ui, sans-serif'
        },
        grid: {
          vertLines: { color: '#1a263d' },
          horzLines: { color: '#1a263d' }
        },
        rightPriceScale: {
          borderColor: '#1a263d',
          scaleMargins: { top: 0.08, bottom: 0.08 }
        },
        timeScale: {
          borderColor: '#1a263d',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 4,
          barSpacing: 8
        },
        crosshair: {
          vertLine: { color: '#3a5080', labelBackgroundColor: '#182840' },
          horzLine: { color: '#3a5080', labelBackgroundColor: '#182840' }
        }
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#27bb82',
        downColor: '#e35d68',
        borderVisible: true,
        wickUpColor: '#27bb82',
        wickDownColor: '#e35d68',
        borderUpColor: '#27bb82',
        borderDownColor: '#e35d68',
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
      });

      const emaSeries = chart.addLineSeries({
        color: '#4f8ef7',
        lineWidth: 1,
        visible: false,
        lastValueVisible: false,
        priceLineVisible: false
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      emaSeriesRef.current = emaSeries;

      fetchAndUpdate();
      pollInterval = setInterval(fetchAndUpdate, 30000);
    }).catch((err) => {
      if (mountedRef.current) setError(err.message);
    });

    return () => {
      clearInterval(pollInterval);
      chart?.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  return (
    <div style={{ position: 'relative', width: '100%', height: `${height}px`, background: '#0d1520', borderRadius: 4, overflow: 'hidden' }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0d1520', zIndex: 10, color: '#7a9cc8', fontSize: 13
        }}>
          <span style={{ marginRight: 8 }}>⟳</span> Loading live chart…
        </div>
      )}
      {error && !loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0d1520', zIndex: 10, color: '#e35d68', fontSize: 12, padding: 16, textAlign: 'center'
        }}>
          Chart error: {error}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
