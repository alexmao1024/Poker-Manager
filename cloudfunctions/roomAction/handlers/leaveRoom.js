function leaveRoomHandler(deps) {
  const leaveRoom = deps?.leaveRoom;
  return async (event, openId) => {
    const payload = event?.payload;
    return leaveRoom(payload?.id, openId);
  };
}

module.exports = leaveRoomHandler;
