const OPENID_KEY = "chip_score_openid_v1";

function getDb() {
  return wx.cloud.database();
}

async function getOpenId() {
  const cached = wx.getStorageSync(OPENID_KEY);
  if (cached) return cached;
  const res = await wx.cloud.callFunction({ name: "getOpenId" });
  const openId = res?.result?.openid || "";
  if (openId) {
    wx.setStorageSync(OPENID_KEY, openId);
  }
  return openId;
}

module.exports = {
  getDb,
  getOpenId,
};
