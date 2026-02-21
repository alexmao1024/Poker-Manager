const assert = require("node:assert/strict");
const { mapAction } = require("../router");

const actions = [
  "create",
  "applyAction",
  "joinRoom",
  "leaveRoom",
  "reorderPlayers",
  "setAutoStage",
  "setActionTimeout",
  "startRoom",
  "updateProfile",
  "endRound",
  "resetRound",
  "finishRoom",
  "rebuy",
];

actions.forEach((action) => {
  assert.equal(typeof mapAction(action), "function");
});

assert.equal(mapAction("unknown"), null);
