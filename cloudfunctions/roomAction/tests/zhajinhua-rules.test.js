const assert = require("node:assert/strict");
const { calcPayAmount, canCompare, advanceRound } = require("../domain/zhajinhua");

assert.equal(calcPayAmount({ baseBet: 10 }, false, 10), 10);
assert.equal(calcPayAmount({ baseBet: 10 }, true, 10), 20);
assert.equal(canCompare({ compareAllowedAfter: 3 }, 2, true), false);
assert.equal(canCompare({ compareAllowedAfter: 3 }, 3, true), true);

const round = advanceRound({ roundCount: 1, maxRounds: 2, allActed: true, allMatched: true });
assert.equal(round.roundCount, 2);
assert.equal(round.forceShowdown, true);
