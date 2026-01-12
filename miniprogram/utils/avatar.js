const { getOpenId } = require("./cloud");
const { saveProfile } = require("./storage");

function isCloudFile(url) {
  return typeof url === "string" && url.startsWith("cloud://");
}

function isRemoteUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function normalizeCloudFileId(url) {
  if (!url || typeof url !== "string") return "";
  if (isCloudFile(url)) return url;
  if (!isRemoteUrl(url)) return "";
  const match = url.match(/^https?:\/\/([^/]+)\/(.+)$/i);
  if (!match) return "";
  const host = match[1] || "";
  if (!host.endsWith(".tcb.qcloud.la")) return "";
  const envMatch = host.match(/(cloud\d+-[a-z0-9]+)/i);
  if (!envMatch) return "";
  const envId = envMatch[1];
  const rawPath = match[2] || "";
  const path = rawPath.split("?")[0];
  if (!path) return "";
  return `cloud://${envId}/${path}`;
}

function getFileExt(path) {
  if (!path) return "png";
  const match = path.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (match && match[1]) return match[1].toLowerCase();
  return "png";
}

async function ensureCloudAvatar(profile) {
  const avatar = profile?.avatar || "";
  if (!avatar) return profile;
  if (isCloudFile(avatar)) return profile;
  const normalized = normalizeCloudFileId(avatar);
  if (normalized) {
    const nextProfile = { ...profile, avatar: normalized };
    saveProfile(nextProfile);
    return nextProfile;
  }
  if (isRemoteUrl(avatar)) return profile;

  const openId = await getOpenId().catch(() => "");
  const ext = getFileExt(avatar);
  const cloudPath = `avatars/${openId || "user"}_${Date.now()}.${ext}`;
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: avatar });
  const fileID = res?.fileID || "";
  if (!fileID) return profile;
  const nextProfile = { ...profile, avatar: fileID };
  saveProfile(nextProfile);
  return nextProfile;
}

module.exports = {
  ensureCloudAvatar,
  isCloudFile,
  normalizeCloudFileId,
  async fetchCloudAvatarUrls(fileIds) {
    const list = Array.from(new Set((fileIds || []).filter(isCloudFile)));
    if (!list.length) return new Map();
    const res = await wx.cloud.getTempFileURL({ fileList: list });
    const map = new Map();
    (res?.fileList || []).forEach((item) => {
      if (item?.fileID && item?.tempFileURL) {
        map.set(item.fileID, item.tempFileURL);
      }
    });
    return map;
  },
};
