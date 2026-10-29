'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const { TraderRadar } = require('./trader-radar');

const app = express();
app.use(express.json({ limit: '64kb' }));
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(s => s.trim()), methods: ['GET','POST','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const STATE_FILE = path.join(DATA_DIR, 'last-signal.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function subscriptions() { return readJson(SUBS_FILE, []); }
function saveSubscriptions(value) { writeJson(SUBS_FILE, value); }
const publicKey = process.env.VAPID_PUBLIC_KEY || '';
const privateKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || '';
const subjectConfigured = (/^mailto:[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(subject) && !/example\\.(com|org|net)$/i.test(subject)) || /^https:\\/\\/\\S+$/.test(subject);
// Do not report push as ready unless the credentials, contact subject, and durable storage are all configured.
const persistentStorageConfigured = process.env.DATA_PERSISTENT === 'true';
const pushReady = Boolean(publicKey && privateKey && !publicKey.startsWith('REPLACE_') && !privateKey.startsWith('REPLACE_') && subjectConfigured && persistentStorageConfigured);
if (pushReady) webpush.setVapidDetails(subject, publicKey, privateKey);
const adminSecret = process.env.ADMIN_SECRET || '';
const traderRadar = new TraderRadar({ dataDir: DATA_DIR, sendPush, wallets: (process.env.TRADER_RADAR_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean), WebSocketImpl: require('ws'), logger: console });

function requireAdmin(req, res, next) {
  if (!adminSecret || req.get('authorization') !== `Bearer ${adminSecret}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function validSubscription(s) { return s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth; }
async function sendPush(payload) {
  if (!pushReady) return { sent: 0, failed: 0, skipped: 'VAPID_NOT_CONFIGURED' };
  const all = subscriptions(); let sent = 0, failed = 0; const keep = [];
  for (const sub of all) {
    try { await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 300 }); sent++; keep.push(sub); }
    catch (err) { failed++; if (err.statusCode !== 404 && err.statusCode !== 410) keep.push(sub); }
  }
  saveSubscriptions(keep);
  return { sent, failed };
}

function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1); let prev = values.slice(0, period).reduce((a,b)=>a+b,0) / period;
  const out = Array(period - 1).fill(null); out.push(prev);
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1-k); out.push(prev); }
  return out;
}
function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  let gain = 0, loss = 0;
  for (let i = values.length - period; i < values.length; i++) { const d = values[i] - values[i-1]; if (d > 0) gain += d; else loss -= d; }
  if (!loss) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}
async function computeSignal() {
  const url = 'https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=220';
  const response = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
  const rows = await response.json();
  const closes = rows.map(r => Number(r[4]));
  const volumes = rows.map(r => Number(r[5]));
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const price = closes[closes.length - 1], fast = e20[e20.length - 1], slow = e50[e50.length - 1];
  const currentRsi = rsi(closes, 14);
  const avgVol = volumes.slice(-21, -1).reduce((a,b)=>a+b,0) / Math.max(1, volumes.slice(-21,-1).length);
  const volRatio = volumes[volumes.length - 1] / (avgVol || 1);
  let score = 50;
  score += price > fast ? 10 : -10;
  score += fast > slow ? 15 : -15;
  score += currentRsi >= 50 && currentRsi <= 68 ? 10 : currentRsi < 35 ? 5 : currentRsi > 75 ? -10 : -3;
  score += volRatio >= 1.15 && price > fast ? 5 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const signal = score >= 70 ? 'COMPRA POTENCIAL' : score <= 35 ? 'VENDA POTENCIAL' : 'AGUARDAR';
  return { signal, score, price, rsi: Number(currentRsi.toFixed(1)), ema20: Number(fast.toFixed(2)), ema50: Number(slow.toFixed(2)), volumeRatio: Number(volRatio.toFixed(2)), checkedAt: new Date().toISOString(), source: 'Binance public API', model: 'legacy server heuristic v1 (not synchronized with the official app engine)', alertsEnabled: false };
}
async function monitorOnce() {
  const current = await computeSignal();
  const previous = readJson(STATE_FILE, null);
  const changed = Boolean(previous && previous.signal !== current.signal);
  // Do not send market-signal pushes from this legacy server heuristic.
  // The published app's official motor is the source of truth; until a shared
  // signal contract is wired end-to-end, suppressing these pushes prevents
  // alerts from contradicting the dashboard.
  writeJson(STATE_FILE, current);
  return {
    ...current,
    changed,
    notificationSuppressed: changed,
    notificationReason: changed
      ? 'Alert suppressed: server heuristic is not synchronized with the official app engine.'
      : null
  };
}

app.get('/health', (_req,res) => {
  const radar = traderRadar.status();
  res.json({ ok: true, service: 'BTC Cycle Desk Push', pushReady, subscribers: subscriptions().length, pollingMinutes: Math.max(5, Number(process.env.POLL_MINUTES || 15)), marketSignalAlertsEnabled: false, marketSignalAlertNote: 'Automatic market-signal pushes are suppressed until they share the official app engine.', traderRadar: { running: radar.running, source: radar.source, watchedWallets: radar.watchedWallets, connectedWallets: radar.connectedWallets, eventCount: radar.eventCount, rankedEligible: radar.rankedEligible, lastDiscoveryAt: radar.lastDiscoveryAt, lastError: radar.lastError } });
});
app.get('/api/push/public-key', (_req,res) => { if (!pushReady) return res.status(503).json({ error: 'PUSH_NOT_READY', message: 'Configure valid VAPID credentials, a real VAPID subject, and persistent storage before enabling Web Push.' }); res.json({ publicKey }); });
app.post('/api/push/subscribe', (req,res) => {
  // Never claim a device is registered when the server cannot actually deliver Web Push.
  if (!pushReady) return res.status(503).json({ error: 'push_not_ready', message: 'Configure valid VAPID credentials, a real VAPID subject, and persistent storage before enabling Web Push.' });
  const sub = req.body && req.body.subscription;
  if (!validSubscription(sub) || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return res.status(400).json({ error: 'invalid_subscription' });
  const all = subscriptions();
  const next = all.filter(x => x.endpoint !== sub.endpoint);
  next.push({ endpoint: sub.endpoint, expirationTime: sub.expirationTime || null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  saveSubscriptions(next);
  res.status(201).json({ ok: true, subscribers: next.length, pushReady: true, storage: 'local-filesystem; persistence depends on Render disk configuration' });
});
app.post('/api/push/unsubscribe', (req,res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'endpoint_required' });
  const next = subscriptions().filter(x => x.endpoint !== endpoint); saveSubscriptions(next); res.json({ ok: true, subscribers: next.length });
});
app.post('/api/admin/notify', requireAdmin, async (req,res) => {
  const { title, body, tag, url, eventType } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title_and_body_required' });
  const result = await sendPush({ title: String(title).slice(0,120), body: String(body).slice(0,500), tag: tag || `btc-${Date.now()}`, url: url || '/', eventType: eventType || 'manual' });
  res.json({ ok: true, ...result });
});
app.get('/api/market/signal', async (_req,res) => { try { res.json(await computeSignal()); } catch (e) { res.status(502).json({ error: 'market_data_unavailable', message: e.message }); } });
app.post('/api/admin/check-now', requireAdmin, async (_req,res) => { try { res.json(await monitorOnce()); } catch (e) { res.status(502).json({ error: 'monitor_failed', message: e.message }); } });
app.get('/api/trader-radar/panel.js', (_req,res) => { res.type('application/javascript').set('Cache-Control','no-store').sendFile(path.join(__dirname,'public','trader-radar-panel.js')); });
app.get('/api/trader-radar/candles', async (req,res) => {
  const allowed = new Set(['1m','5m','15m','1h','4h','1d']);
  const interval = allowed.has(String(req.query.interval)) ? String(req.query.interval) : '1m';
  const limit = Math.min(500, Math.max(20, Number(req.query.limit) || 120));
  const duration = ({'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000})[interval];
  const endTime = Date.now();
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: {'content-type':'application/json','accept':'application/json'},
      body: JSON.stringify({type:'candleSnapshot',req:{coin:'BTC',interval,startTime:endTime-limit*duration,endTime}})
    });
    if (!response.ok) return res.status(502).json({error:'hyperliquid_candles_unavailable',status:response.status});
    const candles = await response.json();
    if (!Array.isArray(candles)) return res.status(502).json({error:'invalid_candle_response'});
    res.set('Cache-Control','no-store').json({source:'Hyperliquid BTC candles',interval,candles});
  } catch (e) {
    res.status(502).json({error:'hyperliquid_candles_unavailable',message:e.message});
  }
});
app.get('/api/trader-radar/status', (_req,res) => res.json(traderRadar.status()));
app.get('/api/trader-radar/events', (req,res) => { const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50)); res.json({ events: traderRadar.events.slice(0, limit), count: Math.min(traderRadar.events.length, limit) }); });
app.get('/api/trader-radar/wallets', (_req,res) => res.json({ wallets: [...traderRadar.wallets.values()] }));
app.get('/api/trader-radar/rankings', (_req,res) => { const traders = traderRadar.rankedTraders(); res.json({ traders, rankings: traders, criteria: { minimumClosedTrades: 20, minimumProfitFactor: 1.2, positiveRealizedPnl: true }, note: 'Ranking provisório baseado somente em fechamentos observados após o início do monitoramento; não representa o histórico completo da conta e ainda não normaliza drawdown/alavancagem.' }); });
app.post('/api/admin/trader-radar/wallets', requireAdmin, (req,res) => { try { res.status(201).json({ ok: true, wallet: traderRadar.addWallet(req.body && req.body.address, req.body || {}) }); } catch (e) { res.status(400).json({ error: 'invalid_wallet', message: e.message }); } });
app.delete('/api/admin/trader-radar/wallets/:address', requireAdmin, (req,res) => { if (!/^0x[a-fA-F0-9]{40}$/.test(req.params.address)) return res.status(400).json({ error: 'invalid_wallet' }); traderRadar.removeWallet(req.params.address); res.json({ ok: true }); });
app.post('/api/admin/trader-radar/discover', requireAdmin, async (_req,res) => { try { res.json({ ok: true, candidates: await traderRadar.discoverCandidates(), status: traderRadar.status() }); } catch (e) { res.status(502).json({ error: 'leaderboard_unavailable', message: e.message }); } });

const intervalMs = Math.max(5, Number(process.env.POLL_MINUTES || 15)) * 60 * 1000;
let monitorBusy = false;
async function safeMonitor() { if (monitorBusy) return; monitorBusy = true; try { await monitorOnce(); } catch (e) { console.error('Market monitor failed:', e.message); } finally { monitorBusy = false; } }
app.listen(Number(process.env.PORT || 8080), () => { console.log(`BTC Cycle Desk Push listening on ${process.env.PORT || 8080}`); safeMonitor(); setInterval(safeMonitor, intervalMs); traderRadar.start(); });
