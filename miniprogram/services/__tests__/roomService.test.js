const assert = require("node:assert/strict");
const { createRoomService } = require("../roomService");

(async () => {
  const calls = [];
  const service = createRoomService(async (args) => {
    calls.push(args);
    return { result: { ok: true } };
  });

  await service.createRoom({ maxSeats: 6 }, { name: "A" });
  assert.equal(calls[0].name, "roomAction");
  assert.equal(calls[0].data.action, "create");

  await service.applyAction("room-id", {
    action: "compare",
    targetId: "player-2",
    result: "tie",
  });
  assert.equal(calls[1].data.action, "applyAction");
  assert.equal(calls[1].data.payload.targetId, "player-2");
  assert.equal(calls[1].data.payload.result, "tie");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
