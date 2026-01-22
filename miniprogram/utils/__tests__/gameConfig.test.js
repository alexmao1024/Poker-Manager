const assert = require("node:assert/strict");
const { GAME_TYPES, defaultGameRules } = require("../gameConfig");

assert.equal(GAME_TYPES.TEXAS, "texas");
assert.equal(GAME_TYPES.ZHAJINHUA, "zhajinhua");
assert.equal(defaultGameRules.texas.blinds.bb, 20);
assert.equal(defaultGameRules.zhj.baseBet, 10);
assert.equal(defaultGameRules.zhj.maxRounds, 20);
