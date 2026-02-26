const assert = require("node:assert/strict");
const { settlePot } = require("../domain/settlement");

const players = [
  { id: "p1", stack: 0, bet: 10, handBet: 0, status: "active" },
  { id: "p2", stack: 0, bet: 10, handBet: 0, status: "active" },
];

const result = settlePot(players, [["p1"]]);
const p1 = result.find((player) => player.id === "p1");
const p2 = result.find((player) => player.id === "p2");

assert.equal(p1.stack, 20);
assert.equal(p1.bet, 0);
assert.equal(p2.stack, 0);
assert.equal(p2.bet, 0);

const mergedPotPlayers = [
  { id: "p1", stack: 0, bet: 100, handBet: 0, status: "active" },
  { id: "p2", stack: 0, bet: 80, handBet: 0, status: "active" },
  { id: "p3", stack: 0, bet: 20, handBet: 0, status: "fold" },
];
const mergedResult = settlePot(mergedPotPlayers, [["p2"], ["p1"]]);
const mergedP1 = mergedResult.find((player) => player.id === "p1");
const mergedP2 = mergedResult.find((player) => player.id === "p2");
const mergedP3 = mergedResult.find((player) => player.id === "p3");

assert.equal(mergedP1.stack, 20);
assert.equal(mergedP2.stack, 180);
assert.equal(mergedP3.stack, 0);

const deadTailPlayers = [
  { id: "p1", stack: 0, bet: 80, handBet: 0, status: "active" },
  { id: "p2", stack: 0, bet: 80, handBet: 0, status: "active" },
  { id: "p3", stack: 0, bet: 100, handBet: 0, status: "fold" },
];
const deadTailResult = settlePot(deadTailPlayers, [["p1"]]);
const deadTailP1 = deadTailResult.find((player) => player.id === "p1");
const deadTailP2 = deadTailResult.find((player) => player.id === "p2");
const deadTailP3 = deadTailResult.find((player) => player.id === "p3");

assert.equal(deadTailP1.stack, 260);
assert.equal(deadTailP2.stack, 0);
assert.equal(deadTailP3.stack, 0);
