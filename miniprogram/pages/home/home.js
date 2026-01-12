const { defaultConfig, getProfile, saveProfile } = require("../../utils/storage");
const { ensureCloudAvatar } = require("../../utils/avatar");
const { createRoom, joinRoomByCode, getMyRoom, updateProfile } = require("../../utils/roomService");
const { getOpenId } = require("../../utils/cloud");

const defaultName = "玩家1";
const REQUEST_TIMEOUT = 8000;

function withTimeout(promise, timeoutMs) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function buildProfile(userInfo) {
  return {
    name: userInfo?.nickName || defaultName,
    avatar: userInfo?.avatarUrl || "",
  };
}

Page({
  data: {
    showCreate: false,
    showJoin: false,
    joinCode: "",
    showNicknameModal: false,
    nicknameDraft: "",
    existingRoom: null,
    versionText: "",
    profile: {
      name: defaultName,
      avatar: "",
    },
    profileInitial: "我",
    form: {
      seatCount: 6,
      stack: defaultConfig.stack,
      sb: defaultConfig.blinds.sb,
      bb: defaultConfig.blinds.bb,
    },
  },

  onLoad() {
    const profile = getProfile() || { name: defaultName, avatar: "" };
    this.setProfile(profile);
    this.resetForm(profile);
    this.loadVersionInfo();
    this.syncCloudAvatar(profile);
  },

  onShow() {
    this.refreshExistingRoom();
  },

  loadVersionInfo() {
    try {
      let env = "";
      let version = "";
      if (wx.getAccountInfoSync) {
        const info = wx.getAccountInfoSync();
        env = info?.miniProgram?.envVersion || "";
        version = info?.miniProgram?.version || "";
      }
      if (!env && typeof __wxConfig !== "undefined") {
        env = __wxConfig?.envVersion || env;
        version = __wxConfig?.version || version;
      }
      const envMap = {
        develop: "开发版",
        trial: "体验版",
        release: "正式版",
      };
      const envLabel = envMap[env] || env || "";
      let text = envLabel;
      if (version) {
        text = envLabel ? `${envLabel} v${version}` : `v${version}`;
      }
      this.setData({ versionText: text || envLabel });
    } catch (err) {
      this.setData({ versionText: "" });
    }
  },

  async syncCloudAvatar(profile) {
    if (!profile?.avatar) return;
    try {
      const nextProfile = await ensureCloudAvatar(profile);
      if (nextProfile && nextProfile.avatar !== profile.avatar) {
        this.setProfile(nextProfile);
        this.syncProfileToRoom(nextProfile);
      }
    } catch (err) {
      // Silent: avoid blocking home page if upload fails.
    }
  },

  async syncProfileToRoom(profile) {
    const openId = await getOpenId().catch(() => "");
    if (!openId) return;
    const room = this.data.existingRoom || (await getMyRoom(openId).catch(() => null));
    if (!room) return;
    const id = room.id || room._id;
    if (!id) return;
    await updateProfile(id, profile).catch(() => {});
  },

  async refreshExistingRoom() {
    try {
      const openId = await getOpenId().catch(() => "");
      if (!openId) {
        this.setData({ existingRoom: null });
        return;
      }
      const room = await getMyRoom(openId);
      if (!room) {
        this.setData({ existingRoom: null });
        return;
      }
      this.setData({ existingRoom: { ...room, id: room._id } });
    } catch (err) {
      this.setData({ existingRoom: null });
    }
  },

  resetForm(profile) {
    this.setData({
      form: {
        ...this.data.form,
        seatCount: this.data.form.seatCount || 6,
      },
    });
  },

  setProfile(profile) {
    const initial = profile?.name ? profile.name.trim().slice(0, 1) : "我";
    this.setData({
      profile: profile || { name: defaultName, avatar: "" },
      profileInitial: initial,
    });
  },

  toggleCreate() {
    this.setData({
      showCreate: !this.data.showCreate,
      showJoin: false,
    });
  },

  toggleJoin() {
    this.setData({
      showJoin: !this.data.showJoin,
      showCreate: false,
    });
  },

  onInputSeatCount(e) {
    this.setData({ "form.seatCount": Number(e.detail.value || 0) });
  },
  onInputStack(e) {
    this.setData({ "form.stack": Number(e.detail.value || 0) });
  },
  onInputSb(e) {
    this.setData({ "form.sb": Number(e.detail.value || 0) });
  },
  onInputBb(e) {
    this.setData({ "form.bb": Number(e.detail.value || 0) });
  },
  onInputJoin(e) {
    this.setData({ joinCode: e.detail.value });
  },

  async createTable() {
    if (this.creatingRoom) return;
    if (this.data.existingRoom?.id && this.data.existingRoom?.status === "active") {
      wx.showToast({ title: "已在房间，已进入", icon: "none" });
      this.openMyRoom();
      return;
    }
    const form = this.data.form;
    const stack = Number(form.stack) || defaultConfig.stack;
    const seatCount = Math.min(9, Math.max(2, Number(form.seatCount) || 0));
    if (seatCount < 2) {
      wx.showToast({ title: "座位数至少 2", icon: "none" });
      return;
    }

    let profile = this.data.profile || { name: defaultName, avatar: "" };
    profile = await ensureCloudAvatar(profile).catch(() => profile);
    this.setProfile(profile);
    this.creatingRoom = true;
    wx.showLoading({ title: "创建中" });
    try {
      const table = await withTimeout(
        createRoom(
          {
            maxSeats: seatCount,
            stack,
            blinds: {
              sb: Number(form.sb) || defaultConfig.blinds.sb,
              bb: Number(form.bb) || defaultConfig.blinds.bb,
            },
          },
          profile
        ),
        REQUEST_TIMEOUT
      );
      if (!table) throw new Error("NO_TABLE");

      this.setData({ showCreate: false });
      const target = table.status === "lobby" ? "lobby" : "table";
      wx.navigateTo({ url: `/pages/${target}/${target}?id=${table._id}` });
      if (table.existing) {
        wx.showToast({ title: "已在房间，已进入", icon: "none" });
      }
      this.setData({ existingRoom: { ...table, id: table._id } });
    } catch (err) {
      const msg = err?.message || err?.errMsg || "";
      if (msg.includes("TIMEOUT")) {
        wx.showToast({ title: "网络慢，请重试", icon: "none" });
      } else {
        wx.showToast({ title: "创建失败", icon: "none" });
      }
      return;
    } finally {
      this.creatingRoom = false;
      wx.hideLoading();
    }
  },

  async joinTable() {
    if (this.joiningRoom) return;
    const code = (this.data.joinCode || "").trim();
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: "请输入 6 位房间号", icon: "none" });
      return;
    }
    this.joiningRoom = true;
    wx.showLoading({ title: "加入中" });
    try {
      const table = await withTimeout(joinRoomByCode(code), REQUEST_TIMEOUT);
      if (!table) throw new Error("NO_TABLE");
      this.setData({ showJoin: false });
      const target = table.status === "lobby" ? "lobby" : "table";
      wx.navigateTo({ url: `/pages/${target}/${target}?id=${table._id}` });
    } catch (err) {
      const msg = err?.message || err?.errMsg || "";
      if (msg.includes("TIMEOUT")) {
        wx.showToast({ title: "网络慢，请重试", icon: "none" });
      } else {
        wx.showToast({ title: "未找到房间", icon: "none" });
      }
      return;
    } finally {
      this.joiningRoom = false;
      wx.hideLoading();
    }
  },

  openTable(e) {
    const { id, status } = e.currentTarget.dataset;
    if (!id) return;
    const target = status === "lobby" ? "lobby" : "table";
    wx.navigateTo({ url: `/pages/${target}/${target}?id=${id}` });
  },

  openMyRoom() {
    const room = this.data.existingRoom;
    if (!room || !room.id) return;
    const target = room.status === "lobby" ? "lobby" : "table";
    wx.navigateTo({ url: `/pages/${target}/${target}?id=${room.id}` });
  },

  async onChooseAvatar(e) {
    const avatarUrl = e?.detail?.avatarUrl || "";
    if (!avatarUrl) return;
    const profile = { ...(this.data.profile || {}), avatar: avatarUrl };
    saveProfile(profile);
    this.setProfile(profile);
    wx.showLoading({ title: "上传头像" });
    try {
      const nextProfile = await ensureCloudAvatar(profile);
      this.setProfile(nextProfile);
      this.syncProfileToRoom(nextProfile);
    } catch (err) {
      wx.showToast({ title: "头像上传失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
    this.openNicknameModal();
  },

  openNicknameModal() {
    const name = this.data.profile?.name || "";
    this.setData({ showNicknameModal: true, nicknameDraft: name });
  },

  closeNicknameModal() {
    this.setData({ showNicknameModal: false });
  },

  onNicknameInput(e) {
    this.setData({ nicknameDraft: e.detail.value });
  },

  confirmNickname() {
    const name = (this.data.nicknameDraft || "").trim();
    if (!name) {
      wx.showToast({ title: "昵称不能为空", icon: "none" });
      return;
    }
    const profile = { ...(this.data.profile || {}), name };
    saveProfile(profile);
    this.setProfile(profile);
    this.resetForm(profile);
    this.syncProfileToRoom(profile);
    this.closeNicknameModal();
  },

  onEditName() {
    wx.showModal({
      title: "修改昵称",
      editable: true,
      placeholderText: "输入你的昵称",
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || "").trim();
        if (!name) {
          wx.showToast({ title: "昵称不能为空", icon: "none" });
          return;
        }
        const profile = { ...(this.data.profile || {}), name };
        saveProfile(profile);
        this.setProfile(profile);
        this.resetForm(profile);
        this.syncProfileToRoom(profile);
      },
    });
  },
});
