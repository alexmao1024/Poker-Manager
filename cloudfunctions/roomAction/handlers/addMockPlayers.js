function addMockPlayersHandler(deps) {
  const addMockPlayers = deps?.addMockPlayers;
  return async (event, openId) => {
    const payload = event?.payload;
    return addMockPlayers(payload?.id, payload?.count, openId);
  };
}

module.exports = addMockPlayersHandler;
