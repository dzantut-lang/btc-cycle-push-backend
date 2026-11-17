'use strict';

// BTC MENEGHELLI RADAR — isolated, deterministic scoring engine.
// This module is intentionally not wired into the official market-signal engine.
// Inputs must be point-in-time observations; never pass future-filled values.

const DAY = 86400000;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function sma(values, period) {
  return values.map((_, i) => i + 1 < period ? null : mean(values.slice(i + 1 - period, i + 1)));
}

function ema(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let previous = mean(values.slice(0, period));
  out[period - 1] = previous;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    previous = values[i] * alpha + previous * (1 - alpha);
    out[i] = previous;
  }
  return out;
}

function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    gains += Math.max(0, delta);
    losses += Math.max(0, -delta);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, delta)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -delta)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function rollingPercentile(values, lookback = 1095) {
  return values.map((value, index) => {
    if (!finite(value)) return null;
    const history = values.slice(Math.max(0, index - lookback + 1), index + 1)
      .filter(finite).map(Number);
    if (history.length < Math.min(90, lookback)) return null;
    const less = history.filter(x => x < Number(value)).length;
    const equal = history.filter(x => x === Number(value)).length;
    return 100 * (less + equal / 2) / history.length;
  });
}

function latestValid(values) {
  for (let i = values.length - 1; i >= 0; i--) if (finite(values[i])) return Number(values[i]);
  return null;
}

function weightedScore(components, minimumComponents = 3) {
  const valid = components.filter(c => finite(c.score) && c.weight > 0);
  const totalWeight = valid.reduce((sum, c) => sum + c.weight, 0);
  const coveragePct = Math.round(100 * valid.length / components.length);
  if (valid.length < minimumComponents || totalWeight <= 0) {
    return { score: null, coveragePct, validComponents: valid.length, totalComponents: components.length, components };
  }
  const score = Math.round(valid.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight);
  return { score: clamp(score), coveragePct, validComponents: valid.length, totalComponents: components.length, components };
}

function component(name, weight, score, source, detail = null) {
  return { name, weight, score: finite(score) ? clamp(Number(score)) : null, source, detail };
}

