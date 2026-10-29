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
function classifyCloseFill(fill, address) {
  if (!fill || String(fill.coin).toUpperCase() !== 'BTC') return null;
  const dir = String(fill.dir || '').toLowerCase();
  if (dir !== 'close long' && dir !== 'close short') return null;
  const startPosition = Number(fill.startPosition), price = num(fill.px), size = num(fill.sz), time = num(fill.time);
  const closedPnl = Number(fill.closedPnl);
  if (!Number.isFinite(startPosition) || Math.abs(startPosition) < 1e-12 || price <= 0 || size <= 0 || time <= 0) return null;
  const delta = String(fill.side || '').toUpperCase() === 'B' ? size : -size;
  const remainingPosition = startPosition + delta;
  const isFullClose = Math.abs(remainingPosition) < 1e-8;
  return { id:[address,fill.hash||'',fill.oid??'',fill.tid??'',time,fill.coin,fill.side,fill.sz].join(':'), type:'BTC_POSITION_EXIT',
    symbol:'BTC', direction:dir==='close long'?'CLOSE_LONG':'CLOSE_SHORT', wallet:address, price, size, notionalUsd:price*size,
    closedPnl:Number.isFinite(closedPnl)?closedPnl:null, timestamp:time, executedAt:new Date(time).toISOString(),
    isFullClose, remainingPosition, transactionHash:fill.hash||null, orderId:fill.oid??null, source:'Hyperliquid public userFills stream' };
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
    this.WS = WebSocketImpl; this.fetch = fetchImpl; this.logger = logger; this.running = false; this.sockets = new Map(); this.timers = new Map(); this.heartbeats = new Map();
    this.eventsFile = path.join(dataDir,'trader-radar-events.json'); this.walletsFile = path.join(dataDir,'trader-radar-wallets.json'); this.stateFile = path.join(dataDir,'trader-radar-state.json');
    this.events = this.read(this.eventsFile,[]); this.seen = new Set(this.read(path.join(dataDir,'trader-radar-seen.json'),[]));
    const state = this.read(this.stateFile,{}); this.lastDiscoveryAt = state.lastDiscoveryAt || null; this.lastError = state.lastError || null;
    this.initialized = new Set(state.initialized || []); this.cursors = state.cursors || {}; this.closeCycles = state.closeCycles || {}; this.performance = state.performance || {}; this.wallets = new Map();
    for (const w of [...this.read(this.walletsFile,[]), ...wallets]) this.addWallet(w.address || w, w, false);
  }
  read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return d;}}
  save(){fs.writeFileSync(this.eventsFile,JSON.stringify(this.events.slice(0,500),null,2));fs.writeFileSync(path.join(this.dir,'trader-radar-seen.json'),JSON.stringify([...this.seen].slice(-10000)));fs.writeFileSync(this.walletsFile,JSON.stringify([...this.wallets.values()],null,2));fs.writeFileSync(this.stateFile,JSON.stringify({lastDiscoveryAt:this.lastDiscoveryAt,lastError:this.lastError,initialized:[...this.initialized],cursors:this.cursors,closeCycles:this.closeCycles,performance:this.performance},null,2));}
  addWallet(address,meta={},persist=true){if(!validAddress(address))throw new Error('Endereço Hyperliquid inválido');address=address.toLowerCase();const old=this.wallets.get(address)||{};const w={address,displayName:meta.displayName||old.displayName||null,accountValue:meta.accountValue??old.accountValue??null,weekPnl:meta.weekPnl??old.weekPnl??null,monthPnl:meta.monthPnl??old.monthPnl??null,allTimePnl:meta.allTimePnl??old.allTimePnl??null,source:meta.source||old.source||'lista manual',addedAt:old.addedAt||new Date().toISOString()};this.wallets.set(address,w);if(persist)this.save();if(this.running)this.connect(address);return w;}
  removeWallet(address){address=String(address).toLowerCase();this.wallets.delete(address);try{this.sockets.get(address)?.close();}catch{}this.sockets.delete(address);clearTimeout(this.timers.get(address));this.timers.delete(address);clearInterval(this.heartbeats.get(address));this.heartbeats.delete(address);this.save();}
  async discoverCandidates(){const res=await this.fetch(LEADERBOARD,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error('Leaderboard HTTP '+res.status);const candidates=selectCandidates(await res.json(),num(process.env.TRADER_RADAR_MIN_ACCOUNT_VALUE)||10000,Math.min(100,num(process.env.TRADER_RADAR_MAX_WALLETS)||25));const keep=new Set(candidates.map(c=>c.address));for(const [a,w] of this.wallets)if(String(w.source||'').includes('public leaderboard')&&!keep.has(a))this.removeWallet(a);for(const c of candidates)this.addWallet(c.address,c,false);this.lastDiscoveryAt=new Date().toISOString();this.lastError=null;this.save();return candidates;}
  start(){if(this.running)return;this.running=true;for(const a of this.wallets.keys())this.connect(a);this.discoverCandidates().then(()=>{for(const a of this.wallets.keys())this.connect(a)}).catch(e=>{this.lastError=e.message;this.logger.error('Trader Radar discovery:',e.message);this.save()});this.discoveryTimer=setInterval(()=>this.discoverCandidates().then(()=>{for(const a of this.wallets.keys())if(!this.sockets.has(a))this.connect(a)}).catch(e=>{this.lastError=e.message;this.save()}),Math.max(60,num(process.env.TRADER_RADAR_DISCOVERY_MINUTES)||360)*60000);}
  stop(){this.running=false;clearInterval(this.discoveryTimer);for(const t of this.timers.values())clearTimeout(t);for(const t of this.heartbeats.values())clearInterval(t);for(const s of this.sockets.values())try{s.close()}catch{}this.timers.clear();this.heartbeats.clear();this.sockets.clear();}
  connect(address){if(!this.running||this.sockets.has(address)||!this.WS)return;let ws;try{ws=new this.WS(HL_WS)}catch(e){return this.reconnect(address)}this.sockets.set(address,ws);
    ws.addEventListener('open',()=>{ws.send(JSON.stringify({method:'subscribe',subscription:{type:'userFills',user:address,aggregateByTime:true}}));clearInterval(this.heartbeats.get(address));this.heartbeats.set(address,setInterval(()=>{try{if(ws.readyState===1)ws.send(JSON.stringify({method:'ping'}));}catch{}},25000));});
    ws.addEventListener('message',e=>{try{const m=JSON.parse(typeof e.data==='string'?e.data:String(e.data));if(m.channel!=='userFills'||!m.data)return;const d=m.data, fills=Array.isArray(d.fills)?d.fills:[];if(d.isSnapshot){const was=this.initialized.has(address),cursor=num(this.cursors[address]);for(const f of fills.sort((a,b)=>num(a.time)-num(b.time))){const id=this.fillId(address,f);if(was&&num(f.time)>cursor&&!this.seen.has(id))this.processFill(address,f);else{this.seen.add(id);this.cursors[address]=Math.max(num(this.cursors[address]),num(f.time));}}this.initialized.add(address);this.save();return;}for(const f of fills)this.processFill(address,f).catch(err=>this.logger.error(err.message));}catch(err){this.logger.warn('Mensagem Hyperliquid inválida:',err.message);}});
    ws.addEventListener('close',()=>{if(this.sockets.get(address)===ws)this.sockets.delete(address);clearInterval(this.heartbeats.get(address));this.heartbeats.delete(address);this.reconnect(address)});ws.addEventListener('error',()=>{try{ws.close()}catch{}});}
  reconnect(a){if(!this.running||this.timers.has(a))return;this.timers.set(a,setTimeout(()=>{this.timers.delete(a);this.connect(a)},5000));}
  fillId(a,f){return [a,f.hash||'',f.oid??'',f.tid??'',f.time,f.coin,f.side,f.sz].join(':');}
  recordClosedTrade(address,fill){
    if(String(fill.coin).toUpperCase()!=='BTC')return;
    const dir=String(fill.dir||'').toLowerCase();
    if(dir!=='close long'&&dir!=='close short')return;
    const start=Number(fill.startPosition),size=num(fill.sz),closedPnl=Number(fill.closedPnl);
    if(!Number.isFinite(start)||!Number.isFinite(closedPnl)||size<=0)return;
    const signedDelta=String(fill.side).toUpperCase()==='B'?size:-size;
    const end=start+signedDelta;
    const cycle=this.closeCycles[address];
    // Only score a round trip when its entry was observed by this radar.
    if(!cycle)return;
    cycle.realizedPnl+=closedPnl;cycle.fills+=1;cycle.direction=dir==='close long'?'LONG':'SHORT';
    if(Math.abs(end)<1e-8){
      const m=this.performance[address]||{closedTrades:0,wins:0,losses:0,breakeven:0,realizedPnl:0,grossProfit:0,grossLoss:0,avgPnl:0,lastCloseAt:null};
      const pnl=cycle.realizedPnl;m.closedTrades+=1;m.realizedPnl+=pnl;
      if(pnl>0){m.wins+=1;m.grossProfit+=pnl;}else if(pnl<0){m.losses+=1;m.grossLoss+=Math.abs(pnl);}else m.breakeven+=1;
      m.avgPnl=m.realizedPnl/m.closedTrades;m.winRate=m.wins/Math.max(1,m.wins+m.losses);
      m.profitFactor=m.grossLoss>0?m.grossProfit/m.grossLoss:(m.grossProfit>0?3:0);m.profitFactorCapped=m.grossLoss===0&&m.grossProfit>0;
      m.lastCloseAt=new Date(num(fill.time)).toISOString();this.performance[address]=m;delete this.closeCycles[address];
    }else this.closeCycles[address]=cycle;
  }
  rankedTraders(){
    return [...this.wallets.values()].map(w=>{const m=this.performance[w.address]||{closedTrades:0,wins:0,losses:0,realizedPnl:0,winRate:0,profitFactor:0};const eligible=m.closedTrades>=20&&m.realizedPnl>0&&m.profitFactor>=1.2;
      const score=eligible?Math.round(Math.min(35,m.winRate*35)+Math.min(25,(m.profitFactor||0)/2*25)+Math.min(20,Math.max(0,m.realizedPnl)/(Math.max(1,w.accountValue||10000))*100)+Math.min(20,m.closedTrades/100*20)):null;
      return {...w,performance:m,eligibleForRanking:eligible,score,rankingNote:eligible?'Amostra observada suficiente; ainda sem ajuste completo de drawdown/alavancagem':'Sem amostra suficiente ou critérios de rentabilidade/profit factor não atendidos'};
    }).sort((a,b)=>(b.score??-1)-(a.score??-1));
  }
  async processFill(address,fill){
    const id=this.fillId(address,fill);if(this.seen.has(id))return null;
    this.seen.add(id);if(this.seen.size>12000){const oldest=this.seen.values().next().value;this.seen.delete(oldest);}
    this.cursors[address]=Math.max(num(this.cursors[address]),num(fill.time));
    this.recordClosedTrade(address,fill);
    const entry=classifyFill(fill,address), exit=classifyCloseFill(fill,address), e=entry||exit;
    if(!e){this.save();return null;}
    e.id=id;const w=this.wallets.get(address);e.trader=w?.displayName||address.slice(0,6)+'…'+address.slice(-4);e.walletSource=w?.source||'Hyperliquid';
    if(entry&&!this.closeCycles[address])this.closeCycles[address]={realizedPnl:0,direction:e.direction,fills:0,openedAt:e.executedAt};
    this.events.unshift(e);this.events=this.events.slice(0,500);this.save();
    const isEntry=e.type==='NEW_BTC_ENTRY';
    const title=isEntry?'BTC Trader Radar: '+e.direction:'BTC Trader Radar: '+(e.isFullClose?'SAÍDA':'REDUÇÃO')+' '+e.direction;
    const body=isEntry
      ? e.trader+' abriu '+(e.direction==='LONG'?'COMPRA (LONG)':'VENDA (SHORT)')+' em BTC a   status(){return {ok:true,running:this.running,source:'Hyperliquid public API/WebSocket',websocketUrl:HL_WS,watchedWallets:this.wallets.size,connectedWallets:this.sockets.size,lastDiscoveryAt:this.lastDiscoveryAt,lastError:this.lastError,eventCount:this.events.length,rankedEligible:this.rankedTraders().filter(x=>x.eligibleForRanking).length,rankingMinimumClosedTrades:20,rules:{symbol:'BTC',events:'somente novas entradas',acceptedDirections:['Open Long','Open Short'],requiresFlatStartPosition:true,snapshotAlerts:false,deduplication:true}};}
}
module.exports={TraderRadar,validAddress,classifyNewBtcEntry:classifyFill,classifyBtcExit:classifyCloseFill,selectLeaderboardCandidates:selectCandidates};
+e.price.toLocaleString('en-US')+' · '+e.size+' BTC. Entrada pública observada; não é recomendação.'
      : e.trader+' '+(e.isFullClose?'encerrou':'reduziu')+' '+(e.direction==='CLOSE_LONG'?'LONG':'SHORT')+' em BTC a   status(){return {ok:true,running:this.running,source:'Hyperliquid public API/WebSocket',websocketUrl:HL_WS,watchedWallets:this.wallets.size,connectedWallets:this.sockets.size,lastDiscoveryAt:this.lastDiscoveryAt,lastError:this.lastError,eventCount:this.events.length,rankedEligible:this.rankedTraders().filter(x=>x.eligibleForRanking).length,rankingMinimumClosedTrades:20,rules:{symbol:'BTC',events:'somente novas entradas',acceptedDirections:['Open Long','Open Short'],requiresFlatStartPosition:true,snapshotAlerts:false,deduplication:true}};}
}
module.exports={TraderRadar,validAddress,classifyNewBtcEntry:classifyFill,selectLeaderboardCandidates:selectCandidates};
+e.price.toLocaleString('en-US')+' · '+e.size+' BTC'+(e.closedPnl===null?'': ' · PnL realizado nesta execução: '+e.closedPnl.toLocaleString('en-US',{style:'currency',currency:'USD'}))+'. Evento público observado; não é recomendação.';
    try{await this.sendPush({title,body,tag:'trader-radar-'+id,url:'/?panel=trader-radar',eventType:isEntry?'trader-radar-new-btc-entry':'trader-radar-position-exit',trade:e});}
    catch(err){this.logger.error('Trader Radar push:',err.message);}
    return e;
  }
  status(){return {ok:true,running:this.running,source:'Hyperliquid public API/WebSocket',websocketUrl:HL_WS,watchedWallets:this.wallets.size,connectedWallets:this.sockets.size,lastDiscoveryAt:this.lastDiscoveryAt,lastError:this.lastError,eventCount:this.events.length,rankedEligible:this.rankedTraders().filter(x=>x.eligibleForRanking).length,rankingMinimumClosedTrades:20,rules:{symbol:'BTC',events:'somente novas entradas',acceptedDirections:['Open Long','Open Short'],requiresFlatStartPosition:true,snapshotAlerts:false,deduplication:true}};}
}
module.exports={TraderRadar,validAddress,classifyNewBtcEntry:classifyFill,selectLeaderboardCandidates:selectCandidates};
