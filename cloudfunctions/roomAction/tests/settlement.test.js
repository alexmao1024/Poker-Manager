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