function computeRadar(input, options = {}) {
  if (!input || !Array.isArray(input.candles)) throw new Error('candles_required');
  const candles = input.candles.map(c => ({
    time: Number(c && c.time),
    close: Number(c && c.close),
    high: Number(c && (c.high ?? c.close)),
    low: Number(c && (c.low ?? c.close)),
    volume: Number(c && (c.volume ?? 0))
  })).filter(c => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0 &&
    Number.isFinite(c.high) && Number.isFinite(c.low) && c.high >= c.low)
    .sort((a, b) => a.time - b.time);

  if (candles.length < 90) throw new Error('insufficient_price_history');
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time <= candles[i - 1].time) throw new Error('duplicate_or_unsorted_candle_time');
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const timeframes = String(input.timeframe || '1d').toLowerCase();
  const daysPerCandle = timeframes === '3d' ? 3 : timeframes === '1w' ? 7 : 1;
  const sma200 = sma(closes, Math.max(2, Math.round(200 / daysPerCandle)));
  const sma111 = sma(closes, Math.max(2, Math.round(111 / daysPerCandle)));
  const sma350 = sma(closes, Math.max(2, Math.round(350 / daysPerCandle)));
  const sma200w = sma(closes, Math.max(2, Math.round(1400 / daysPerCandle)));
  const sma730 = sma(closes, Math.max(2, Math.round(730 / daysPerCandle)));
  const ema20 = ema(closes, Math.max(2, Math.round(20 / daysPerCandle)));
  const ema50 = ema(closes, Math.max(2, Math.round(50 / daysPerCandle)));
  const ema200 = ema(closes, Math.max(2, Math.round(200 / daysPerCandle)));
  const rsi14 = rsi(closes, Math.max(2, Math.round(14 / daysPerCandle)));
  const macdFast = ema(closes, Math.max(2, Math.round(12 / daysPerCandle)));
  const macdSlow = ema(closes, Math.max(3, Math.round(26 / daysPerCandle)));
  const macdLine = closes.map((_, i) => finite(macdFast[i]) && finite(macdSlow[i]) ? macdFast[i] - macdSlow[i] : null);
  const macdSignal = ema(macdLine.map(x => finite(x) ? x : 0), Math.max(2, Math.round(9 / daysPerCandle)));
  const macdHist = macdLine.map((x, i) => finite(x) && finite(macdSignal[i]) ? x - macdSignal[i] : null);
  const returns = closes.map((x, i) => i ? x / closes[i - 1] - 1 : null);
  const volumeMean20 = volumes.map((_, i) => i < 20 ? null : mean(volumes.slice(i - 20, i)));
  const volumeRatio = volumes.map((v, i) => finite(volumeMean20[i]) && volumeMean20[i] > 0 ? v / volumeMean20[i] : null);

  const onchain = input.onchain && typeof input.onchain === 'object' ? input.onchain : {};
  const series = key => Array.isArray(onchain[key]) ? onchain[key].map(v => finite(v) ? Number(v) : null) : [];
  const mvrv = series('mvrvZ');
  const nupl = series('nupl');
  const rhodl = series('rhodl');
  const puell = series('puell');
  const cvdd = series('cvdd');
  const align = values => values.length === candles.length ? values : Array(candles.length).fill(null);
  const mvrvPct = rollingPercentile(align(mvrv));
  const nuplPct = rollingPercentile(align(nupl));
  const rhodlPct = rollingPercentile(align(rhodl));
  const puellPct = rollingPercentile(align(puell));
  const mayer = closes.map((p, i) => finite(sma200[i]) && sma200[i] > 0 ? p / sma200[i] : null);
  const mayerPct = rollingPercentile(mayer);
  const twoYearMultiple = closes.map((p, i) => finite(sma730[i]) && sma730[i] > 0 ? p / sma730[i] : null);
  const twoYearPct = rollingPercentile(twoYearMultiple);
  const piRatio = closes.map((_, i) => finite(sma111[i]) && finite(sma350[i]) && sma350[i] > 0 ? sma111[i] / (2 * sma350[i]) : null);
  const piPct = rollingPercentile(piRatio);
  const priceTo200w = closes.map((p, i) => finite(sma200w[i]) && sma200w[i] > 0 ? p / sma200w[i] : null);
  const priceTo200wPct = rollingPercentile(priceTo200w);
  const priceToCvdd = closes.map((p, i) => finite(cvdd[i]) && Number(cvdd[i]) > 0 ? p / Number(cvdd[i]) : null);
  const priceToCvddPct = rollingPercentile(priceToCvdd);
  const rsiPct = rollingPercentile(rsi14);
  const macdHistPct = rollingPercentile(macdHist);
  const volumeRatioPct = rollingPercentile(volumeRatio);

  const last = candles.length - 1;
  const currentPrice = closes[last];
  const current = values => latestValid(values);
  const topComponents = [
    component('MVRV Z-Score', 25, current(mvrvPct), 'onchain.mvrvZ', current(mvrv)),
    component('NUPL', 15, current(nuplPct), 'onchain.nupl', current(nupl)),
    component('Pi Cycle proximity', 15, finite(current(piPct)) ? current(piPct) : null, 'price.sma111_sma350', current(piRatio)),
    component('Mayer Multiple', 15, current(mayerPct), 'price.sma200', current(mayer)),
    component('2-Year MA Multiple', 10, current(twoYearPct), 'price.sma730', current(twoYearMultiple)),
    component('RHODL Ratio', 10, current(rhodlPct), 'onchain.rhodl', current(rhodl)),
    component('Puell Multiple', 10, current(puellPct), 'onchain.puell', current(puell))
  ];
  const bottomComponents = [
    component('MVRV undervaluation', 25, finite(current(mvrvPct)) ? 100 - current(mvrvPct) : null, 'onchain.mvrvZ', current(mvrv)),
    component('NUPL capitulation', 15, finite(current(nuplPct)) ? 100 - current(nuplPct) : null, 'onchain.nupl', current(nupl)),
    component('CVDD proximity', 15, finite(current(priceToCvddPct)) ? 100 - current(priceToCvddPct) : null, 'onchain.cvdd', current(priceToCvdd)),
    component('200-week MA proximity', 15, finite(current(priceTo200wPct)) ? 100 - current(priceTo200wPct) : null, 'price.sma200w', current(priceTo200w)),
    component('2-Year MA undervaluation', 10, finite(current(twoYearPct)) ? 100 - current(twoYearPct) : null, 'price.sma730', current(twoYearMultiple)),
    component('RSI capitulation', 10, finite(current(rsi14)) ? 100 - current(rsiPct) : null, 'price.rsi14', current(rsi14)),
    component('Volume stress', 10, finite(current(volumeRatioPct)) ? current(volumeRatioPct) : null, 'price.volumeRatio', current(volumeRatio))
  ];

  const top = weightedScore(topComponents, 3);
  const bottom = weightedScore(bottomComponents, 3);
  const rsiNow = current(rsi14), histNow = current(macdHist), histPrev = macdHist[last - 1];
  const priceAbove20 = finite(current(ema20)) && currentPrice > current(ema20);
  const priceAbove50 = finite(current(ema50)) && currentPrice > current(ema50);
  const trendBull = finite(current(ema50)) && finite(current(ema200)) && current(ema50) > current(ema200);
  const macdImproving = finite(histNow) && finite(histPrev) && histNow > histPrev;
  const swing = weightedScore([
    component('RSI recovery', 25, finite(rsiNow) ? clamp((rsiNow - 25) * 2) : null, 'price.rsi14', rsiNow),
    component('MACD momentum improvement', 25, macdImproving ? 75 : (finite(histNow) ? 35 : null), 'price.macdHistogram', histNow),
    component('EMA20 reclaim', 20, finite(current(ema20)) ? (priceAbove20 ? 75 : 25) : null, 'price.ema20', current(ema20)),
    component('EMA50/200 trend', 20, finite(current(ema200)) ? (trendBull ? 75 : 25) : null, 'price.ema50_ema200', trendBull),
    component('Volume confirmation', 10, finite(current(volumeRatio)) ? clamp(50 + (current(volumeRatio) - 1) * 25) : null, 'price.volumeRatio', current(volumeRatio))
  ], 3);
  const trading = weightedScore([
    component('Trend alignment', 30, finite(current(ema200)) ? (trendBull ? 80 : 20) : null, 'price.ema50_ema200', trendBull),
    component('Momentum', 25, finite(rsiNow) ? clamp(50 + (rsiNow - 50) * 1.5) : null, 'price.rsi14', rsiNow),
    component('MACD', 25, finite(histNow) ? (histNow > 0 ? 75 : 25) : null, 'price.macdHistogram', histNow),
    component('Volume', 20, finite(current(volumeRatio)) ? clamp(50 + (current(volumeRatio) - 1) * 25) : null, 'price.volumeRatio', current(volumeRatio))
  ], 3);

  const classify = (score, labels) => score === null ? 'INSUFFICIENT_DATA'
    : score >= 85 ? labels.extreme : score >= 70 ? labels.critical
    : score >= 50 ? labels.alert : score >= 30 ? labels.watch : labels.normal;
  const asOf = new Date(candles[last].time).toISOString();
  const closed = input.closed !== false;
  return {
    ok: true,
    engine: 'BTC MENEGHELLI RADAR',
    version: 'MNR-1.0.0',
    mode: 'advanced_only',
    observationOnly: true,
    officialSignalsModified: false,
    timeframe: timeframes,
    asOf,
    candleClosed: closed,
    price: currentPrice,
    macro: {
      top: { ...top, state: classify(top.score, { extreme: 'TOP_EXTREME', critical: 'TOP_CRITICAL', alert: 'TOP_ALERT', watch: 'TOP_WATCH', normal: 'NORMAL' }) },
      bottom: { ...bottom, state: classify(bottom.score, { extreme: 'BOTTOM_EXTREME', critical: 'BOTTOM_CRITICAL', alert: 'BOTTOM_ALERT', watch: 'BOTTOM_WATCH', normal: 'NORMAL' }) }
    },
    swing: { ...swing, state: swing.score === null ? 'INSUFFICIENT_DATA' : swing.score >= 70 ? 'REVERSAL_STRENGTH' : swing.score >= 50 ? 'REVERSAL_WATCH' : 'NO_CONFIRMATION' },
    trading: { ...trading, state: trading.score === null ? 'INSUFFICIENT_DATA' : trading.score >= 70 ? 'OPPORTUNITY_WATCH' : trading.score <= 30 ? 'RISK_WATCH' : 'WAIT' },
    indicators: {
      rsi14: rsiNow,
      ema20: current(ema20),
      ema50: current(ema50),
      ema200: current(ema200),
      macdHistogram: histNow,
      volumeRatio: current(volumeRatio),
      piCycleRatio: current(piRatio),
      mayerMultiple: current(mayer),
      twoYearMaMultiple: current(twoYearMultiple),
      priceTo200WeekMa: current(priceTo200w),
      priceToCvdd: current(priceToCvdd)
    },
    dataQuality: {
      candles: candles.length,
      onchainMetrics: ['mvrvZ', 'nupl', 'rhodl', 'puell', 'cvdd'].filter(k => Array.isArray(onchain[k]) && onchain[k].some(finite)),
      onchainAlignment: 'exact_index_alignment_required',
      staleFallbackUsed: false,
      note: 'Missing on-chain metrics are excluded from weighted scores and reduce coverage; no synthetic values are generated.'
    },
    disclaimer: 'Scores are evidence-weighted research scores, not calibrated probabilities or investment advice. Signals are observational and do not change the official BTC Cycle Desk engine.'
  };
}

module.exports = { computeRadar, sma, ema, rsi, rollingPercentile, weightedScore };
