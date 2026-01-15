function createRoomHandler(deps) {
  const createRoom = deps?.createRoom;
  return async (event, openId) => {
    const payload = event?.payload;
    return createRoom(payload?.payload, payload?.profile, openId);
  };
}

module.exports = createRoomHandler;
