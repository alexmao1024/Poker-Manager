const assert = require("node:assert/strict");

const calls = [];
global.wx = {
  cloud: {
    callFunction: (args) => {
      calls.push(args);
      return { ok: true, args };
    },
  },
};

const { callFunction } = require("../cloud");

const result = callFunction({ name: "roomAction", data: { action: "create" } });
assert.equal(result.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "roomAction");
