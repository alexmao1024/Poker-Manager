function endRoundHandler(deps) {
  const endRoomRound = deps?.endRoomRound;
  return async (event, openId) => {
    const payload = event?.payload;
    return endRoomRound(payload?.id, payload?.expected, openId, payload?.winnersByPot);
  };
}

module.exports = endRoundHandler;
