const assert = require("node:assert/strict");
const { startZhjRound } = require("../domain/zhajinhua");

const table = {
  status: "lobby",
  actionTimeoutSec: 0,
  gameRules: { baseBet: 10 },
  players: [
    { id: "p1", stack: 50, bet: 0, handBet: 0, actedRound: 0, status: "active", seen: false },
    { id: "p2", stack: 10, bet: 0, handBet: 0, actedRound: 0, status: "active", seen: false },
  ],
};

const result = startZhjRound({ table, now: 0, dealerIndex: 0 });
assert.equal(result.players[0].stack, 40);
assert.equal(result.players[0].handBet, 10);
assert.equal(result.players[0].bet, 0);
assert.equal(result.players[1].stack, 0);
assert.equal(result.players[1].status, "allin");
assert.equal(result.turnIndex, 0);
assert.equal(result.zjhRoundCount, 1);

const sponsorTable = {
  status: "active",
  actionTimeoutSec: 0,
  zjhNextAnteSponsorId: "p1",
  gameRules: { baseBet: 10 },
  players: [
    { id: "p1", stack: 100, bet: 0, handBet: 0, actedRound: 0, status: "active", seen: false },
    { id: "p2", stack: 100, bet: 0, handBet: 0, actedRound: 0, status: "active", seen: false },
    { id: "p3", stack: 100, bet: 0, handBet: 0, actedRound: 0, status: "active", seen: false },
  ],
};

const sponsorResult = startZhjRound({ table: sponsorTable, now: 0, dealerIndex: 1 });
assert.equal(sponsorResult.players[0].handBet, 30);
assert.equal(sponsorResult.players[0].stack, 70);
assert.equal(sponsorResult.players[1].handBet, 0);
assert.equal(sponsorResult.players[2].handBet, 0);
assert.equal(sponsorResult.pot, 30);
assert.equal(sponsorResult.zjhNextAnteSponsorId, null);
