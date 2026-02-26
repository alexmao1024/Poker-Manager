const { defaultConfig, getProfile, saveProfile } = require("../../utils/storage");
const { GAME_TYPES, defaultGameRules } = require("../../utils/gameConfig");
const { buildCreateRoomPayload } = require("../../utils/roomPayloads");
const { ensureCloudAvatar } = require("../../utils/avatar");
const { createRoom, joinRoomByCode, getMyRoom, updateProfile } = require("../../utils/roomService");
const {
  shouldPromptExistingRoom,
  buildExistingRoomModalConfig,
} = require("../../utils/roomEntryGuard");
const { getOpenId } = require("../../utils/cloud");
const { createRoomStore } = require("../../stores/roomStore");

const defaultName = "玩家1";
const REQUEST_TIMEOUT = 8000;
const roomStore = createRoomStore();

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

function normalizeExistingRoom(room) {
  if (!room) return null;
  const id = room.id || room._id;
  if (!id) return { ...room };
  return { ...room, id };
}

function updateRoomStore(room) {
  roomStore.setState({ room: normalizeExistingRoom(room) });
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
      gameType: GAME_TYPES.TEXAS,
      seatCount: 6,
      stack: defaultConfig.stack,
      sb: defaultConfig.blinds.sb,
      bb: defaultConfig.blinds.bb,
      zhjBaseBet: defaultGameRules.zhj.baseBet,
      zhjBuyIn: defaultGameRules.zhj.buyIn,
      zhjMaxRounds: defaultGameRules.zhj.maxRounds,
      zhjMinSeeRound: defaultGameRules.zhj.minSeeRound,
      zhjCompareAfter: defaultGameRules.zhj.compareAllowedAfter,
    },
  },

  onLoad() {
    this.unsubscribeRoomStore = roomStore.subscribe((state) => {
      this.setData({ existingRoom: state.room });
    });
    const storeState = roomStore.getState();
    if (storeState?.room) {
      this.setData({ existingRoom: storeState.room });
    }
    const profile = getProfile() || { name: defaultName, avatar: "" };
    this.setProfile(profile);
    this.resetForm(profile);
    this.loadVersionInfo();
    this.syncCloudAvatar(profile);
  },

  onUnload() {
    if (this.unsubscribeRoomStore) {
      this.unsubscribeRoomStore();
      this.unsubscribeRoomStore = null;
    }
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
        updateRoomStore(null);
        return;
      }
      const room = await getMyRoom(openId);
      if (!room) {
        updateRoomStore(null);
        return;
      }
      updateRoomStore(room);
    } catch (err) {
      updateRoomStore(null);
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
    const existingRoom = normalizeExistingRoom(this.data.existingRoom);
    if (existingRoom) return;
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
  onSelectGameType(e) {
    const gameType = e?.currentTarget?.dataset?.type;
    if (!gameType) return;
    this.setData({ "form.gameType": gameType });
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
  onInputZhjBaseBet(e) {
    this.setData({ "form.zhjBaseBet": Number(e.detail.value || 0) });
  },
  onInputZhjBuyIn(e) {
    this.setData({ "form.zhjBuyIn": Number(e.detail.value || 0) });
  },
  onInputZhjMaxRounds(e) {
    this.setData({ "form.zhjMaxRounds": Number(e.detail.value || 0) });
  },
  onInputZhjMinSeeRound(e) {
    this.setData({ "form.zhjMinSeeRound": Number(e.detail.value || 0) });
  },
  onInputZhjCompareAfter(e) {
    this.setData({ "form.zhjCompareAfter": Number(e.detail.value || 0) });
  },
  onInputJoin(e) {
    this.setData({ joinCode: e.detail.value });
  },

  async createTable() {
    if (this.creatingRoom) return;
    const form = this.data.form;
    const existingRoom = normalizeExistingRoom(this.data.existingRoom);
    if (shouldPromptExistingRoom(existingRoom)) {
      const confirmEnter = await this.promptEnterExistingRoom(existingRoom, form.gameType);
      if (confirmEnter) this.navigateToRoom(existingRoom);
      return;
    }
    const seatCount = Number(form.seatCount) || 0;
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
      const payload = buildCreateRoomPayload(form);
      const table = await withTimeout(
        createRoom(
          payload,
          profile
        ),
        REQUEST_TIMEOUT
      );
      if (!table) throw new Error("NO_TABLE");

      const normalizedTable = normalizeExistingRoom(table);
      if (table.existing) {
        wx.hideLoading();
        updateRoomStore(normalizedTable);
        const confirmEnter = await this.promptEnterExistingRoom(normalizedTable, form.gameType);
        if (confirmEnter) this.navigateToRoom(normalizedTable);
        return;
      }
      this.setData({ showCreate: false });
      this.navigateToRoom(normalizedTable);
      updateRoomStore(normalizedTable);
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

  promptEnterExistingRoom(room, selectedGameType) {
    if (!shouldPromptExistingRoom(room)) return Promise.resolve(false);
    const modal = buildExistingRoomModalConfig(room, selectedGameType);
    return new Promise((resolve) => {
      wx.showModal({
        ...modal,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      });
    });
  },

  navigateToRoom(room) {
    const id = room?.id || room?._id;
    if (!id) return;
    const target = room.status === "lobby" ? "lobby" : "table";
    wx.navigateTo({ url: `/pages/${target}/${target}?id=${id}` });
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
      updateRoomStore(table);
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
    this.navigateToRoom({ id, status });
  },

  openMyRoom() {
    const room = this.data.existingRoom;
    if (!room || !(room.id || room._id)) return;
    this.navigateToRoom(room);
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
