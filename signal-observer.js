'use strict';

const fs = require('fs');
const path = require('path');

const SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT']);
const MAX_SIGNALS = 1500;
const MAX_CANDLES_PER_SYMBOL = 1200;
const HORIZONS = [1, 3, 5, 10];

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
      if (value && value.version === 1 && value.symbols) return value;
    } catch {}
    return { version: 1, createdAt: new Date(this.now()).toISOString(), symbols: {} };
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state));
      return true;
    } catch {
      return false;
    }
  }

  ingest(input) {
    const symbol = String(input.symbol || '').toUpperCase();
    if (!SYMBOLS.has(symbol)) throw new Error('unsupported_symbol');
    if (input.timeframe !== '3d') throw new Error('official_timeframe_must_be_3d');
    if (!Array.isArray(input.candles) || input.candles.length > 400) throw new Error('invalid_candles');
    if (!Array.isArray(input.signals) || input.signals.length > 300) throw new Error('invalid_signals');

    const bucket = this.state.symbols[symbol] || { candles: [], signals: [] };
    const candleMap = new Map(bucket.candles.map(c => [c.closeTime, c]));
    for (const raw of input.candles) {
      const time = Number(raw.time), closeTime = Number(raw.closeTime), close = Number(raw.close);
      if (![time, closeTime, close].every(Number.isFinite) || close <= 0 || closeTime <= time) continue;
      if (closeTime > this.now() + 60000) continue;
      candleMap.set(closeTime, { time, closeTime, close });
    }
    bucket.candles = [...candleMap.values()].sort((a,b) => a.closeTime - b.closeTime).slice(-MAX_CANDLES_PER_SYMBOL);

    const signalMap = new Map(bucket.signals.map(s => [s.id, s]));
    for (const raw of input.signals) {
      const side = raw.side === 'BUY' || raw.side === 'SELL' ? raw.side : null;
      const signalTime = Number(raw.signalTime), signalPrice = Number(raw.signalPrice);
      if (!side || !Number.isFinite(signalTime) || !Number.isFinite(signalPrice) || signalPrice <= 0) continue;
      if (signalTime > this.now() + 60000) continue;
      const id = symbol + ':3d:' + side + ':' + signalTime;
      if (signalMap.has(id)) continue;
      signalMap.set(id, {
        id, symbol, timeframe: '3d', side, signalTime, signalPrice,
        ema50: Number.isFinite(Number(raw.ema50)) ? Number(raw.ema50) : null,
        ema200: Number.isFinite(Number(raw.ema200)) ? Number(raw.ema200) : null,
        macd: Number.isFinite(Number(raw.macd)) ? Number(raw.macd) : null,
        macdSignal: Number.isFinite(Number(raw.macdSignal)) ? Number(raw.macdSignal) : null,
        trigger: String(raw.trigger || '').slice(0, 60),
        strong: raw.strong === true,
        reason: String(raw.reason || '').slice(0, 240),
        observedAt: new Date(this.now()).toISOString()
      });
    }
    bucket.signals = [...signalMap.values()].sort((a,b) => a.signalTime - b.signalTime).slice(-MAX_SIGNALS);
    bucket.updatedAt = new Date(this.now()).toISOString();
    this.state.symbols[symbol] = bucket;
    const saved = this.save();
    return { ok: true, symbol, acceptedCandles: bucket.candles.length, acceptedSignals: bucket.signals.length, storage: saved && this.persistent ? 'persistent' : 'ephemeral_on_render_free', deduplicated: true };
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
        matured.push({ signal, returnPct: directionalReturn * 100, hit: directionalReturn > 0 });
      }
      const wins = matured.filter(x => x.hit).length;
      result[horizon + '_candles'] = {
        matured: matured.length,
        wins,
        losses: matured.length - wins,
        winRatePct: matured.length ? wins / matured.length * 100 : null,
        averageDirectionalReturnPct: matured.length ? matured.reduce((a,x) => a + x.returnPct, 0) / matured.length : null
      };
    }
    return {
      symbol: key,
      timeframe: '3d',
      mode: 'observer_only',
      signalCount: bucket.signals.length,
      candleCount: candles.length,
      updatedAt: bucket.updatedAt || null,
      horizons: result,
      note: 'Resultados observacionais por candles fechados; não incluem taxas, spread, slippage, funding ou execução real. Nenhuma métrica altera sinais oficiais.'
    };
  }

  status() {
    const symbols = {};
    for (const symbol of SYMBOLS) {
      const bucket = this.state.symbols[symbol] || { candles: [], signals: [] };
      symbols[symbol] = { candles: bucket.candles.length, signals: bucket.signals.length, updatedAt: bucket.updatedAt || null };
    }
    return {
      enabled: true,
      mode: 'observer_only',
      timeframe: '3d',
      persistentStorage: this.persistent,
      storage: this.persistent ? 'persistent' : 'ephemeral_on_render_free',
      canCreateSignals: false,
      canModifyOfficialSignals: false,
      symbols
    };
  }
}

module.exports = { SignalObserver, HORIZONS };
