function setZhjCompareRulesHandler(deps) {
  const setZhjCompareRules = deps?.setZhjCompareRules;
  return async (event, openId) => {
    const payload = event?.payload;
    return setZhjCompareRules(payload?.id, payload, openId);
  };
}

module.exports = setZhjCompareRulesHandler;
