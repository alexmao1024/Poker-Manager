const assert = require("node:assert/strict");
const { normalizeBlinds } = require("../validation/roomValidation");

assert.deepEqual(normalizeBlinds({ sb: "10", bb: "20" }), { sb: 10, bb: 20 });
