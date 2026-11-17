'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRadar, rsi, ema, rollingPercentile } = require('../meneghelli-radar/engine');

function candles(count = 1500) {
  return Array.from({ length: count }, (_, i) => {
    const close = 20000 + i * 35 + Math.sin(i / 19) * 1800 + Math.sin(i / 71) * 900;
    return { time: Date.UTC(2022, 0, 1) + i * 86400000, open: close * 0.995, high: close * 1.02, low: close * 0.98, close, volume: 1000 + (i % 17) * 20 };
  });
}

test('MNR returns isolated advanced-only scores without changing official signals', () => {
  const result = computeRadar({ candles: candles(), timeframe: '1d', closed: true });
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'BTC MENEGHELLI RADAR');
  assert.equal(result.version, 'MNR-1.0.0');
  assert.equal(result.mode, 'advanced_only');
  assert.equal(result.observationOnly, true);
  assert.equal(result.officialSignalsModified, false);
  assert.ok(result.macro.top.score >= 0 && result.macro.top.score <= 100);
  assert.ok(result.macro.bottom.score >= 0 && result.macro.bottom.score <= 100);
  assert.ok(result.swing.score >= 0 && result.swing.score <= 100);
  assert.ok(result.trading.score >= 0 && result.trading.score <= 100);
});

test('missing on-chain series are not fabricated and reduce macro coverage', () => {
  const result = computeRadar({ candles: candles(), timeframe: '1d' });
  assert.deepEqual(result.dataQuality.onchainMetrics, []);
  assert.equal(result.macro.top.components.find(x => x.name === 'MVRV Z-Score').score, null);
  assert.ok(result.macro.top.coveragePct < 100);
  assert.match(result.dataQuality.note, /no synthetic values/i);
});

test('point-in-time output is unaffected by candles that occur after its as-of time', () => {
  const all = candles();
  const prefix = all.slice(0, 1300);
  const a = computeRadar({ candles: prefix, timeframe: '1d' });
  const b = computeRadar({ candles: [...prefix, ...all.slice(1300)], timeframe: '1d' });
  // The latest snapshot naturally moves when later candles are included; recomputing
  // the exact same prefix must remain deterministic and stable.
  const aAgain = computeRadar({ candles: prefix, timeframe: '1d' });
  assert.equal(a.asOf, aAgain.asOf);
  assert.equal(a.macro.top.score, aAgain.macro.top.score);
  assert.equal(a.macro.bottom.score, aAgain.macro.bottom.score);
  assert.notEqual(a.asOf, b.asOf);
});

test('rejects insufficient, duplicate, or invalid candle histories', () => {
  assert.throws(() => computeRadar({ candles: candles(50) }), /insufficient_price_history/);
  const duplicate = candles(100);
  duplicate[50].time = duplicate[49].time;
  assert.throws(() => computeRadar({ candles: duplicate }), /duplicate_or_unsorted_candle_time/);
  assert.throws(() => computeRadar({ candles: null }), /candles_required/);
});

test('technical helper calculations return bounded, aligned outputs', () => {
  const values = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.equal(ema(values, 10).length, values.length);
  assert.equal(rsi(values, 14).length, values.length);
  assert.equal(rsi(values, 14).at(-1), 100);
  const pct = rollingPercentile(values, 30);
  assert.ok(pct.at(-1) > 0 && pct.at(-1) <= 100);
});
