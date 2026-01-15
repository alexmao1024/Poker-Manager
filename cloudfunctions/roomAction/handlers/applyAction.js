function applyActionHandler(deps) {
  const applyRoomAction = deps?.applyRoomAction;
  return async (event, openId) => {
    const payload = event?.payload;
    return applyRoomAction(
      payload?.id,
      payload?.type,
      Number(payload?.raiseTo || 0),
      payload?.expected,
      openId
    );
  };
}

module.exports = applyActionHandler;
