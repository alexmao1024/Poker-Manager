function updateProfileHandler(deps) {
  const updateProfile = deps?.updateProfile;
  return async (event, openId) => {
    const payload = event?.payload;
    return updateProfile(payload?.id, payload?.profile, openId);
  };
}

module.exports = updateProfileHandler;
