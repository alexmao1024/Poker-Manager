function setNextAnteSponsorHandler(deps) {
  const setNextAnteSponsor = deps?.setNextAnteSponsor;
  return async (event, openId) => {
    const payload = event?.payload;
    return setNextAnteSponsor(payload?.id, payload?.sponsorId, openId);
  };
}

module.exports = setNextAnteSponsorHandler;
