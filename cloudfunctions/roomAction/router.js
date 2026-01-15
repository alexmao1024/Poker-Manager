const createRoomHandler = require("./handlers/createRoom");
const joinRoomHandler = require("./handlers/joinRoom");
const applyActionHandler = require("./handlers/applyAction");

function createMapAction(deps) {
  const handlers = {
    create: createRoomHandler({ createRoom: deps?.createRoom }),
    joinRoom: joinRoomHandler({ joinRoom: deps?.joinRoom }),
    applyAction: applyActionHandler({ applyRoomAction: deps?.applyRoomAction }),
  };

  return (action) => handlers[action] || null;
}

const mapAction = createMapAction({
  createRoom: () => {
    throw new Error("NOT_CONFIGURED");
  },
  joinRoom: () => {
    throw new Error("NOT_CONFIGURED");
  },
  applyRoomAction: () => {
    throw new Error("NOT_CONFIGURED");
  },
});

module.exports = { createMapAction, mapAction };
