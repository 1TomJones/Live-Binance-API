import React, { useEffect, useRef } from 'react';

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

export function EquityCurveChart({ equityCurve = [], height = 260 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let chart = null;

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
          barSpacing: 3
        },
        crosshair: {
          vertLine: { color: '#3a5080', labelBackgroundColor: '#182840' },
          horzLine: { color: '#3a5080', labelBackgroundColor: '#182840' }
        },
        handleScroll: true,
        handleScale: true
      });

      const areaSeries = chart.addAreaSeries({
        lineColor: '#27bb82',
        topColor: 'rgba(39,187,130,0.28)',
        bottomColor: 'rgba(39,187,130,0.02)',
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
      });

      // Baseline $10,000
      const baselineSeries = chart.addLineSeries({
        color: 'rgba(79,142,247,0.4)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        lastValueVisible: false,
        priceLineVisible: false
      });

      chartRef.current = chart;

      if (equityCurve.length) {
        const validData = equityCurve.filter((p) => p && p.time && p.value != null);
        areaSeries.setData(validData);

        // Baseline flat line
        if (validData.length >= 2) {
          baselineSeries.setData([
            { time: validData[0].time, value: 10000 },
            { time: validData[validData.length - 1].time, value: 10000 }
          ]);
        }

        chart.timeScale().fitContent();
      }
    }).catch(() => {});

    return () => {
      chart?.remove();
      chartRef.current = null;
    };
  }, [equityCurve]);

  return (
    <div style={{ position: 'relative', width: '100%', height: `${height}px`, background: '#0d1520', borderRadius: 4, overflow: 'hidden' }}>
      {equityCurve.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#4a6080', fontSize: 13
        }}>
          No equity curve data
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
