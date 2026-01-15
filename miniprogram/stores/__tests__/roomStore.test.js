const assert = require("node:assert/strict");
const { createRoomStore } = require("../roomStore");

const store = createRoomStore();
let observed = null;
const unsubscribe = store.subscribe((state) => {
  observed = state;
});

store.setState({ roomId: "r1" });
assert.equal(store.getState().roomId, "r1");
assert.equal(observed.roomId, "r1");

unsubscribe();
store.setState({ roomId: "r2" });
assert.equal(observed.roomId, "r1");
