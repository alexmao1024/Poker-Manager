const assert = require("node:assert/strict");
const { mapAction } = require("../router");

assert.equal(typeof mapAction("create"), "function");
assert.equal(mapAction("unknown"), null);
