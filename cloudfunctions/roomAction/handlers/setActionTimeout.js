function setActionTimeoutHandler(deps) {
  const setActionTimeout = deps?.setActionTimeout;
  return async (event, openId) => {
    const payload = event?.payload;
    return setActionTimeout(payload?.id, payload?.actionTimeoutSec, openId);
  };
}

module.exports = setActionTimeoutHandler;
