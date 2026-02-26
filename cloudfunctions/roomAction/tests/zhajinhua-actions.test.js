const assert = require("node:assert/strict");
const { applyZhjAction } = require("../domain/zhajinhua");

const baseTable = {
  status: "active",
  round: "betting",
  settled: false,
  turnIndex: 0,
  actionTimeoutSec: 0,
  zjhRoundCount: 1,
  zjhStage: "betting",
  gameRules: {
    baseBet: 10,
    minSeeRound: 1,
    compareAllowedAfter: 3,
    maxRounds: 20,
  },
  players: [
    {
      id: "p1",
      openId: "o1",
      stack: 100,
      bet: 10,
      handBet: 10,
      actedRound: 0,
      status: "active",
      seen: false,
    },
    {
      id: "p2",
      openId: "o2",
      stack: 100,
      bet: 10,
      handBet: 10,
      actedRound: 0,
      status: "active",
      seen: false,
    },
  ],
};

const result = applyZhjAction({
  table: baseTable,
  type: "see",
  expected: { turnIndex: 0, round: "betting", settled: false },
  openId: "o1",
  now: 0,
});

assert.equal(result.players[0].seen, true);
assert.equal(result.turnIndex, 1);

const callTable = {
  ...baseTable,
  players: [
    {
      id: "p1",
      openId: "o1",
      stack: 100,
      bet: 0,
      handBet: 0,
      actedRound: 0,
      status: "active",
      seen: false,
    },
    {
      id: "p2",
      openId: "o2",
      stack: 100,
      bet: 0,
      handBet: 0,
      actedRound: 0,
      status: "active",
      seen: false,
    },
  ],
};

const callResult = applyZhjAction({
  table: callTable,
  type: "call",
  expected: { turnIndex: 0, round: "betting", settled: false },
  openId: "o1",
  now: 0,
});

assert.equal(callResult.players[0].stack, 90);
assert.equal(callResult.players[0].bet, 10);

const compareBlockedTable = {
  ...baseTable,
  turnIndex: 0,
  zjhRoundCount: 3,
  gameRules: {
    ...baseTable.gameRules,
    compareAllowedAfter: 3,
  },
  zjhBanCompareWhenDark: true,
  zjhAllowHeadsUpMixedCompare: true,
  players: [
    {
      id: "p1",
      openId: "o1",
      stack: 100,
      bet: 10,
      handBet: 10,
      actedRound: 0,
      status: "active",
      seen: true,
    },
    {
      id: "p2",
      openId: "o2",
      stack: 100,
      bet: 10,
      handBet: 10,
      actedRound: 0,
      status: "active",
      seen: true,
    },
    {
      id: "p3",
      openId: "o3",
      stack: 100,
      bet: 10,
      handBet: 10,
      actedRound: 0,
      status: "active",
      seen: false,
    },
  ],
};

assert.throws(
  () =>
    applyZhjAction({
      table: compareBlockedTable,
      type: "compare",
      targetId: "p2",
      result: "win",
      expected: { turnIndex: 0, round: "betting", settled: false },
      openId: "o1",
      now: 0,
    }),
  /CANNOT_COMPARE_DARK/
);

const headsUpMixedAllowedTable = {
  ...baseTable,
  zjhRoundCount: 3,
  gameRules: {
    ...baseTable.gameRules,
    compareAllowedAfter: 3,
  },
  zjhBanCompareWhenDark: true,
  zjhAllowHeadsUpMixedCompare: false,
  players: [
    {
      id: "p1",
      openId: "o1",
      stack: 100,
      bet: 10,
      handBet: 10,
      actedRound: 0,
      status: "active",
      seen: true,
    },
    {
      id: "p2",
      openId: "o2",
      stack: 100,
      bet: 10,
      handBet: 10,
      actedRound: 0,
      status: "active",
      seen: false,
    },
  ],
};

const headsUpCompareResult = applyZhjAction({
  table: headsUpMixedAllowedTable,
  type: "compare",
  targetId: "p2",
  result: "win",
  expected: { turnIndex: 0, round: "betting", settled: false },
  openId: "o1",
  now: 0,
});

assert.equal(headsUpCompareResult.players[1].status, "fold");
