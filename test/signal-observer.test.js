'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignalObserver } = require('../signal-observer');

test('observer deduplicates official 3d signals and measures matured outcomes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btc-observer-'));
  let now = 10 * 86400000;
  const observer = new SignalObserver({ dataDir: dir, persistent: true, now: () => now });
  const candles = Array.from({ length: 8 }, (_, i) => ({
    time: i * 3 * 86400000,
    closeTime: (i + 1) * 3 * 86400000 - 1,
    close: 100 + i * 5
  }));
  const signalTime = candles[0].closeTime;
  const payload = { symbol: 'BTCUSDT', timeframe: '3d', candles, signals: [
    { side: 'BUY', signalTime, signalPrice: 100, ema50: 110, ema200: 120, macd: 1, macdSignal: 0, strong: true }
  ] };
  observer.ingest(payload);
  observer.ingest(payload);
  const audit = observer.audit('BTCUSDT');
  assert.equal(audit.horizons['1_candles'].matured, 1);
  assert.equal(observer.status().symbols.BTCUSDT.signals, 1);
  assert.equal(audit.horizons['1_candles'].matured, 1);
  assert.equal(audit.horizons['1_candles'].winRatePct, 100);
});

test('observer rejects unsupported timeframe and symbol', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btc-observer-'));
  const observer = new SignalObserver({ dataDir: dir, persistent: false });
  assert.throws(() => observer.ingest({ symbol: 'DOGEUSDT', timeframe: '3d', candles: [], signals: [] }), /unsupported_symbol/);
  assert.throws(() => observer.ingest({ symbol: 'BTCUSDT', timeframe: '1d', candles: [], signals: [] }), /official_timeframe_must_be_3d/);
});
