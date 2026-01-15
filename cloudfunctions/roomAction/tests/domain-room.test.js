const assert = require("node:assert/strict");
const { calcCurrentBet, getNextActiveIndex } = require("../domain/room");

const players = [
  { bet: 10, status: "active" },
  { bet: 20, status: "fold" },
  { bet: 15, status: "active" },
];

assert.equal(calcCurrentBet(players), 20);
assert.equal(getNextActiveIndex(players, 0), 2);
