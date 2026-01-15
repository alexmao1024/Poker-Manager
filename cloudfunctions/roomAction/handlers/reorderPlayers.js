function reorderPlayersHandler(deps) {
  const reorderPlayers = deps?.reorderPlayers;
  return async (event, openId) => {
    const payload = event?.payload;
    return reorderPlayers(payload?.id, payload?.order, openId);
  };
}

module.exports = reorderPlayersHandler;
