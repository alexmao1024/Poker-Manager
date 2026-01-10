const { getProfile } = require("../../utils/storage");
const {
  getRoomById,
  watchRoom,
  joinRoom,
  leaveRoom,
  reorderPlayers,
  startRoom,
  finishRoom,
  setAutoStage,
} = require("../../utils/roomService");
const { getOpenId } = require("../../utils/cloud");
const { ensureCloudAvatar, isCloudFile, fetchCloudAvatarUrls } = require("../../utils/avatar");

function buildPlayersView(players, openId, hostOpenId, hostName) {
  const list = players || [];
  return list.map((player, index) => {
    const isMine = player.openId && player.openId === openId;
    const isHost =
      (hostOpenId && player.openId === hostOpenId) ||
      (!hostOpenId && player.name && player.name === hostName);
    let positionTag = "";
    if (index === 0) {
      positionTag = "庄";
    } else if (index === 1) {
      positionTag = "小盲";
    } else if (index === 2) {
      positionTag = "大盲";
    }
    return {
      ...player,
      isMine,
      isHost,
      nameInitial: (player.name || "座").trim().slice(0, 1),
      positionTag,
    };
  });
}

Page({
  data: {
    room: {
      code: "",
      maxSeats: 0,
      hostName: "",
    },
    playersView: [],
    isHost: false,
    canStart: false,
    openId: "",
    profileName: "",
    reorderList: [],
    reorderAreaHeight: 0,
    reorderItemHeight: 88,
    reorderPadding: 12,
  },

  async onLoad(query) {
    this.avatarErrorIds = new Set();
    this.avatarUrlMap = new Map();
    this.avatarLoading = new Set();
    let profile = getProfile() || {};
    profile = await ensureCloudAvatar(profile).catch(() => profile);
    this.profile = profile;
    this.setData({ profileName: profile?.name || "" });
    this.roomId = query.id;

    const openId = await getOpenId().catch(() => "");
    if (openId) this.setData({ openId });

    const room = await getRoomById(this.roomId).catch(() => null);
    if (!room) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      return;
    }
    if (room.status === "active") {
      wx.redirectTo({ url: `/pages/table/table?id=${this.roomId}` });
      return;
    }
    this.syncView(room);

    joinRoom(this.roomId, profile).catch((err) => {
      const code = this.getErrorCode(err);
      if (code === "ROOM_FULL") {
        wx.showToast({ title: "房间已满", icon: "none" });
        return;
      }
      if (code === "ROOM_STARTED") {
        wx.redirectTo({ url: `/pages/table/table?id=${this.roomId}` });
        return;
      }
      wx.showToast({ title: "加入失败", icon: "none" });
    });

    this.startWatch();
  },

  onShow() {
    if (!this.roomId || this.roomWatcher) return;
    this.startWatch();
  },

  onUnload() {
    if (this.roomWatcher) {
      this.roomWatcher.close();
      this.roomWatcher = null;
    }
  },

  startWatch() {
    if (!this.roomId) return;
    if (this.roomWatcher) return;
    this.roomWatcher = watchRoom(this.roomId, {
      onChange: (room) => {
        if (!room) {
          wx.showToast({ title: "房间已结束", icon: "none" });
          wx.reLaunch({ url: "/pages/home/home" });
          return;
        }
        this.handleNotice(room.notice);
        this.syncView(room);
      },
      onError: () => {
        wx.showToast({ title: "同步断开", icon: "none" });
      },
    });
  },

  handleNotice(notice) {
    if (!notice || !notice.id) return;
    if (this.lastNoticeId === notice.id) return;
    this.lastNoticeId = notice.id;
    if (notice.message) {
      wx.showToast({ title: notice.message, icon: "none" });
    }
  },

  syncView(room) {
    if (room.status === "active") {
      wx.redirectTo({ url: `/pages/table/table?id=${this.roomId}` });
      return;
    }
    const autoStage = room.autoStage !== false;
    const avatarErrorIds = this.avatarErrorIds || new Set();
    const pendingAvatarIds = [];
    const avatarUrlMap = this.avatarUrlMap || new Map();
    const playersView = buildPlayersView(
      room.players || [],
      this.data.openId,
      room.hostOpenId,
      room.hostName
    ).map((player) => {
      const rawAvatar = avatarErrorIds.has(player.id) ? "" : player.avatar;
      let resolvedAvatar = rawAvatar;
      if (isCloudFile(rawAvatar)) {
        const cached = avatarUrlMap.get(rawAvatar);
        resolvedAvatar = cached || "";
        if (!cached) pendingAvatarIds.push(rawAvatar);
      }
      return {
        ...player,
        nameInitial: (player.name || "座").trim().slice(0, 1),
        avatarSource: rawAvatar,
        avatar: resolvedAvatar,
      };
    });
    const isHost = !!room.hostOpenId && room.hostOpenId === this.data.openId;
    const canStart = isHost && playersView.length >= 2;

    const itemHeight = this.data.reorderItemHeight || 88;
    const padding = this.data.reorderPadding || 0;
    const reorderList =
      this.isDragging && this.data.reorderList.length === playersView.length
        ? this.data.reorderList
        : playersView.map((player, index) => ({
            ...player,
            y: index * itemHeight + padding,
          }));

    this.setData({
      room: { ...room, autoStage },
      playersView,
      isHost,
      canStart,
      reorderList,
      reorderAreaHeight: reorderList.length * itemHeight + padding * 2,
    });
    this.loadAvatarUrls(pendingAvatarIds);
  },

  getErrorCode(err) {
    if (!err) return "";
    const msg = err.errMsg || err.message || "";
    const match = msg.match(/Error: ([A-Z_]+)/);
    return match ? match[1] : msg;
  },

  onReorderTouchStart(e) {
    if (!this.data.isHost) return;
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index)) return;
    const isHandle =
      e?.currentTarget?.dataset?.handle === 1 || e?.currentTarget?.dataset?.handle === "1";
    if (!isHandle) {
      this.reorderDragging = "";
      return;
    }
    const dragId = this.data.reorderList[index]?.id || "";
    if (!dragId) return;
    this.reorderDragging = dragId;
    this.isDragging = true;
    this.reorderDirty = false;
  },

  onReorderChange(e) {
    if (!this.reorderDragging) return;
    const itemHeight = this.data.reorderItemHeight || 88;
    const padding = this.data.reorderPadding || 0;
    const list = [...this.data.reorderList];
    const currentIndex = list.findIndex((item) => item.id === this.reorderDragging);
    if (currentIndex === -1) return;
    const nextIndex = Math.max(
      0,
      Math.min(
        list.length - 1,
        Math.round(((e.detail?.y || 0) - padding) / itemHeight)
      )
    );
    if (nextIndex !== currentIndex) {
      const [moved] = list.splice(currentIndex, 1);
      list.splice(nextIndex, 0, moved);
      this.reorderDirty = true;
    }
    const updated = list.map((item, index) => ({ ...item, y: index * itemHeight + padding }));
    this.setData({ reorderList: updated });
  },

  onReorderEnd() {
    this.reorderDragging = "";
    this.isDragging = false;
    const itemHeight = this.data.reorderItemHeight || 88;
    const padding = this.data.reorderPadding || 0;
    const snapped = (this.data.reorderList || []).map((item, index) => ({
      ...item,
      y: index * itemHeight + padding,
    }));
    this.setData({ reorderList: snapped });
    if (this.reorderDirty) {
      this.reorderDirty = false;
      this.saveReorder();
    }
  },

  onAvatarError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (!this.avatarErrorIds) this.avatarErrorIds = new Set();
    if (this.avatarErrorIds.has(id)) return;
    this.avatarErrorIds.add(id);
    const playersView = (this.data.playersView || []).map((player) =>
      player.id === id ? { ...player, avatar: "", avatarSource: "" } : player
    );
    const reorderList = (this.data.reorderList || []).map((player) =>
      player.id === id ? { ...player, avatar: "", avatarSource: "" } : player
    );
    this.setData({ playersView, reorderList });
  },

  async loadAvatarUrls(fileIds) {
    const loading = this.avatarLoading || new Set();
    const avatarUrlMap = this.avatarUrlMap || new Map();
    const unique = Array.from(new Set(fileIds || [])).filter(
      (id) => id && !avatarUrlMap.has(id) && !loading.has(id)
    );
    if (!unique.length) return;
    unique.forEach((id) => loading.add(id));
    this.avatarLoading = loading;
    try {
      const map = await fetchCloudAvatarUrls(unique);
      if (!this.avatarUrlMap) this.avatarUrlMap = new Map();
      map.forEach((url, id) => this.avatarUrlMap.set(id, url));
      const applyMap = (list) =>
        (list || []).map((player) => {
          if (!player.avatarSource || !isCloudFile(player.avatarSource)) return player;
          const nextUrl = this.avatarUrlMap.get(player.avatarSource);
          if (!nextUrl) return player;
          return { ...player, avatar: nextUrl };
        });
      this.setData({
        playersView: applyMap(this.data.playersView),
        reorderList: applyMap(this.data.reorderList),
      });
    } finally {
      unique.forEach((id) => loading.delete(id));
    }
  },

  onReorderBlock() {},

  async saveReorder() {
    if (!this.roomId) return;
    const order = (this.data.reorderList || []).map((item) => item.id);
    try {
      await reorderPlayers(this.roomId, order);
      wx.showToast({ title: "已更新顺序", icon: "success" });
    } catch (err) {
      const code = this.getErrorCode(err);
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可调整", icon: "none" });
        return;
      }
      if (code === "ROOM_STARTED") {
        wx.showToast({ title: "已开局", icon: "none" });
        return;
      }
      wx.showToast({ title: "调整失败", icon: "none" });
    }
  },

  async startRoom() {
    if (!this.roomId) return;
    if (!this.data.isHost) {
      wx.showToast({ title: "仅房主可开始", icon: "none" });
      return;
    }
    try {
      await startRoom(this.roomId);
      wx.showToast({ title: "已开始", icon: "success" });
      wx.redirectTo({ url: `/pages/table/table?id=${this.roomId}` });
    } catch (err) {
      const code = this.getErrorCode(err);
      if (code === "NEED_PLAYERS") {
        wx.showToast({ title: "至少 2 人才能开始", icon: "none" });
        return;
      }
      if (code === "ROOM_STARTED") {
        wx.showToast({ title: "已开始", icon: "none" });
        return;
      }
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可开始", icon: "none" });
        return;
      }
      wx.showToast({ title: "开始失败", icon: "none" });
    }
  },

  async onAutoStageChange(e) {
    if (!this.roomId) return;
    if (!this.data.isHost) return;
    const enabled = !!e.detail.value;
    const prev = this.data.room?.autoStage !== false;
    try {
      await setAutoStage(this.roomId, enabled);
    } catch (err) {
      const code = this.getErrorCode(err);
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可修改", icon: "none" });
      } else {
        wx.showToast({ title: "更新失败", icon: "none" });
      }
      this.setData({ room: { ...this.data.room, autoStage: prev } });
    }
  },

  async endRoom() {
    if (!this.roomId) return;
    if (!this.data.isHost) {
      wx.showToast({ title: "仅房主可结束", icon: "none" });
      return;
    }
    wx.showModal({
      title: "结束房间",
      content: "确定结束房间吗？房间会被删除。",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await finishRoom(this.roomId);
          wx.showToast({ title: "已结束房间", icon: "none" });
          wx.reLaunch({ url: "/pages/home/home" });
        } catch (err) {
          const code = this.getErrorCode(err);
          if (code === "NOT_HOST") {
            wx.showToast({ title: "仅房主可结束", icon: "none" });
            return;
          }
          wx.showToast({ title: "结束失败", icon: "none" });
        }
      },
    });
  },

  async leaveRoom() {
    if (!this.roomId) return;
    if (this.data.isHost) {
      wx.showToast({ title: "房主请结束房间", icon: "none" });
      return;
    }
    wx.showModal({
      title: "退出房间",
      content: "确定退出房间吗？",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await leaveRoom(this.roomId);
          wx.showToast({ title: "已退出房间", icon: "none" });
          wx.reLaunch({ url: "/pages/home/home" });
        } catch (err) {
          const code = this.getErrorCode(err);
          if (code === "ROOM_STARTED") {
            wx.showToast({ title: "已开局，无法退出", icon: "none" });
            return;
          }
          if (code === "HOST_CANNOT_LEAVE") {
            wx.showToast({ title: "房主请结束房间", icon: "none" });
            return;
          }
          wx.showToast({ title: "退出失败", icon: "none" });
        }
      },
    });
  },

  onShareAppMessage() {
    const code = this.data.room?.code || "";
    const title = code ? `筹码计分 · 房间号 ${code}` : "筹码计分";
    const path = this.roomId ? `/pages/lobby/lobby?id=${this.roomId}` : "/pages/home/home";
    return { title, path };
  },
});
