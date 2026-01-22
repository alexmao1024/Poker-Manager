const assert = require("node:assert/strict");
const { buildCreateRoomPayload } = require("../roomPayloads");

const payload = buildCreateRoomPayload({
  gameType: "zhajinhua",
  seatCount: 6,
  zhjBaseBet: 10,
  zhjBuyIn: 2000,
  zhjMaxRounds: 20,
  zhjMinSeeRound: 3,
});

assert.equal(payload.gameType, "zhajinhua");
assert.equal(payload.maxSeats, 6);
assert.equal(payload.stack, 2000);
assert.equal(payload.gameRules.baseBet, 10);
assert.equal(payload.gameRules.maxRounds, 20);
