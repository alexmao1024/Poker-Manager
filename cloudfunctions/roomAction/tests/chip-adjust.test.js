const assert = require("node:assert/strict");
const { normalizeChipAdjustInput, applyChipAdjustToPlayers } = require("../domain/chipAdjust");

assert.deepEqual(normalizeChipAdjustInput({ amount: 100, mode: "add", note: "喜钱" }), {
  delta: 100,
  note: "喜钱",
});

assert.deepEqual(normalizeChipAdjustInput({ amount: 30, mode: "sub", note: "  修正  " }), {
  delta: -30,
  note: "修正",
});

assert.throws(() => normalizeChipAdjustInput({ amount: 0, mode: "add" }), /INVALID_AMOUNT/);
assert.throws(() => normalizeChipAdjustInput({ amount: -1, mode: "add" }), /INVALID_AMOUNT/);
assert.throws(() => normalizeChipAdjustInput({ amount: 10, mode: "mul" }), /INVALID_MODE/);

const nextPlayers = applyChipAdjustToPlayers(
  [
    { id: "p1", stack: 100 },
    { id: "p2", stack: 50 },
  ],
  "p2",
  -20
);
assert.equal(nextPlayers[1].stack, 30);
assert.equal(nextPlayers[0].stack, 100);

assert.throws(
  () => applyChipAdjustToPlayers([{ id: "p1", stack: 10 }], "p1", -20),
  /STACK_NEGATIVE/
);
assert.throws(
  () => applyChipAdjustToPlayers([{ id: "p1", stack: 10 }], "pX", 5),
  /INVALID_TARGET/
);
