'use strict';

const fs = require('fs');
const path = require('path');

const SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT']);
const MAX_SIGNALS = 1500;
const MAX_CANDLES_PER_SYMBOL = 1200;
const HORIZONS = [1, 3, 5, 10];
const THREE_D_MS = 3 * 24 * 60 * 60 * 1000;

class SignalObserver {
  constructor({ dataDir, persistent = false, now = () => Date.now() }) {
    this.file = path.join(dataDir, 'ai-signal-observer.json');
    this.persistent = persistent;
    this.now = now;
    this.state = this.read();
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value && value.version === 2 && value.symbols && typeof value.symbols === 'object') return value;
    } catch {}
    return { version: 2, createdAt: new Date(this.now()).toISOString(), symbols: {} };
  }

  save() {
    const temp = this.file + '.tmp';
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(this.state));
      fs.renameSync(temp, this.file);
      return true;
    } catch {
      try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
      return false;
    }
  }

  ingest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_payload');
    const symbol = String(input.symbol || '').toUpperCase();
    if (!SYMBOLS.has(symbol)) throw new Error('unsupported_symbol');
    if (input.timeframe !== '3d') throw new Error('official_timeframe_must_be_3d');
    if (!Array.isArray(input.candles) || input.candles.length < 1 || input.candles.length > 400) throw new Error('invalid_candles');
    if (!Array.isArray(input.signals) || input.signals.length > 300) throw new Error('invalid_signals');

    const bucket = this.state.symbols[symbol] || { candles: [], signals: [] };
    const candleMap = new Map(bucket.candles.map(c => [c.closeTime, c]));
    let acceptedCandleUpdates = 0;
    for (const raw of input.candles) {
      const time = Number(raw && raw.time), closeTime = Number(raw && raw.closeTime), close = Number(raw && raw.close);
      if (![time, closeTime, close].every(Number.isFinite) || close <= 0 || closeTime <= time) continue;
      if (closeTime > this.now() || closeTime - time < THREE_D_MS - 60000 || closeTime - time > THREE_D_MS + 60000) continue;
      const previous = candleMap.get(closeTime);
      if (previous && previous.close !== close) throw new Error('conflicting_candle_close');
      candleMap.set(closeTime, { time, closeTime, close });
      acceptedCandleUpdates++;
    }
    bucket.candles = [...candleMap.values()].sort((a,b) => a.closeTime - b.closeTime).slice(-MAX_CANDLES_PER_SYMBOL);
    const candleByCloseTime = new Map(bucket.candles.map(c => [c.closeTime, c]));

    const signalMap = new Map(bucket.signals.map(s => [s.id, s]));
    let acceptedSignals = 0;
    for (const raw of input.signals) {
      const side = raw && (raw.side === 'BUY' || raw.side === 'SELL') ? raw.side : null;
      const signalTime = Number(raw && raw.signalTime), signalPrice = Number(raw && raw.signalPrice);
      if (!side || !Number.isFinite(signalTime) || !Number.isFinite(signalPrice) || signalPrice <= 0) continue;
      if (signalTime > this.now()) continue;
      const candle = candleByCloseTime.get(signalTime);
      if (!candle) continue;
      // Signals must refer to the exact closed 3D candle and its close price.
      // This rejects mismatched timestamps and prevents look-ahead/offset errors.
      if (Math.abs(signalPrice / candle.close - 1) > 0.0005) continue;
      const id = symbol + ':3d:' + side + ':' + signalTime;
      if (signalMap.has(id)) continue;
      const numericOrNull = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
      signalMap.set(id, {
        id, symbol, timeframe: '3d', side, signalTime, signalPrice: candle.close,
        ema50: numericOrNull(raw.ema50),
        ema200: numericOrNull(raw.ema200),
        macd: numericOrNull(raw.macd),
        macdSignal: numericOrNull(raw.macdSignal),
        trigger: String(raw.trigger || '').slice(0, 60),
        strong: raw.strong === true,
        reason: String(raw.reason || '').slice(0, 240),
        observedAt: new Date(this.now()).toISOString()
      });
      acceptedSignals++;
    }
    bucket.signals = [...signalMap.values()].sort((a,b) => a.signalTime - b.signalTime).slice(-MAX_SIGNALS);
    bucket.updatedAt = new Date(this.now()).toISOString();
    this.state.symbols[symbol] = bucket;
    const saved = this.save();
    return {
      ok: true, symbol, candleCount: bucket.candles.length, signalCount: bucket.signals.length,
      acceptedCandleUpdates, acceptedSignals, storageWriteSucceeded: saved,
      storage: saved && this.persistent ? 'persistent_configured' : 'ephemeral_or_not_configured',
      deduplicated: true
    };
  }

  audit(symbol) {
    const key = String(symbol || '').toUpperCase();
    if (!SYMBOLS.has(key)) throw new Error('unsupported_symbol');
    const bucket = this.state.symbols[key] || { candles: [], signals: [] };
    const candles = bucket.candles;
    const byTime = new Map(candles.map((c,i) => [c.closeTime, i]));
    const result = {};
    for (const horizon of HORIZONS) {
      const matured = [];
      for (const signal of bucket.signals) {
        const start = byTime.get(signal.signalTime);
        if (start === undefined || start + horizon >= candles.length) continue;
        const end = candles[start + horizon];
        const rawReturn = end.close / signal.signalPrice - 1;
        const directionalReturn = signal.side === 'BUY' ? rawReturn : -rawReturn;
        matured.push({ side: signal.side, returnPct: directionalReturn * 100, hit: directionalReturn > 0 });
      }
      const summarize = rows => {
        const wins = rows.filter(x => x.hit).length;
        return {
          matured: rows.length, wins, losses: rows.length - wins,
          winRatePct: rows.length ? wins / rows.length * 100 : null,
          averageDirectionalReturnPct: rows.length ? rows.reduce((a,x) => a + x.returnPct, 0) / rows.length : null
        };
      };
      result[horizon + '_candles'] = {
        all: summarize(matured),
        buy: summarize(matured.filter(x => x.side === 'BUY')),
        sell: summarize(matured.filter(x => x.side === 'SELL'))
      };
    }
    const latestCandle = candles.length ? candles[candles.length - 1] : null;
    const ageMs = latestCandle ? this.now() - latestCandle.closeTime : null;
    return {
      symbol: key, timeframe: '3d', mode: 'observer_only',
      signalCount: bucket.signals.length, candleCount: candles.length,
      updatedAt: bucket.updatedAt || null,
      latestCandleCloseTime: latestCandle ? latestCandle.closeTime : null,
      latestCandleAgeMs: ageMs,
      dataFresh: ageMs !== null && ageMs >= 0 && ageMs <= 4 * THREE_D_MS,
      horizons: result,
      note: 'Retorno direcional entre fechamento do candle do sinal e fechamento futuro. Sem taxas, spread, slippage, funding ou execução real. Métricas observacionais não alteram sinais oficiais.'
    };
  }

  status() {
    const symbols = {};
    for (const symbol of SYMBOLS) {
      const bucket = this.state.symbols[symbol] || { candles: [], signals: [] };
      const latest = bucket.candles.length ? bucket.candles[bucket.candles.length - 1] : null;
      const age = latest ? this.now() - latest.closeTime : null;
      symbols[symbol] = {
        candles: bucket.candles.length, signals: bucket.signals.length,
        updatedAt: bucket.updatedAt || null,
        latestCandleCloseTime: latest ? latest.closeTime : null,
        dataFresh: age !== null && age >= 0 && age <= 4 * THREE_D_MS
      };
    }
    return {
      enabled: true, mode: 'observer_only', timeframe: '3d',
      persistentStorageConfigured: this.persistent,
      storage: this.persistent ? 'persistent_configured_not_independently_verified' : 'ephemeral_or_not_configured',
      canCreateSignals: false, canModifyOfficialSignals: false, symbols
    };
  }
}

module.exports = { SignalObserver, HORIZONS };
