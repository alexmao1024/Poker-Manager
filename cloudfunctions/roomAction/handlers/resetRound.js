function resetRoundHandler(deps) {
  const resetRoomRound = deps?.resetRoomRound;
  return async (event, openId) => {
    const payload = event?.payload;
    return resetRoomRound(payload?.id, payload?.expected, payload?.profileName, openId);
  };
}

module.exports = resetRoundHandler;
