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
  setActionTimeout,
} = require("../../utils/roomService");
const { getOpenId } = require("../../utils/cloud");
const {
  ensureCloudAvatar,
  isCloudFile,
  fetchCloudAvatarUrls,
  normalizeCloudFileId,
} = require("../../utils/avatar");
const { createRoomStore } = require("../../stores/roomStore");

const roomStore = createRoomStore();

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

function updateRoomStore(room) {
  roomStore.setState({ room: room || null });
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
    showHostGuide: false,
    timeoutDraft: 60,
  },

  async onLoad(query) {
    this.avatarErrorIds = new Set();
    this.avatarErrorSources = new Map();
    this.avatarUrlMap = new Map();
    this.avatarLoading = new Set();
    this.avatarLocalMap = new Map();
    this.avatarDownloadLoading = new Set();
    let profile = getProfile() || {};
    profile = await ensureCloudAvatar(profile).catch(() => profile);
    this.profile = profile;
    this.setData({ profileName: profile?.name || "" });
    this.roomId = query.id;
    roomStore.setState({ roomId: this.roomId });
    this.unsubscribeRoomStore = roomStore.subscribe((state) => {
      if (!state.room) return;
      this.syncView(state.room);
    });
    const storeState = roomStore.getState();
    if (storeState?.room) {
      this.syncView(storeState.room);
    }

    const openId = await getOpenId().catch(() => "");
    if (openId) this.setData({ openId });

    const room = await getRoomById(this.roomId).catch(() => null);
    if (!room) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      wx.reLaunch({ url: "/pages/home/home" });
      return;
    }
    if (room.status === "active") {
      wx.redirectTo({ url: `/pages/table/table?id=${this.roomId}` });
      return;
    }
    updateRoomStore(room);

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
    if (!this.roomId) return;
    if (this.roomWatcher) {
      this.roomWatcher.close();
      this.roomWatcher = null;
    }
    this.refreshRoom();
    this.startWatch();
    if (this.wasHidden) {
      wx.showToast({ title: "已恢复同步", icon: "none" });
      this.wasHidden = false;
    }
  },

  onUnload() {
    if (this.roomWatcher) {
      this.roomWatcher.close();
      this.roomWatcher = null;
    }
    if (this.unsubscribeRoomStore) {
      this.unsubscribeRoomStore();
      this.unsubscribeRoomStore = null;
    }
  },

  onHide() {
    if (this.roomWatcher) {
      this.roomWatcher.close();
      this.roomWatcher = null;
    }
    this.wasHidden = true;
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
        updateRoomStore(room);
      },
      onError: () => {
        wx.showToast({ title: "同步断开，正在重连", icon: "none" });
        this.scheduleWatchRetry();
      },
    });
  },

  scheduleWatchRetry() {
    if (this.watchRetryTimer || !this.roomId) return;
    this.watchRetryTimer = setTimeout(() => {
      this.watchRetryTimer = null;
      if (this.roomWatcher) {
        this.roomWatcher.close();
        this.roomWatcher = null;
      }
      this.startWatch();
    }, 1500);
  },

  async refreshRoom() {
    if (!this.roomId) return;
    const room = await getRoomById(this.roomId).catch(() => null);
    if (!room) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      wx.reLaunch({ url: "/pages/home/home" });
      return;
    }
    if (room.status === "active") {
      wx.redirectTo({ url: `/pages/table/table?id=${this.roomId}` });
      return;
    }
    updateRoomStore(room);
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
    const timeoutSec = Number.isFinite(Number(room.actionTimeoutSec))
      ? Math.max(0, Number(room.actionTimeoutSec))
      : 60;
    const avatarErrorIds = this.avatarErrorIds || new Set();
    const avatarErrorSources = this.avatarErrorSources || new Map();
    const pendingAvatarIds = [];
    const avatarUrlMap = this.avatarUrlMap || new Map();
    const avatarLocalMap = this.avatarLocalMap || new Map();
    const playersView = buildPlayersView(
      room.players || [],
      this.data.openId,
      room.hostOpenId,
      room.hostName
    ).map((player) => {
      const rawAvatar = player.avatar || "";
      const normalized = normalizeCloudFileId(rawAvatar);
      const sourceAvatar = normalized || rawAvatar;
      const hasError =
        avatarErrorIds.has(player.id) &&
        avatarErrorSources.get(player.id) === sourceAvatar;
      let resolvedAvatar = hasError ? "" : rawAvatar;
      if (isCloudFile(sourceAvatar)) {
        const localCached = avatarLocalMap.get(sourceAvatar);
        if (localCached) {
          resolvedAvatar = localCached;
        }
        const cached = avatarUrlMap.get(sourceAvatar);
        if (cached) {
          resolvedAvatar = cached;
        }
        if (!cached && !localCached) {
          resolvedAvatar = "";
        }
        if (!cached) pendingAvatarIds.push(sourceAvatar);
      }
      return {
        ...player,
        nameInitial: (player.name || "座").trim().slice(0, 1),
        avatarSource: sourceAvatar,
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
      timeoutDraft: this.timeoutEditing ? this.data.timeoutDraft : timeoutSec,
    });
    this.loadAvatarUrls(pendingAvatarIds);
    this.maybeShowHostGuide(isHost);
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
    const source = e.currentTarget.dataset.source || "";
    if (!id) return;
    if (!this.avatarErrorIds) this.avatarErrorIds = new Set();
    if (!this.avatarErrorSources) this.avatarErrorSources = new Map();
    const prevSource = this.avatarErrorSources.get(id);
    if (this.avatarErrorIds.has(id) && prevSource === source) return;
    this.avatarErrorIds.add(id);
    this.avatarErrorSources.set(id, source);
    if (source && isCloudFile(source)) {
      this.downloadAvatarFiles([source]);
    }
    const playersView = (this.data.playersView || []).map((player) =>
      player.id === id ? { ...player, avatar: "" } : player
    );
    const reorderList = (this.data.reorderList || []).map((player) =>
      player.id === id ? { ...player, avatar: "" } : player
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
      const missing = unique.filter((id) => !this.avatarUrlMap.has(id));
      if (missing.length) {
        this.downloadAvatarFiles(missing);
      }
      const applyMap = (list) =>
        (list || []).map((player) => {
          if (!player.avatarSource || !isCloudFile(player.avatarSource)) return player;
          const localCached = this.avatarLocalMap?.get(player.avatarSource);
          if (localCached) {
            return { ...player, avatar: localCached };
          }
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

  async downloadAvatarFiles(fileIds) {
    const loading = this.avatarDownloadLoading || new Set();
    const localMap = this.avatarLocalMap || new Map();
    const unique = Array.from(new Set(fileIds || [])).filter(
      (id) => id && isCloudFile(id) && !localMap.has(id) && !loading.has(id)
    );
    if (!unique.length) return;
    unique.forEach((id) => loading.add(id));
    this.avatarDownloadLoading = loading;
    if (!this.avatarLocalMap) this.avatarLocalMap = new Map();
    await Promise.all(
      unique.map(async (id) => {
        try {
          const res = await wx.cloud.downloadFile({ fileID: id });
          const tempPath = res?.tempFilePath;
          if (tempPath) {
            this.avatarLocalMap.set(id, tempPath);
          }
        } catch (err) {
          // Ignore download failures.
        }
      })
    );
    const applyMap = (list) =>
      (list || []).map((player) => {
        if (!player.avatarSource || !isCloudFile(player.avatarSource)) return player;
        const localCached = this.avatarLocalMap.get(player.avatarSource);
        if (!localCached) return player;
        return { ...player, avatar: localCached };
      });
    this.setData({
      playersView: applyMap(this.data.playersView),
      reorderList: applyMap(this.data.reorderList),
    });
    unique.forEach((id) => loading.delete(id));
  },

  onReorderBlock() {},

  onTimeoutFocus() {
    this.timeoutEditing = true;
  },

  async onTimeoutBlur(e) {
    this.timeoutEditing = false;
    if (!this.data.isHost || !this.roomId) return;
    const value = Number(e.detail.value || 0);
    const nextValue = Number.isFinite(value) ? Math.max(0, Math.min(600, value)) : 60;
    if (nextValue === Number(this.data.room?.actionTimeoutSec)) {
      this.setData({ timeoutDraft: nextValue });
      return;
    }
    try {
      await setActionTimeout(this.roomId, nextValue);
      this.setData({ timeoutDraft: nextValue });
    } catch (err) {
      const code = this.getErrorCode(err);
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可修改", icon: "none" });
        return;
      }
      if (code === "ROOM_STARTED") {
        wx.showToast({ title: "已开局，无法修改", icon: "none" });
        return;
      }
      wx.showToast({ title: "更新失败", icon: "none" });
    }
  },

  noop() {},

  maybeShowHostGuide(isHost) {
    if (!isHost || !this.roomId) return;
    if (this.hostGuideShown) return;
    const key = `chip_score_host_guide_${this.roomId}`;
    const shown = wx.getStorageSync(key);
    if (shown) {
      this.hostGuideShown = true;
      return;
    }
    this.hostGuideShown = true;
    wx.setStorageSync(key, "1");
    this.setData({ showHostGuide: true });
  },

  openHostGuide() {
    this.setData({ showHostGuide: true });
  },

  closeHostGuide() {
    this.setData({ showHostGuide: false });
  },

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
