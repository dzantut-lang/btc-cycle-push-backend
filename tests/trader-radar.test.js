const test = require('node:test');
const assert = require('node:assert/strict');
const { validAddress, classifyNewBtcEntry, classifyBtcExit, selectLeaderboardCandidates } = require('../trader-radar');

const wallet = '0x1234567890abcdef1234567890abcdef12345678';
const fill = (overrides = {}) => ({ coin: 'BTC', dir: 'Open Long', startPosition: '0', px: '65000', sz: '0.1', time: 1793290000000, hash: '0xabc', oid: 12, tid: 34, side: 'B', ...overrides });

test('validates Hyperliquid addresses', () => {
  assert.equal(validAddress(wallet), true);
  assert.equal(validAddress('0x123'), false);
  assert.equal(validAddress('not-an-address'), false);
});

test('detects a new BTC long entry from flat', () => {
  const event = classifyNewBtcEntry(fill(), wallet);
  assert.equal(event.direction, 'LONG');
  assert.equal(event.symbol, 'BTC');
  assert.equal(event.notionalUsd, 6500);
  assert.equal(event.type, 'NEW_BTC_ENTRY');
});

test('detects a new BTC short entry from flat', () => {
  const event = classifyNewBtcEntry(fill({ dir: 'Open Short', side: 'A' }), wallet);
  assert.equal(event.direction, 'SHORT');
});

test('ignores scale-ins, closes, reductions, other coins and missing starting position', () => {
  assert.equal(classifyNewBtcEntry(fill({ startPosition: '0.1' }), wallet), null);
  assert.equal(classifyNewBtcEntry(fill({ dir: 'Close Long' }), wallet), null);
  assert.equal(classifyNewBtcEntry(fill({ dir: 'Reduce Long' }), wallet), null);
  assert.equal(classifyNewBtcEntry(fill({ coin: 'ETH' }), wallet), null);
  assert.equal(classifyNewBtcEntry(fill({ startPosition: undefined }), wallet), null);
});

test('rejects incomplete or invalid fills', () => {
  assert.equal(classifyNewBtcEntry(fill({ px: '0' }), wallet), null);
  assert.equal(classifyNewBtcEntry(fill({ sz: '-1' }), wallet), null);
  assert.equal(classifyNewBtcEntry(fill({ time: 0 }), wallet), null);
});

test('selects only valid, sufficiently funded candidates with positive weekly/monthly/all-time PnL', () => {
  const row = (address, accountValue, week, month, allTime) => ({
    ethAddress: address, accountValue,
    windowPerformances: [['week', { pnl: week }], ['month', { pnl: month }], ['allTime', { pnl: allTime }]]
  });
  const candidates = selectLeaderboardCandidates([
    row(wallet, 20000, 100, 500, 1000),
    row('bad-address', 20000, 100, 500, 1000),
    row('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 9000, 100, 500, 1000),
    row('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 20000, -1, 500, 1000)
  ], 10000, 25);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].address, wallet);
});

test('rejects unexpected leaderboard response shapes', () => {
  assert.throws(() => selectLeaderboardCandidates({ nope: true }), /Schema inesperado/);
});

test('detects a full BTC long exit with actual execution price and realized PnL', () => {
  const event = classifyBtcExit(fill({ dir: 'Close Long', startPosition: '0.1', px: '67000', sz: '0.1', side: 'A', closedPnl: '200' }), wallet);
  assert.equal(event.type, 'BTC_POSITION_EXIT');
  assert.equal(event.direction, 'CLOSE_LONG');
  assert.equal(event.price, 67000);
  assert.equal(event.closedPnl, 200);
  assert.equal(event.isFullClose, true);
});
test('marks partial exits as reductions, not full closes', () => {
  const event = classifyBtcExit(fill({ dir: 'Close Short', startPosition: '-0.2', px: '64000', sz: '0.1', side: 'B', closedPnl: '50' }), wallet);
  assert.equal(event.direction, 'CLOSE_SHORT');
  assert.equal(event.isFullClose, false);
  assert.equal(event.remainingPosition, -0.1);
});
test('ignores invalid exit events and other assets', () => {
  assert.equal(classifyBtcExit(fill({ dir: 'Close Long', startPosition: '0.1', sz: '0.1', side: 'A' }), wallet), null);
  assert.equal(classifyBtcExit(fill({ dir: 'Close Long', startPosition: '0.1', sz: '0.1', side: 'A', closedPnl: '10', coin: 'ETH' }), wallet), null);
});
