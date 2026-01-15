function setAutoStageHandler(deps) {
  const setAutoStage = deps?.setAutoStage;
  return async (event, openId) => {
    const payload = event?.payload;
    return setAutoStage(payload?.id, payload?.enabled, openId);
  };
}

module.exports = setAutoStageHandler;
