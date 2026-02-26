const assert = require("node:assert/strict");
const { validateRebuy } = require("../domain/rebuy");

assert.equal(
  validateRebuy({ settled: true, gameType: "zhajinhua", gameRules: { rebuyLimit: 2000 } }, 500),
  500
);

assert.equal(
  validateRebuy({ settled: true, gameType: "texas", stack: 2000 }, 500),
  500
);

assert.throws(
  () => validateRebuy({ settled: false, gameType: "texas", stack: 2000 }, 100),
  /NOT_SETTLED/
);

assert.throws(
  () => validateRebuy({ settled: true, gameType: "texas", stack: 2000 }, 3000),
  /REBUY_TOO_LARGE/
);
