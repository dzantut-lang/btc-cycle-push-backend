'use strict';

const SOURCE = 'The Commoner Bitcoin ETF Tracker by TFTC';
const DATA_URL = 'https://www.tftc.io/bitcoin-etf-flows/data.json';
const LATEST_URL = 'https://www.tftc.io/bitcoin-etf-flows/latest.json';
const METHODOLOGY_URL = 'https://www.tftc.io/bitcoin-etf-flows/methodology';
const CACHE_TTL_MS = 15 * 60 * 1000;
let cache = null;
let pending = null;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function normalizeSession(row) {
  if (!row || typeof row !== 'object') return null;
  const date = String(row.date || row.sessionDate || row.day || '');
  const flow = finite(row.netFlowUsd ?? row.net_flow_usd ?? row.netFlow ?? row.flowUsd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || flow === null) return null;
  const assets = finite(row.totalNetAssetsUsd ?? row.aumUsd ?? row.totalAumUsd ?? row.totalNetAssets);
  const btcClose = finite(row.btcCloseUsd ?? row.btcPriceUsd ?? row.priceUsd);
  const rawFunds = row.perEtfUsd ?? row.perFundUsd ?? row.funds ?? row.etfs ?? {};
  const funds = {};
  if (rawFunds && typeof rawFunds === 'object' && !Array.isArray(rawFunds)) {
    for (const [ticker, value] of Object.entries(rawFunds)) {
      const amount = finite(typeof value === 'object' && value ? (value.netFlowUsd ?? value.flowUsd ?? value.netFlow) : value);
      if (amount !== null) funds[ticker] = amount;
    }
  }
  return { date, netFlowUsd: flow, totalNetAssetsUsd: assets, btcCloseUsd: btcClose, perEtfUsd: funds };
}
function collectSessions(payload) {
  const found = [];
  const seen = new Set();
  function walk(value, depth) {
    if (!value || depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        const row = normalizeSession(item);
        if (row) {
          if (!seen.has(row.date)) { seen.add(row.date); found.push(row); }
        } else if (item && typeof item === 'object') walk(item, depth + 1);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) walk(child, depth + 1);
        else if (child && typeof child === 'object') {
          const row = normalizeSession(child);
          if (row && !seen.has(row.date)) { seen.add(row.date); found.push(row); }
          else walk(child, depth + 1);
        }
      }
    }
  }
  walk(payload, 0);
  return found.sort((a,b) => a.date.localeCompare(b.date));
}
function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function tanh(n) { const e = Math.exp(2 * clamp(n, -20, 20)); return (e - 1) / (e + 1); }

