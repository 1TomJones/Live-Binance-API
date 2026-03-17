import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

let lightweightChartsLoader = null;
const chartSocket = io();

const TIMEFRAME_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600
};

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

function timeframeToSec(timeframe) {
  return TIMEFRAME_SECONDS[timeframe] || 60;
}

function bucketTime(unixSeconds, timeframe) {
  const sec = timeframeToSec(timeframe);
  return Math.floor(unixSeconds / sec) * sec;
}

function sessionKey(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
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

  const candlesRef = useRef([]);
  const candleMapRef = useRef(new Map());
  const liveTradesRef = useRef([]);
  const allTradesRef = useRef([]);
  const latestCvdRef = useRef(0);
  const sessionTotalsRef = useRef(new Map());
  const cvdCandlesRef = useRef([]);
  const visibleRangeTimerRef = useRef(null);

  const [timeframe, setTimeframe] = useState('1m');
  const [menuOpen, setMenuOpen] = useState(false);
  const [indicators, setIndicators] = useState(defaultIndicators);
  const [profile, setProfile] = useState([]);

  const showLowerPanel = indicators.cvd;

  const compactLabel = useMemo(() => {
    const enabled = Object.entries(indicators).filter(([, value]) => value).map(([key]) => key);
    return enabled.length ? `Indicators (${enabled.length})` : 'Indicators';
  }, [indicators]);

  const rebuildDerivedSeries = () => {
    const candleData = candlesRef.current;

    if (indicators.vwap) {
      const running = [];
      const totals = new Map();
      candleData.forEach((candle) => {
        const key = sessionKey(candle.time);
        const state = totals.get(key) || { pv: 0, v: 0 };
        const typical = (candle.high + candle.low + candle.close) / 3;
        state.pv += typical * Number(candle.volume || 0);
        state.v += Number(candle.volume || 0);
        totals.set(key, state);
        running.push({ time: candle.time, value: state.v > 0 ? state.pv / state.v : candle.close });
      });
      sessionTotalsRef.current = totals;
      vwapSeriesRef.current?.setData(running);
    }

    if (indicators.cvd) {
      let runningCvd = 0;
      const buckets = new Map();
      const sortedTrades = [...allTradesRef.current].sort((a, b) => a.trade_time - b.trade_time);

      candleData.forEach((candle) => {
        buckets.set(candle.time, { time: candle.time, open: runningCvd, high: runningCvd, low: runningCvd, close: runningCvd });
      });

      sortedTrades.forEach((trade) => {
        const tradeSec = Math.floor(trade.trade_time / 1000);
        const candleTime = bucketTime(tradeSec, timeframe);
        if (!buckets.has(candleTime)) return;
        const entry = buckets.get(candleTime);
        const delta = trade.maker_flag ? -Number(trade.quantity) : Number(trade.quantity);
        runningCvd += delta;
        entry.high = Math.max(entry.high, runningCvd);
        entry.low = Math.min(entry.low, runningCvd);
        entry.close = runningCvd;
      });

      const cvdCandles = candleData.map((candle) => buckets.get(candle.time));
      latestCvdRef.current = cvdCandles.at(-1)?.close || 0;
      cvdCandlesRef.current = cvdCandles;
      cvdSeriesRef.current?.setData(cvdCandles);
    }
  };

  const applyTradeBatch = (incomingTrades) => {
    if (!incomingTrades.length) return;

    const secPerCandle = timeframeToSec(timeframe);

    incomingTrades.forEach((trade) => {
      const tradeSec = Math.floor(trade.trade_time / 1000);
      const candleTime = bucketTime(tradeSec, timeframe);
      const price = Number(trade.price);
      const qty = Number(trade.quantity || 0);

      const existing = candleMapRef.current.get(candleTime);
      if (!existing) {
        const newCandle = {
          time: candleTime,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: qty
        };
        candlesRef.current.push(newCandle);
        candleMapRef.current.set(candleTime, newCandle);
      } else {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price;
        existing.volume += qty;
      }

      const nextBoundary = candleTime + secPerCandle;
      candlesRef.current = candlesRef.current.filter((c) => c.time < nextBoundary + 1200 * secPerCandle);

      if (indicators.vwap) {
        const key = sessionKey(candleTime);
        const state = sessionTotalsRef.current.get(key) || { pv: 0, v: 0 };
        state.pv += price * qty;
        state.v += qty;
        sessionTotalsRef.current.set(key, state);
      }

      if (indicators.cvd) {
        const delta = trade.maker_flag ? -qty : qty;
        const last = cvdCandlesRef.current.at(-1);
        const target = cvdCandlesRef.current.find((c) => c.time === candleTime);
        if (!target) {
          const open = last ? last.close : latestCvdRef.current;
          const created = { time: candleTime, open, high: open, low: open, close: open + delta };
          created.high = Math.max(created.high, created.close);
          created.low = Math.min(created.low, created.close);
          cvdCandlesRef.current.push(created);
          latestCvdRef.current = created.close;
        } else {
          target.close += delta;
          target.high = Math.max(target.high, target.close);
          target.low = Math.min(target.low, target.close);
          latestCvdRef.current = target.close;
        }
      }
    });

    candlesRef.current.sort((a, b) => a.time - b.time);
    candleMapRef.current = new Map(candlesRef.current.map((c) => [c.time, c]));

    candleSeriesRef.current?.setData(candlesRef.current.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

    if (indicators.vwap) {
      const vwap = candlesRef.current.map((c) => {
        const key = sessionKey(c.time);
        const state = sessionTotalsRef.current.get(key);
        return { time: c.time, value: state && state.v > 0 ? state.pv / state.v : c.close };
      });
      vwapSeriesRef.current?.setData(vwap);
    }

    if (indicators.cvd) {
      cvdCandlesRef.current.sort((a, b) => a.time - b.time);
      cvdSeriesRef.current?.setData(cvdCandlesRef.current);
    }
  };

  useEffect(() => {
    let flushTimer;

    const loadBase = async () => {
      const response = await fetch(`/api/candles?timeframe=${timeframe}&limit=500`);
      const payload = await response.json();
      candlesRef.current = payload.candles || [];
      candleMapRef.current = new Map(candlesRef.current.map((c) => [c.time, c]));
      candleSeriesRef.current?.setData(candlesRef.current.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

      if (candlesRef.current.length) {
        const start = candlesRef.current[0].time * 1000;
        const end = (candlesRef.current.at(-1).time + timeframeToSec(timeframe)) * 1000;
        const tradeResp = await fetch(`/api/history/trades?start=${start}&end=${end}&limit=100000`);
        const tradePayload = await tradeResp.json();
        allTradesRef.current = tradePayload.trades || [];
      } else {
        allTradesRef.current = [];
      }

      rebuildDerivedSeries();
      chartRef.current?.timeScale().fitContent();
    };

    loadBase();

    const onTrade = (trade) => {
      liveTradesRef.current.push(trade);
      allTradesRef.current.push(trade);
      if (allTradesRef.current.length > 120000) {
        allTradesRef.current = allTradesRef.current.slice(-120000);
      }
    };

    flushTimer = window.setInterval(() => {
      if (!liveTradesRef.current.length) return;
      const batch = liveTradesRef.current.splice(0, liveTradesRef.current.length);
      applyTradeBatch(batch);
    }, 150);

    chartSocket.on('trade', onTrade);

    return () => {
      window.clearInterval(flushTimer);
      chartSocket.off('trade', onTrade);
    };
  }, [timeframe, indicators.vwap, indicators.cvd]);

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

      resizeObserver = new ResizeObserver(() => chart.timeScale().fitContent());
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
    if (!vwapSeriesRef.current) return;
    vwapSeriesRef.current.applyOptions({ visible: indicators.vwap });
    if (!indicators.vwap) vwapSeriesRef.current.setData([]);
  }, [indicators.vwap]);

  useEffect(() => {
    if (!cvdSeriesRef.current) return;
    cvdSeriesRef.current.applyOptions({ visible: indicators.cvd });
    if (!indicators.cvd) cvdSeriesRef.current.setData([]);
  }, [indicators.cvd]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const canvas = overlayCanvasRef.current;
    if (!chart || !series || !canvas || !indicators.volumeProfile) return;

    const drawProfile = () => {
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

    drawProfile();
    const resizeObs = new ResizeObserver(drawProfile);
    resizeObs.observe(containerRef.current);

    return () => {
      resizeObs.disconnect();
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [profile, indicators.volumeProfile]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !indicators.volumeProfile) return;

    const onRangeChange = () => {
      if (visibleRangeTimerRef.current) window.clearTimeout(visibleRangeTimerRef.current);
      visibleRangeTimerRef.current = window.setTimeout(async () => {
        const range = chart.timeScale().getVisibleRange();
        if (!range?.from || !range?.to) return;
        const response = await fetch(`/api/indicators/volume-profile?timeframe=${timeframe}&from=${Math.floor(range.from)}&to=${Math.ceil(range.to)}`);
        const payload = await response.json();
        setProfile(payload.profile || []);
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
