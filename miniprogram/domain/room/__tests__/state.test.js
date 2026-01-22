const assert = require("node:assert/strict");
const { normalizeRoom, calcCurrentBet, getNextActiveIndex } = require("../state");

const players = [
  { bet: 10, status: "active" },
  { bet: 20, status: "fold" },
  { bet: 15, status: "active" },
];

assert.equal(calcCurrentBet(players), 20);
assert.equal(getNextActiveIndex(players, 0), 2);

const room = normalizeRoom({ players, round: "flop" });
assert.equal(room.round, "flop");
assert.equal(room.players.length, 3);

const zhjRoom = normalizeRoom({ gameType: "zhajinhua", zjhRoundCount: 2 });
assert.equal(zhjRoom.gameType, "zhajinhua");
assert.equal(zhjRoom.zjhRoundCount, 2);
