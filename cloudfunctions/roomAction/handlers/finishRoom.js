function finishRoomHandler(deps) {
  const finishRoom = deps?.finishRoom;
  return async (event, openId) => {
    const payload = event?.payload;
    return finishRoom(payload?.id, openId);
  };
}

module.exports = finishRoomHandler;
