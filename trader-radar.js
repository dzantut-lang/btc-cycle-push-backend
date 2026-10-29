'use strict';
const fs = require('node:fs');
const path = require('node:path');
const HL_WS = 'wss://api.hyperliquid.xyz/ws';
const LEADERBOARD = process.env.HL_LEADERBOARD_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const validAddress = x => typeof x === 'string' && /^0x[a-f0-9]{40}$/i.test(x.trim());
const num = x => Number.isFinite(Number(x)) ? Number(x) : 0;
function windowPnl(row, name) {
  const w = row.windowPerformances || row.windowPerformance || row.performances || [];
  if (Array.isArray(w)) return num((w.find(x => Array.isArray(x) && String(x[0]).toLowerCase() === name.toLowerCase()) || [null, {}])[1]?.pnl);
  return num(w[name]?.pnl);
}
function selectCandidates(payload, minEquity = 10000, max = 25) {
  const rows = Array.isArray(payload) ? payload : payload?.leaderboardRows || payload?.rows || payload?.data;
  if (!Array.isArray(rows)) throw new Error('Schema inesperado no leaderboard Hyperliquid');
  return rows.map(r => ({ address: String(r.ethAddress || r.address || r.user || '').toLowerCase(), displayName: r.displayName || null,
    accountValue: num(r.accountValue ?? r.account_value), weekPnl: windowPnl(r, 'week'), monthPnl: windowPnl(r, 'month'), allTimePnl: windowPnl(r, 'allTime'),
    source: 'Hyperliquid public leaderboard; candidato, não garantia de desempenho' }))
    .filter(r => validAddress(r.address) && r.accountValue >= minEquity && r.weekPnl > 0 && r.monthPnl > 0 && r.allTimePnl > 0)
    .sort((a,b) => b.monthPnl-a.monthPnl).slice(0, max);
}
function classifyFill(fill, address) {
  const startPosition = Number(fill && fill.startPosition); if (!fill || String(fill.coin).toUpperCase() !== 'BTC' || !Number.isFinite(startPosition) || Math.abs(startPosition) > 1e-12) return null;
  const dir = String(fill.dir || '').toLowerCase();
  const direction = dir === 'open long' ? 'LONG' : dir === 'open short' ? 'SHORT' : null;
  const price = num(fill.px), size = num(fill.sz), time = num(fill.time);
  if (!direction || price <= 0 || size <= 0 || time <= 0) return null;
  return { id: [address, fill.hash || '', fill.oid ?? '', fill.tid ?? '', time, fill.coin, fill.side, fill.sz].join(':'),
    type: 'NEW_BTC_ENTRY', symbol: 'BTC', direction, wallet: address, price, size, notionalUsd: price*size,
    timestamp: time, executedAt: new Date(time).toISOString(), transactionHash: fill.hash || null, orderId: fill.oid ?? null,
    source: 'Hyperliquid public userFills stream' };
}
class TraderRadar {
  constructor({dataDir, sendPush, wallets = [], WebSocketImpl = require('ws'), fetchImpl = globalThis.fetch, logger = console} = {}) {
    if (!dataDir) throw new Error('dataDir é obrigatório');
    this.dir = dataDir; fs.mkdirSync(dataDir, {recursive:true}); this.sendPush = sendPush || (async()=>({skipped:'push indisponível'}));
    this.WS = WebSocketImpl; this.fetch = fetchImpl; this.logger = logger; this.running = false; this.sockets = new Map(); this.timers = new Map();
    this.eventsFile = path.join(dataDir,'trader-radar-events.json'); this.walletsFile = path.join(dataDir,'trader-radar-wallets.json'); this.stateFile = path.join(dataDir,'trader-radar-state.json');
    this.events = this.read(this.eventsFile,[]); this.seen = new Set(this.read(path.join(dataDir,'trader-radar-seen.json'),[]));
    const state = this.read(this.stateFile,{}); this.lastDiscoveryAt = state.lastDiscoveryAt || null; this.lastError = state.lastError || null;
    this.initialized = new Set(state.initialized || []); this.cursors = state.cursors || {}; this.wallets = new Map();
    for (const w of [...this.read(this.walletsFile,[]), ...wallets]) this.addWallet(w.address || w, w, false);
  }
  read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return d;}}
  save(){fs.writeFileSync(this.eventsFile,JSON.stringify(this.events.slice(0,500),null,2));fs.writeFileSync(path.join(this.dir,'trader-radar-seen.json'),JSON.stringify([...this.seen].slice(-10000)));fs.writeFileSync(this.walletsFile,JSON.stringify([...this.wallets.values()],null,2));fs.writeFileSync(this.stateFile,JSON.stringify({lastDiscoveryAt:this.lastDiscoveryAt,lastError:this.lastError,initialized:[...this.initialized],cursors:this.cursors},null,2));}
  addWallet(address,meta={},persist=true){if(!validAddress(address))throw new Error('Endereço Hyperliquid inválido');address=address.toLowerCase();const old=this.wallets.get(address)||{};const w={address,displayName:meta.displayName||old.displayName||null,accountValue:meta.accountValue??old.accountValue??null,source:meta.source||old.source||'lista manual',addedAt:old.addedAt||new Date().toISOString()};this.wallets.set(address,w);if(persist)this.save();if(this.running)this.connect(address);return w;}
  removeWallet(address){address=String(address).toLowerCase();this.wallets.delete(address);try{this.sockets.get(address)?.close();}catch{}this.sockets.delete(address);clearTimeout(this.timers.get(address));this.timers.delete(address);this.save();}
  async discoverCandidates(){const res=await this.fetch(LEADERBOARD,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error('Leaderboard HTTP '+res.status);const candidates=selectCandidates(await res.json(),num(process.env.TRADER_RADAR_MIN_ACCOUNT_VALUE)||10000,Math.min(100,num(process.env.TRADER_RADAR_MAX_WALLETS)||25));for(const c of candidates)this.addWallet(c.address,c,false);this.lastDiscoveryAt=new Date().toISOString();this.lastError=null;this.save();return candidates;}
  start(){if(this.running)return;this.running=true;for(const a of this.wallets.keys())this.connect(a);this.discoverCandidates().then(()=>{for(const a of this.wallets.keys())this.connect(a)}).catch(e=>{this.lastError=e.message;this.logger.error('Trader Radar discovery:',e.message);this.save()});this.discoveryTimer=setInterval(()=>this.discoverCandidates().then(()=>{for(const a of this.wallets.keys())if(!this.sockets.has(a))this.connect(a)}).catch(e=>{this.lastError=e.message;this.save()}),Math.max(15,num(process.env.TRADER_RADAR_DISCOVERY_MINUTES)||60)*60000);}
  stop(){this.running=false;clearInterval(this.discoveryTimer);for(const t of this.timers.values())clearTimeout(t);for(const s of this.sockets.values())try{s.close()}catch{}this.timers.clear();this.sockets.clear();}
  connect(address){if(!this.running||this.sockets.has(address)||!this.WS)return;let ws;try{ws=new this.WS(HL_WS)}catch(e){return this.reconnect(address)}this.sockets.set(address,ws);
    ws.addEventListener('open',()=>ws.send(JSON.stringify({method:'subscribe',subscription:{type:'userFills',user:address,aggregateByTime:true}})));
    ws.addEventListener('message',e=>{try{const m=JSON.parse(typeof e.data==='string'?e.data:String(e.data));if(m.channel!=='userFills'||!m.data)return;const d=m.data, fills=Array.isArray(d.fills)?d.fills:[];if(d.isSnapshot){const was=this.initialized.has(address),cursor=num(this.cursors[address]);for(const f of fills.sort((a,b)=>num(a.time)-num(b.time))){const id=this.fillId(address,f);if(was&&num(f.time)>cursor&&!this.seen.has(id))this.processFill(address,f);else{this.seen.add(id);this.cursors[address]=Math.max(num(this.cursors[address]),num(f.time));}}this.initialized.add(address);this.save();return;}for(const f of fills)this.processFill(address,f).catch(err=>this.logger.error(err.message));}catch(err){this.logger.warn('Mensagem Hyperliquid inválida:',err.message);}});
    ws.addEventListener('close',()=>{if(this.sockets.get(address)===ws)this.sockets.delete(address);this.reconnect(address)});ws.addEventListener('error',()=>{try{ws.close()}catch{}});}
  reconnect(a){if(!this.running||this.timers.has(a))return;this.timers.set(a,setTimeout(()=>{this.timers.delete(a);this.connect(a)},5000));}
  fillId(a,f){return [a,f.hash||'',f.oid??'',f.tid??'',f.time,f.coin,f.side,f.sz].join(':');}
  async processFill(address,fill){const id=this.fillId(address,fill);if(this.seen.has(id))return null;this.seen.add(id);this.cursors[address]=Math.max(num(this.cursors[address]),num(fill.time));const e=classifyFill(fill,address);if(!e){this.save();return null;}e.id=id;const w=this.wallets.get(address);e.trader=w?.displayName||address.slice(0,6)+'…'+address.slice(-4);e.walletSource=w?.source||'Hyperliquid';this.events.unshift(e);this.events=this.events.slice(0,500);this.save();const dir=e.direction==='LONG'?'COMPRA (LONG)':'VENDA (SHORT)';try{await this.sendPush({title:'BTC Trader Radar: '+e.direction,body:e.trader+' abriu '+dir+' em BTC a $'+e.price.toLocaleString('en-US')+' · '+e.size+' BTC. Evento público da Hyperliquid; não é recomendação.',tag:'trader-radar-'+id,url:'/?panel=trader-radar',eventType:'trader-radar-new-btc-entry',trade:e});}catch(err){this.logger.error('Trader Radar push:',err.message);}return e;}
  status(){return {ok:true,running:this.running,source:'Hyperliquid public API/WebSocket',websocketUrl:HL_WS,watchedWallets:this.wallets.size,connectedWallets:this.sockets.size,lastDiscoveryAt:this.lastDiscoveryAt,lastError:this.lastError,eventCount:this.events.length,rules:{symbol:'BTC',events:'somente novas entradas',acceptedDirections:['Open Long','Open Short'],requiresFlatStartPosition:true,snapshotAlerts:false,deduplication:true}};}
}
module.exports={TraderRadar,validAddress,classifyNewBtcEntry:classifyFill,selectLeaderboardCandidates:selectCandidates};