function calculate(snapshot) {
  const sessions = snapshot.sessions;
  if (sessions.length < 5) throw new Error('ETF_HISTORY_INSUFFICIENT');
  const latest = sessions[sessions.length - 1];
  const previous = sessions.slice(0, -1);
  const windowSum = n => sessions.slice(-n).reduce((sum, row) => sum + row.netFlowUsd, 0);
  const flow5 = windowSum(5), flow21 = windowSum(21), flow63 = windowSum(63);
  const aum = latest.totalNetAssetsUsd || sessions.slice(-21).map(x=>x.totalNetAssetsUsd).filter(Boolean).at(-1) || null;
  const normalized = aum ? flow21 / aum : 0;
  const last5 = sessions.slice(-5).map(x=>x.netFlowUsd);
  const prior5 = sessions.slice(-10,-5).map(x=>x.netFlowUsd);
  const acceleration = mean(last5) - mean(prior5);
  let streak = 0;
  const sign = Math.sign(latest.netFlowUsd);
  if (sign) for (let i=sessions.length-1;i>=0;i--) {
    if (Math.sign(sessions[i].netFlowUsd) !== sign) break;
    streak++;
  }
  const funds = Object.entries(latest.perEtfUsd || {});
  const positiveFunds = funds.filter(([,v])=>v>0).length;
  const negativeFunds = funds.filter(([,v])=>v<0).length;
  const breadth = funds.length ? (positiveFunds-negativeFunds)/funds.length : null;

  // Transparent heuristic score: 50 neutral; components are bounded and not a return probability.
  const s5 = tanh((aum ? flow5/aum : flow5/1e9) * 80);
  const s21 = tanh((aum ? flow21/aum : flow21/1e9) * 35);
  const s63 = tanh((aum ? flow63/aum : flow63/1e9) * 18);
  const sAccel = tanh((aum ? acceleration/aum : acceleration/1e9) * 180);
  const sPersist = sign * Math.min(streak, 5) / 5;
  const sBreadth = breadth === null ? 0 : breadth;
  const components = [
    { name:'Fluxo 5 sessões', weight:0.20, value:s5 },
    { name:'Fluxo 21 sessões', weight:0.25, value:s21 },
    { name:'Fluxo 63 sessões', weight:0.20, value:s63 },
    { name:'Aceleração', weight:0.15, value:sAccel },
    { name:'Persistência', weight:0.10, value:sPersist },
    { name:'Amplitude entre fundos', weight:0.10, value:sBreadth }
  ];
  const raw = components.reduce((sum,c)=>sum+c.weight*c.value,0);
  const score = Math.round(clamp(50 + raw*50, 0, 100));
  const classification = score >= 70 ? 'ACUMULAÇÃO INSTITUCIONAL FORTE'
    : score >= 58 ? 'ACUMULAÇÃO INSTITUCIONAL'
    : score <= 30 ? 'DISTRIBUIÇÃO INSTITUCIONAL FORTE'
    : score <= 42 ? 'DISTRIBUIÇÃO INSTITUCIONAL'
    : 'FLUXO NEUTRO / MISTO';
  const updatedThrough = snapshot.updatedThrough || latest.date;
  const ageDays = Math.max(0, (Date.now() - Date.parse(updatedThrough + 'T23:59:59Z')) / 86400000);
  return {
    engine:'ETF Flow Intelligence v1', score, classification,
    interpretation:'Score de fluxo institucional, não é probabilidade de retorno nem sinal de trade.',
    latestSession:latest, updatedThrough, ageDays:Number(ageDays.toFixed(1)),
    stale:ageDays > 5, totalSessions:sessions.length,
    windows:{sessions5:flow5,sessions21:flow21,sessions63:flow63,aumUsd:aum,flow21PctAum:aum?Number((normalized*100).toFixed(4)):null},
    persistence:{direction:sign>0?'inflow':sign<0?'outflow':'mixed',consecutiveSessions:streak},
    accelerationUsdPerSession:Number(acceleration.toFixed(2)),
    breadth:funds.length?{funds:funds.length,positive:positiveFunds,negative:negativeFunds,net:breadth}:null,
    components:components.map(c=>({name:c.name,weight:c.weight,normalizedValue:Number(c.value.toFixed(4))})),
    source:SOURCE, dataUrl:DATA_URL, methodologyUrl:METHODOLOGY_URL,
    fetchedAt:snapshot.fetchedAt
  };
}

async function load(force = false) {
  if (!force && cache && Date.now()-cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (pending) return pending;
  pending = (async () => {
    const headers = { accept:'application/json', 'user-agent':'BTC-Cycle-Desk/1.0' };
    const [dataResponse, latestResponse] = await Promise.all([
      fetch(DATA_URL,{headers,signal:AbortSignal.timeout(12000)}),
      fetch(LATEST_URL,{headers,signal:AbortSignal.timeout(12000)})
    ]);
    if (!dataResponse.ok || !latestResponse.ok) throw new Error('TFTC_FEED_HTTP_ERROR');
    const [data, latest] = await Promise.all([dataResponse.json(),latestResponse.json()]);
    const sessions = collectSessions(data);
    const latestRow = normalizeSession(latest.latestSession);
    if (latestRow && !sessions.some(x=>x.date===latestRow.date)) sessions.push(latestRow);
    sessions.sort((a,b)=>a.date.localeCompare(b.date));
    if (sessions.length < 5) throw new Error('TFTC_FEED_SCHEMA_UNRECOGNIZED');
    const snapshot = { sessions, updatedThrough:latest.updatedThrough || latestRow?.date || null, fetchedAt:new Date().toISOString() };
    const result = { sessions, updatedThrough:snapshot.updatedThrough, fetchedAt:snapshot.fetchedAt, analysis:calculate(snapshot) };
    cache = result;
    return result;
  })().finally(()=>{ pending=null; });
  return pending;
}

async function getAnalysis(force = false) {
  try {
    const result = await load(force);
    return { ok:true, ...result.analysis, history:result.sessions.slice(-90).map(s=>({date:s.date,netFlowUsd:s.netFlowUsd,totalNetAssetsUsd:s.totalNetAssetsUsd,perEtfUsd:s.perEtfUsd})) };
  } catch (error) {
    if (cache) return { ok:false, stale:true, error:String(error.message||error), ...cache.analysis };
    throw error;
  }
}
module.exports = { getAnalysis, calculate, collectSessions, normalizeSession };
