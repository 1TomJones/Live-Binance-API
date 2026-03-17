import React, { useEffect, useRef } from 'react';

let lightweightChartsLoader = null;

function loadLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (lightweightChartsLoader) return lightweightChartsLoader;

  lightweightChartsLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';
    script.async = true;
    script.onload = () => resolve(window.LightweightCharts);
    script.onerror = () => reject(new Error('Failed to load Lightweight Charts'));
    document.head.appendChild(script);
  });

  return lightweightChartsLoader;
}

export function CandlestickChart({ candles }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    loadLightweightCharts().then((lib) => {
      if (!mounted || !containerRef.current || !lib) return;

      const chart = lib.createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { color: '#090f1a' },
          textColor: '#93a5c5',
          fontFamily: 'Inter, system-ui, sans-serif'
        },
        grid: {
          vertLines: { color: 'rgba(43, 59, 90, 0.28)' },
          horzLines: { color: 'rgba(43, 59, 90, 0.28)' }
        },
        crosshair: {
          mode: lib.CrosshairMode.Normal,
          vertLine: { color: '#42567a', width: 1, labelBackgroundColor: '#1b2a46' },
          horzLine: { color: '#42567a', width: 1, labelBackgroundColor: '#1b2a46' }
        },
        rightPriceScale: { borderColor: '#1d2a42' },
        timeScale: { borderColor: '#1d2a42', timeVisible: true, secondsVisible: false }
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#21b67a',
        downColor: '#e05262',
        borderVisible: true,
        wickUpColor: '#21b67a',
        wickDownColor: '#e05262',
        borderUpColor: '#21b67a',
        borderDownColor: '#e05262',
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
      });

      chartRef.current = chart;
      seriesRef.current = candleSeries;

      if (candles?.length) {
        candleSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      }
    }).catch(() => {
      // chart loading failure will leave the panel empty
    });

    return () => {
      mounted = false;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !candles?.length) return;
    seriesRef.current.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  }, [candles]);

  return (
    <div className="chart-wrap">
      <div className="chart-title">BTCUSDT · 1M CANDLESTICK</div>
      <div ref={containerRef} className="tv-chart" />
    </div>
  );
}
