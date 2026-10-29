const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TraderRadar } = require('../trader-radar');

const wallet = '0x1234567890abcdef1234567890abcdef12345678';
const logger = { error(){}, warn(){}, info(){} };
function makeRadar() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-radar-'));
  const radar = new TraderRadar({ dataDir, sendPush: async () => ({sent: 1}), WebSocketImpl: null, logger });
  radar.addWallet(wallet, {displayName:'Test Trader', accountValue:20000}, false);
  return {radar, cleanup:()=>fs.rmSync(dataDir,{recursive:true,force:true})};
}
function fill(overrides={}) {
  return {coin:'BTC',dir:'Open Long',startPosition:'0',px:'65000',sz:'0.1',time:1793290000000,hash:'0xabc',oid:12,tid:34,side:'B',closedPnl:'0',...overrides};
}

test('counts only observed completed BTC cycles, including partial closes', async () => {
  const {radar,cleanup}=makeRadar();
  try {
    await radar.processFill(wallet,fill());
    await radar.processFill(wallet,fill({dir:'Close Long',startPosition:'0.1',sz:'0.05',side:'A',closedPnl:'5',time:1793290001000,hash:'0xdef',tid:35}));
    assert.equal(radar.rankedTraders()[0].performance.closedTrades,0);
    await radar.processFill(wallet,fill({dir:'Close Long',startPosition:'0.05',sz:'0.05',side:'A',closedPnl:'5',time:1793290002000,hash:'0xghi',tid:36}));
    const m=radar.rankedTraders()[0].performance;
    assert.equal(m.closedTrades,1);
    assert.equal(m.wins,1);
    assert.equal(m.winRate,1);
    assert.equal(m.realizedPnl,10);
  } finally { cleanup(); }
});

test('does not count a close if the entry predates radar observation', async () => {
  const {radar,cleanup}=makeRadar();
  try {
    await radar.processFill(wallet,fill({dir:'Close Long',startPosition:'0.1',sz:'0.1',side:'A',closedPnl:'500',time:1793290001000,hash:'0xold',tid:40}));
    assert.equal(radar.rankedTraders()[0].performance.closedTrades,0);
    assert.equal(radar.rankedTraders()[0].performance.realizedPnl,0);
  } finally { cleanup(); }
});
