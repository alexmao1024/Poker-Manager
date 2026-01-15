function startRoomHandler(deps) {
  const startRoom = deps?.startRoom;
  return async (event, openId) => {
    const payload = event?.payload;
    return startRoom(payload?.id, openId);
  };
}

module.exports = startRoomHandler;
