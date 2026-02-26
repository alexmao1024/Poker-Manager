const assert = require("node:assert/strict");
const {
  shouldPromptExistingRoom,
  buildExistingRoomModalConfig,
} = require("../roomEntryGuard");

assert.equal(shouldPromptExistingRoom(null), false);
assert.equal(shouldPromptExistingRoom({ id: "r1", status: "ended" }), false);
assert.equal(shouldPromptExistingRoom({ id: "r1", status: "lobby" }), true);
assert.equal(shouldPromptExistingRoom({ _id: "r2", status: "active" }), true);

const mismatchConfig = buildExistingRoomModalConfig(
  { id: "r1", code: "123456", gameType: "zhajinhua", status: "lobby" },
  "texas"
);
assert.equal(mismatchConfig.title, "已有房间");
assert.equal(mismatchConfig.confirmText, "进入已有房间");
assert.equal(mismatchConfig.cancelText, "返回修改");
assert.match(mismatchConfig.content, /未开始/);
assert.match(mismatchConfig.content, /炸金花/);
assert.match(mismatchConfig.content, /当前选择：德州/);

const sameTypeConfig = buildExistingRoomModalConfig(
  { _id: "r2", gameType: "texas", status: "active" },
  "texas"
);
assert.match(sameTypeConfig.content, /进行中/);
assert.doesNotMatch(sameTypeConfig.content, /当前选择：/);
