const assert = require("node:assert/strict");

let lastWatchHandlers = null;
let closeCount = 0;

global.wx = {
  cloud: {
    database() {
      return {
        collection() {
          return {
            doc() {
              return {
                watch(handlers) {
                  lastWatchHandlers = handlers;
                  return {
                    close() {
                      closeCount += 1;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  },
};

const { watchRoom } = require("../roomService");

let errorCalls = 0;
const watcher = watchRoom("room-1", {
  onError: () => {
    errorCalls += 1;
  },
});

assert.ok(lastWatchHandlers);

lastWatchHandlers.onError(new Error("network broken"));
assert.equal(errorCalls, 1);

watcher.close();
assert.equal(closeCount, 1);

lastWatchHandlers.onError(
  new Error('current state (CLOSED) does not accept "initWatchFail"')
);
assert.equal(errorCalls, 1);

let cancelErrorCalls = 0;
watchRoom("room-2", {
  onError: () => {
    cancelErrorCalls += 1;
  },
});

lastWatchHandlers.onError(new Error("onCancelledError"));
assert.equal(cancelErrorCalls, 0);
