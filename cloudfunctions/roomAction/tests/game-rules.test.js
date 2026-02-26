const assert = require("node:assert/strict");
const { normalizeGameRules } = require("../domain/gameRules");

const zhj = normalizeGameRules("zhajinhua", { baseBet: 5, buyIn: 1000, maxSeats: 20 });
assert.equal(zhj.gameType, "zhajinhua");
assert.equal(zhj.rules.maxSeats, 12);
assert.equal(zhj.rules.baseBet, 5);
assert.equal(zhj.rules.rebuyLimit, 1000);

const texas = normalizeGameRules("texas", { blinds: { sb: 5, bb: 10 }, stack: 1500 });
assert.equal(texas.gameType, "texas");
assert.equal(texas.rules.blinds.bb, 10);
assert.equal(texas.rules.stack, 1500);
assert.equal(texas.rules.actionTimeoutSec, 0);
