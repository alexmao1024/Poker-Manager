function adjustChipsHandler(deps) {
  const adjustChips = deps?.adjustChips;
  return async (event, openId) => {
    const payload = event?.payload;
    return adjustChips(payload?.id, payload, openId);
  };
}

module.exports = adjustChipsHandler;
