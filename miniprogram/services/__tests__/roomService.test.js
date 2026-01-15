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
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
