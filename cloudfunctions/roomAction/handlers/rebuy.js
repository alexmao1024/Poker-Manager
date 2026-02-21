function rebuyHandler(deps) {
  const rebuy = deps?.rebuy;
  return async (event, openId) => {
    const payload = event?.payload;
    return rebuy(payload?.id, payload?.amount, openId);
  };
}

module.exports = rebuyHandler;
