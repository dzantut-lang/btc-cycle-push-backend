const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyNewBtcEntry,
  classifyBtcExit,
  selectLeaderboardCandidates
} = require('../trader-radar');

const wallet = '0x' + 'a'.repeat(40);

test('classifies a new BTC long entry only from a flat start position', () => {
  const fill = { coin: 'BTC', dir: 'Open Long', startPosition: '0', px: '65000', sz: '0.1', time: 1793300000000, side: 'B', hash: 'h1', oid: 1, tid: 2 };
  const event = classifyNewBtcEntry(fill, wallet);
  assert.equal(event.direction, 'LONG');
  assert.equal(event.type, 'NEW_BTC_ENTRY');
  assert.equal(event.notionalUsd, 6500);
  assert.equal(classifyNewBtcEntry({ ...fill, startPosition: '0.2' }, wallet), null);
});

test('classifies a full BTC long close and a partial close distinctly', () => {
  const base = { coin: 'BTC', dir: 'Close Long', startPosition: '0.1', px: '66000', sz: '0.1', time: 1793300000000, side: 'A', hash: 'h2', oid: 2, tid: 3, closedPnl: '100' };
  const full = classifyBtcExit(base, wallet);
  assert.equal(full.direction, 'CLOSE_LONG');
  assert.equal(full.isFullClose, true);
  assert.equal(full.remainingPosition, 0);
  const partial = classifyBtcExit({ ...base, sz: '0.04' }, wallet);
  assert.equal(partial.isFullClose, false);
  assert.ok(Math.abs(partial.remainingPosition - 0.06) < 1e-9);
});

test('ignores non-BTC fills and unrecognized directions', () => {
  const base = { coin: 'ETH', dir: 'Open Long', startPosition: '0', px: '3000', sz: '1', time: 1793300000000, side: 'B' };
  assert.equal(classifyNewBtcEntry(base, wallet), null);
  assert.equal(classifyBtcExit({ ...base, coin: 'BTC', dir: 'Liquidation' }, wallet), null);
});

test('leaderboard candidates require valid addresses, equity, and positive week/month/all-time PnL', () => {
  const candidate = {
    ethAddress: wallet,
    accountValue: '20000',
    windowPerformances: [
      ['week', { pnl: '100' }],
      ['month', { pnl: '500' }],
      ['allTime', { pnl: '1000' }]
    ]
  };
  const selected = selectLeaderboardCandidates([candidate], 10000, 25);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].address, wallet);
  assert.equal(selectLeaderboardCandidates([{ ...candidate, accountValue: '500' }], 10000, 25).length, 0);
  assert.equal(selectLeaderboardCandidates([{ ...candidate, windowPerformances: [['week', { pnl: '-1' }], ['month', { pnl: '500' }], ['allTime', { pnl: '1000' }]] }], 10000, 25).length, 0);
});
