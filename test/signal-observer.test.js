'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignalObserver } = require('../signal-observer');

const DAY = 86400000;
function fixture(now = 30 * DAY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btc-observer-'));
  const observer = new SignalObserver({ dataDir: dir, persistent: true, now: () => now });
  const candles = Array.from({ length: 12 }, (_, i) => ({
    time: i * 3 * DAY,
    closeTime: (i + 1) * 3 * DAY - 1,
    close: 100 + i * 5
  }));
  return { dir, observer, candles, now };
}

test('observer deduplicates signals and calculates BUY/SELL directional outcomes', () => {
  const { observer, candles } = fixture();
  const signalTime = candles[0].closeTime;
  const payload = { symbol: 'BTCUSDT', timeframe: '3d', candles, signals: [
    { side: 'BUY', signalTime, signalPrice: 100, ema50: 110, ema200: 120, macd: 1, macdSignal: 0, strong: true },
    { side: 'SELL', signalTime: candles[1].closeTime, signalPrice: 105 }
  ] };
  observer.ingest(payload);
  observer.ingest(payload);
  const audit = observer.audit('BTCUSDT');
  assert.equal(observer.status().symbols.BTCUSDT.signals, 2);
  assert.equal(audit.horizons['1_candles'].buy.winRatePct, 100);
  assert.equal(audit.horizons['1_candles'].sell.winRatePct, 0);
  assert.equal(audit.horizons['1_candles'].all.matured, 2);
});

test('observer rejects mismatched timeframe, unsupported symbol, and mismatched signal price', () => {
  const { observer, candles } = fixture();
  assert.throws(() => observer.ingest({ symbol: 'BTCUSDT', timeframe: '1d', candles, signals: [] }), /official_timeframe_must_be_3d/);
  assert.throws(() => observer.ingest({ symbol: 'DOGEUSDT', timeframe: '3d', candles, signals: [] }), /unsupported_symbol/);
  observer.ingest({ symbol: 'BTCUSDT', timeframe: '3d', candles, signals: [
    { side: 'BUY', signalTime: candles[0].closeTime, signalPrice: 999999 }
  ] });
  assert.equal(observer.status().symbols.BTCUSDT.signals, 0);
});

test('observer persists atomically and marks stale market data', () => {
  const { dir, observer, candles, now } = fixture(100 * DAY);
  observer.ingest({ symbol: 'BTCUSDT', timeframe: '3d', candles, signals: [] });
  const restored = new SignalObserver({ dataDir: dir, persistent: true, now: () => now });
  assert.equal(restored.status().symbols.BTCUSDT.candles, 12);
  assert.equal(restored.audit('BTCUSDT').dataFresh, false);
  assert.equal(fs.existsSync(path.join(dir, 'ai-signal-observer.json.tmp')), false);
});
