import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

let lightweightChartsLoader = null;
const chartSocket = io();

const defaultIndicators = {
  vwap: false,
  cvd: false,
  volumeProfile: false
};

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

function CandlestickChartComponent({ symbol = 'BTCUSDT' }) {
  const containerRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const lowerContainerRef = useRef(null);

  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const vwapSeriesRef = useRef(null);
  const lowerChartRef = useRef(null);
  const cvdSeriesRef = useRef(null);

  const visibleRangeTimerRef = useRef(null);
  const snapshotRefreshTimerRef = useRef(null);

  const [timeframe, setTimeframe] = useState('1m');
  const [menuOpen, setMenuOpen] = useState(false);
  const [indicators, setIndicators] = useState(defaultIndicators);
  const [profile, setProfile] = useState([]);

  const showLowerPanel = indicators.cvd;

  const refreshVolumeProfileForVisibleRange = async () => {
    const chart = chartRef.current;
    if (!chart || !indicators.volumeProfile) return;

    const range = chart.timeScale().getVisibleRange();
    if (!range?.from || !range?.to) return;

    const response = await fetch(`/api/indicators/volume-profile?timeframe=${timeframe}&from=${Math.floor(range.from)}&to=${Math.ceil(range.to)}`);
    const payload = await response.json();

    if (import.meta.env.DEV) {
      console.debug('[volume-profile]', {
        timeframe,
        from: Math.floor(range.from),
        to: Math.ceil(range.to),
        buckets: (payload.profile || []).length
      });
    }

    setProfile(payload.profile || []);
  };

  const compactLabel = useMemo(() => {
    const enabled = Object.entries(indicators).filter(([, value]) => value).map(([key]) => key);
    return enabled.length ? `Indicators (${enabled.length})` : 'Indicators';
  }, [indicators]);

  const drawVolumeProfile = () => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const canvas = overlayCanvasRef.current;
    if (!chart || !series || !canvas || !indicators.volumeProfile) return;

    const width = containerRef.current?.clientWidth || 0;
    const height = containerRef.current?.clientHeight || 0;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    const maxWidth = width * 0.17;
    profile.forEach((bucket) => {
      const y1 = series.priceToCoordinate(bucket.price);
      const y2 = series.priceToCoordinate(bucket.price + 1);
      if (!Number.isFinite(y1) || !Number.isFinite(y2)) return;
      const top = Math.min(y1, y2);
      const barHeight = Math.max(Math.abs(y1 - y2), 1);
      const barWidth = maxWidth * bucket.ratio;
      ctx.fillStyle = 'rgba(125, 145, 182, 0.34)';
      ctx.fillRect(width - barWidth - 3, top, barWidth, barHeight);
    });
  };

  const refreshSessionSnapshot = async ({ fit = false } = {}) => {
    const response = await fetch(`/api/session/snapshot?timeframe=${timeframe}`);
    const payload = await response.json();

    const candles = (payload.candles || []).map(({ time, open, high, low, close, isPlaceholder }) => {
      if (isPlaceholder || !Number.isFinite(open) || !Number.isFinite(close)) return { time };
      return { time, open, high, low, close };
    });
    candleSeriesRef.current?.setData(candles);

    if (indicators.vwap) {
      const vwapSeries = (payload.vwap || []).map(({ time, value }) => ({ time, value }));
      vwapSeriesRef.current?.setData(vwapSeries);
    }

    if (indicators.cvd) {
      const cvdCandles = (payload.cvd || []).map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
      cvdSeriesRef.current?.setData(cvdCandles);
    }

    if (import.meta.env.DEV && payload.debug) {
      console.debug('[session/snapshot]', {
        timeframe,
        candles: payload.debug.sessionCandleCount,
        hydrated: payload.debug.hydratedCandleCount,
        placeholders: payload.debug.placeholderCandleCount,
        realOhlcVariance: payload.debug.realOhlcVariance,
        hydrationStatus: payload.debug.hydration?.status,
        counts: payload.debug.timeframeCounts,
        sessionStartIso: payload.sessionStartIso,
        vwapHasVariance: payload.debug.vwapHasVariance,
        cvdBarsWithTrades: payload.debug.cvdBarsWithTrades
      });
    }

    if (fit) chartRef.current?.timeScale().fitContent();
    drawVolumeProfile();
  };

  useEffect(() => {
    let mounted = true;
    let resizeObserver;

    loadLightweightCharts().then((lib) => {
      if (!mounted || !containerRef.current || !lib) return;

      const chart = lib.createChart(containerRef.current, {
        autoSize: true,
        layout: { background: { color: '#070d18' }, textColor: '#8fa7cc', fontFamily: 'Inter, system-ui, sans-serif' },
        grid: { vertLines: { color: 'rgba(37, 52, 79, 0.35)' }, horzLines: { color: 'rgba(37, 52, 79, 0.35)' } },
        rightPriceScale: { borderColor: '#1b2a43', scaleMargins: { top: 0.08, bottom: 0.12 } },
        timeScale: { borderColor: '#1b2a43', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 9 }
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#27ba81', downColor: '#dc5b66', borderVisible: true, wickUpColor: '#27ba81', wickDownColor: '#dc5b66', borderUpColor: '#27ba81', borderDownColor: '#dc5b66', priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
      });

      const vwapSeries = chart.addLineSeries({ color: '#93b6ff', lineWidth: 2, visible: false, lastValueVisible: false, priceLineVisible: false });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      vwapSeriesRef.current = vwapSeries;

      resizeObserver = new ResizeObserver(() => {
        chart.timeScale().fitContent();
        drawVolumeProfile();
      });
      resizeObserver.observe(containerRef.current);

      if (lowerContainerRef.current) {
        const lowerChart = lib.createChart(lowerContainerRef.current, {
          autoSize: true,
          layout: { background: { color: '#070d18' }, textColor: '#8199c1', fontFamily: 'Inter, system-ui, sans-serif' },
          grid: { vertLines: { color: 'rgba(30, 43, 66, 0.2)' }, horzLines: { color: 'rgba(30, 43, 66, 0.2)' } },
          rightPriceScale: { borderColor: '#1b2a43', scaleMargins: { top: 0.18, bottom: 0.12 } },
          timeScale: { borderColor: '#1b2a43', timeVisible: true, secondsVisible: false }
        });

        const cvdSeries = lowerChart.addCandlestickSeries({
          upColor: '#d6a649',
          downColor: '#7f8eb0',
          wickUpColor: '#d6a649',
          wickDownColor: '#7f8eb0',
          borderUpColor: '#d6a649',
          borderDownColor: '#7f8eb0',
          visible: false,
          priceLineVisible: false
        });

        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          lowerChart.timeScale().setVisibleLogicalRange(range);
        });

        lowerChartRef.current = lowerChart;
        cvdSeriesRef.current = cvdSeries;
      }

      refreshSessionSnapshot({ fit: true });
    }).catch(() => {});

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      chartRef.current?.remove();
      lowerChartRef.current?.remove();
      chartRef.current = null;
      lowerChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    refreshSessionSnapshot({ fit: true });
  }, [timeframe]);

  useEffect(() => {
    if (!vwapSeriesRef.current) return;
    vwapSeriesRef.current.applyOptions({ visible: indicators.vwap });
    if (!indicators.vwap) vwapSeriesRef.current.setData([]);
    refreshSessionSnapshot();
  }, [indicators.vwap]);

  useEffect(() => {
    if (!cvdSeriesRef.current) return;
    cvdSeriesRef.current.applyOptions({ visible: indicators.cvd });
    if (!indicators.cvd) cvdSeriesRef.current.setData([]);
    refreshSessionSnapshot();
  }, [indicators.cvd]);

  useEffect(() => {
    const onTrade = () => {
      if (snapshotRefreshTimerRef.current) return;
      snapshotRefreshTimerRef.current = window.setTimeout(() => {
        snapshotRefreshTimerRef.current = null;
        refreshSessionSnapshot();
        refreshVolumeProfileForVisibleRange();
      }, 250);
    };

    chartSocket.on('trade', onTrade);
    return () => {
      chartSocket.off('trade', onTrade);
      if (snapshotRefreshTimerRef.current) window.clearTimeout(snapshotRefreshTimerRef.current);
    };
  }, [timeframe, indicators.vwap, indicators.cvd, indicators.volumeProfile]);

  useEffect(() => {
    drawVolumeProfile();
  }, [profile, indicators.volumeProfile]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !indicators.volumeProfile) return;

    const onRangeChange = () => {
      if (visibleRangeTimerRef.current) window.clearTimeout(visibleRangeTimerRef.current);
      visibleRangeTimerRef.current = window.setTimeout(() => {
        refreshVolumeProfileForVisibleRange();
      }, 250);
    };

    onRangeChange();
    chart.timeScale().subscribeVisibleTimeRangeChange(onRangeChange);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRangeChange);
      if (visibleRangeTimerRef.current) window.clearTimeout(visibleRangeTimerRef.current);
    };
  }, [timeframe, indicators.volumeProfile]);

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-title">{symbol} · CANDLESTICK</div>
        <div className="chart-controls">
          <div className="timeframe-switcher">
            {['1m', '5m', '15m', '1h'].map((option) => (
              <button key={option} type="button" className={timeframe === option ? 'active' : ''} onClick={() => setTimeframe(option)}>{option}</button>
            ))}
          </div>
          <div className="indicator-menu-wrap">
            <button type="button" className="indicator-menu-btn" onClick={() => setMenuOpen((prev) => !prev)}>{compactLabel}</button>
            {menuOpen && (
              <div className="indicator-menu">
                {Object.keys(defaultIndicators).map((key) => (
                  <label key={key}>
                    <input type="checkbox" checked={indicators[key]} onChange={() => setIndicators((prev) => ({ ...prev, [key]: !prev[key] }))} />
                    {key.replace(/([A-Z])/g, ' $1').toUpperCase()}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tv-chart-frame">
        <div ref={containerRef} className="tv-chart" />
        <canvas ref={overlayCanvasRef} className="chart-overlay" />
      </div>

      <div className={`lower-panel ${showLowerPanel ? 'visible' : ''}`}>
        <div ref={lowerContainerRef} className="tv-chart lower" />
      </div>
    </div>
  );
}

export const CandlestickChart = memo(CandlestickChartComponent);
