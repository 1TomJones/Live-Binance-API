import React, { useEffect, useMemo, useRef, useState } from 'react';

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

const defaultIndicators = {
  vwap: false,
  cvd: false,
  imbalance: false,
  volumeProfile: false,
  heatmap: false
};

export function CandlestickChart({ symbol = 'BTCUSDT', depth }) {
  const containerRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const lowerContainerRef = useRef(null);

  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const vwapSeriesRef = useRef(null);
  const lowerChartRef = useRef(null);
  const cvdSeriesRef = useRef(null);
  const imbalanceSeriesRef = useRef(null);

  const [timeframe, setTimeframe] = useState('1m');
  const [menuOpen, setMenuOpen] = useState(false);
  const [indicators, setIndicators] = useState(defaultIndicators);

  const [candles, setCandles] = useState([]);
  const [vwapData, setVwapData] = useState([]);
  const [cvdData, setCvdData] = useState([]);
  const [imbalanceData, setImbalanceData] = useState([]);
  const [volumeProfile, setVolumeProfile] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);

  const showLowerPanel = indicators.cvd || indicators.imbalance;

  const compactLabel = useMemo(() => {
    const enabled = Object.entries(indicators).filter(([, value]) => value).map(([key]) => key);
    return enabled.length ? `Indicators (${enabled.length})` : 'Indicators';
  }, [indicators]);

  const fetchCandles = async () => {
    const response = await fetch(`/api/candles?timeframe=${timeframe}&limit=500`);
    const payload = await response.json();
    setCandles(payload.candles || []);
  };

  useEffect(() => {
    fetchCandles();
    const timer = setInterval(fetchCandles, 3000);
    return () => clearInterval(timer);
  }, [timeframe]);

  useEffect(() => {
    if (!indicators.vwap) {
      setVwapData([]);
      return;
    }

    const loadVwap = async () => {
      const response = await fetch(`/api/indicators/vwap?timeframe=${timeframe}&limit=500`);
      const payload = await response.json();
      setVwapData(payload.series || []);
    };

    loadVwap();
    const timer = setInterval(loadVwap, 3500);
    return () => clearInterval(timer);
  }, [indicators.vwap, timeframe, candles.length]);

  useEffect(() => {
    if (!indicators.cvd) {
      setCvdData([]);
      return;
    }

    const loadCvd = async () => {
      const response = await fetch(`/api/indicators/cvd?timeframe=${timeframe}`);
      const payload = await response.json();
      setCvdData(payload.series || []);
    };

    loadCvd();
    const timer = setInterval(loadCvd, 3500);
    return () => clearInterval(timer);
  }, [indicators.cvd, timeframe]);

  useEffect(() => {
    if (!indicators.imbalance) {
      setImbalanceData([]);
      return;
    }

    const loadImbalance = async () => {
      const response = await fetch('/api/indicators/imbalance?levels=20');
      const payload = await response.json();
      if (!payload.snapshot) return;
      setImbalanceData((prev) => {
        const point = {
          time: Math.floor(payload.snapshot.ts / 1000),
          value: payload.snapshot.value
        };
        return [...prev, point].slice(-600);
      });
    };

    loadImbalance();
    const timer = setInterval(loadImbalance, 1200);
    return () => clearInterval(timer);
  }, [indicators.imbalance, depth?.ts]);

  useEffect(() => {
    if (!indicators.volumeProfile) {
      setVolumeProfile([]);
      return;
    }

    const loadProfile = async () => {
      const response = await fetch('/api/indicators/volume-profile?bins=30');
      const payload = await response.json();
      setVolumeProfile(payload.profile || []);
    };

    loadProfile();
    const timer = setInterval(loadProfile, 4000);
    return () => clearInterval(timer);
  }, [indicators.volumeProfile, candles.length]);

  useEffect(() => {
    if (!indicators.heatmap) {
      setHeatmapData([]);
      return;
    }

    const loadHeatmap = async () => {
      const response = await fetch('/api/indicators/liquidity-heatmap?levels=55');
      const payload = await response.json();
      setHeatmapData(payload.heatmap || []);
    };

    loadHeatmap();
    const timer = setInterval(loadHeatmap, 1500);
    return () => clearInterval(timer);
  }, [indicators.heatmap, depth?.ts]);

  useEffect(() => {
    let mounted = true;
    let resizeObserver;

    loadLightweightCharts().then((lib) => {
      if (!mounted || !containerRef.current || !lib) return;

      const chart = lib.createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { color: '#070d18' },
          textColor: '#8fa7cc',
          fontFamily: 'Inter, system-ui, sans-serif'
        },
        grid: {
          vertLines: { color: 'rgba(37, 52, 79, 0.35)' },
          horzLines: { color: 'rgba(37, 52, 79, 0.35)' }
        },
        crosshair: {
          mode: lib.CrosshairMode.Normal,
          vertLine: { color: '#3e5478', width: 1, labelBackgroundColor: '#101d33' },
          horzLine: { color: '#3e5478', width: 1, labelBackgroundColor: '#101d33' }
        },
        rightPriceScale: { borderColor: '#1b2a43', scaleMargins: { top: 0.08, bottom: 0.12 } },
        timeScale: { borderColor: '#1b2a43', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 9 }
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#27ba81',
        downColor: '#dc5b66',
        borderVisible: true,
        wickUpColor: '#27ba81',
        wickDownColor: '#dc5b66',
        borderUpColor: '#27ba81',
        borderDownColor: '#dc5b66',
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
      });

      const vwapSeries = chart.addLineSeries({
        color: '#93b6ff',
        lineWidth: 2,
        visible: false,
        lastValueVisible: false,
        priceLineVisible: false
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      vwapSeriesRef.current = vwapSeries;

      resizeObserver = new ResizeObserver(() => {
        chart.timeScale().fitContent();
      });
      resizeObserver.observe(containerRef.current);

      if (lowerContainerRef.current) {
        const lowerChart = lib.createChart(lowerContainerRef.current, {
          autoSize: true,
          layout: {
            background: { color: '#070d18' },
            textColor: '#8199c1',
            fontFamily: 'Inter, system-ui, sans-serif'
          },
          grid: {
            vertLines: { color: 'rgba(30, 43, 66, 0.2)' },
            horzLines: { color: 'rgba(30, 43, 66, 0.2)' }
          },
          rightPriceScale: { borderColor: '#1b2a43', scaleMargins: { top: 0.18, bottom: 0.12 } },
          timeScale: { borderColor: '#1b2a43', timeVisible: true, secondsVisible: false }
        });

        const cvdSeries = lowerChart.addLineSeries({
          color: '#f0c75e',
          lineWidth: 2,
          visible: false,
          priceLineVisible: false
        });

        const imbalanceSeries = lowerChart.addHistogramSeries({
          color: '#6ea8ff',
          visible: false,
          priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
          priceLineVisible: false,
          base: 0
        });

        lowerChartRef.current = lowerChart;
        cvdSeriesRef.current = cvdSeries;
        imbalanceSeriesRef.current = imbalanceSeries;
      }
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
    if (!candleSeriesRef.current) return;
    candleSeriesRef.current.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    chartRef.current?.timeScale().fitContent();
  }, [candles, timeframe]);

  useEffect(() => {
    if (!vwapSeriesRef.current) return;
    vwapSeriesRef.current.applyOptions({ visible: indicators.vwap });
    if (indicators.vwap) vwapSeriesRef.current.setData(vwapData);
    else vwapSeriesRef.current.setData([]);
  }, [indicators.vwap, vwapData]);

  useEffect(() => {
    if (!cvdSeriesRef.current) return;
    cvdSeriesRef.current.applyOptions({ visible: indicators.cvd });
    cvdSeriesRef.current.setData(indicators.cvd ? cvdData : []);
    lowerChartRef.current?.timeScale().fitContent();
  }, [indicators.cvd, cvdData]);

  useEffect(() => {
    if (!imbalanceSeriesRef.current) return;
    imbalanceSeriesRef.current.applyOptions({ visible: indicators.imbalance });
    const mapped = indicators.imbalance
      ? imbalanceData.map((p) => ({ ...p, color: p.value >= 0 ? '#2fb87f88' : '#d45d6788' }))
      : [];
    imbalanceSeriesRef.current.setData(mapped);
    lowerChartRef.current?.timeScale().fitContent();
  }, [indicators.imbalance, imbalanceData]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const redraw = () => {
      const width = containerRef.current?.clientWidth || 0;
      const height = containerRef.current?.clientHeight || 0;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      if (indicators.heatmap) {
        heatmapData.forEach((level) => {
          const y = series.priceToCoordinate(level.price);
          if (!Number.isFinite(y)) return;
          const color = level.side === 'bid' ? `rgba(54, 168, 112, ${0.08 + 0.3 * level.intensity})` : `rgba(198, 76, 86, ${0.08 + 0.3 * level.intensity})`;
          ctx.fillStyle = color;
          ctx.fillRect(0, y - 1, width, 2);
        });
      }

      if (indicators.volumeProfile) {
        const maxWidth = width * 0.17;
        volumeProfile.forEach((bin) => {
          const y1 = series.priceToCoordinate(bin.priceStart);
          const y2 = series.priceToCoordinate(bin.priceEnd);
          if (!Number.isFinite(y1) || !Number.isFinite(y2)) return;
          const top = Math.min(y1, y2);
          const h = Math.max(Math.abs(y1 - y2), 1);
          const barWidth = maxWidth * bin.ratio;
          ctx.fillStyle = 'rgba(125, 145, 182, 0.34)';
          ctx.fillRect(width - barWidth - 3, top, barWidth, h);
        });
      }
    };

    redraw();
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    const resizeObs = new ResizeObserver(redraw);
    if (containerRef.current) resizeObs.observe(containerRef.current);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
      resizeObs.disconnect();
    };
  }, [indicators.heatmap, indicators.volumeProfile, heatmapData, volumeProfile, candles.length]);

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-title">{symbol} · CANDLESTICK</div>
        <div className="chart-controls">
          <div className="timeframe-switcher">
            {['1m', '5m', '15m', '1h'].map((option) => (
              <button
                key={option}
                type="button"
                className={timeframe === option ? 'active' : ''}
                onClick={() => setTimeframe(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="indicator-menu-wrap">
            <button type="button" className="indicator-menu-btn" onClick={() => setMenuOpen((prev) => !prev)}>{compactLabel}</button>
            {menuOpen && (
              <div className="indicator-menu">
                {Object.keys(defaultIndicators).map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={indicators[key]}
                      onChange={() => setIndicators((prev) => ({ ...prev, [key]: !prev[key] }))}
                    />
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
