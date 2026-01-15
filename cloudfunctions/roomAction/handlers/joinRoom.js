function joinRoomHandler(deps) {
  const joinRoom = deps?.joinRoom;
  return async (event, openId) => {
    const payload = event?.payload;
    return joinRoom(payload?.id, payload?.profile, openId);
  };
}

module.exports = joinRoomHandler;
