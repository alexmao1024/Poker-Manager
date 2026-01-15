const { getRoomById, finishRoom } = require("../../utils/roomService");
const { getOpenId } = require("../../utils/cloud");
const { getProfile } = require("../../utils/storage");
const { formatRound } = require("../../utils/format");
const { createRoomStore } = require("../../stores/roomStore");

const roomStore = createRoomStore();

function buildSummary(players) {
  const list = players.map((player) => {
    const delta = (player.stack || 0) - (player.initialStack || 0);
    const deltaLabel = delta === 0 ? "±0" : delta > 0 ? `+${delta}` : `${delta}`;
    const deltaClass = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "delta-flat";
    return {
      ...player,
      delta,
      deltaLabel,
      deltaClass,
    };
  });
  list.sort((a, b) => {
    const stackDiff = (b.stack || 0) - (a.stack || 0);
    if (stackDiff !== 0) return stackDiff;
    const deltaDiff = (b.delta || 0) - (a.delta || 0);
    if (deltaDiff !== 0) return deltaDiff;
    return `${a.name || ""}`.localeCompare(`${b.name || ""}`, "zh");
  });
  return list.map((player, index) => ({
    ...player,
    rank: index + 1,
  }));
}

function updateRoomStore(table) {
  roomStore.setState({ room: table || null });
}

Page({
  data: {
    table: {
      name: "",
      code: "",
      players: [],
      pot: 0,
    },
    summaryList: [],
    roundLabel: "",
    isHost: false,
    openId: "",
  },

  async onLoad(query) {
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
    const profile = getProfile() || {};
    this.profileName = profile?.name || "";
    const openId = await getOpenId().catch(() => "");
    if (openId) this.setData({ openId });
    const table = await getRoomById(query.id).catch(() => null);
    if (!table) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      return;
    }
    updateRoomStore(table);
  },

  onUnload() {
    if (this.unsubscribeRoomStore) {
      this.unsubscribeRoomStore();
      this.unsubscribeRoomStore = null;
    }
  },

  syncView(table) {
    const hostByOpenId = table.hostOpenId && table.hostOpenId === this.data.openId;
    const hostByName = !table.hostOpenId && table.hostName === this.profileName;
    const isHost = !!hostByOpenId || !!hostByName;
    this.setData({
      table,
      summaryList: buildSummary(table.players || []),
      roundLabel: formatRound(table.round),
      isHost,
    });
  },

  backToTable() {
    wx.navigateBack();
  },

  async finishTable() {
    if (!this.roomId) return;
    try {
      await finishRoom(this.roomId);
      wx.showToast({ title: "已结束", icon: "success" });
      wx.navigateBack({ delta: 2 });
    } catch (err) {
      const msg = err?.errMsg || err?.message || "";
      if (msg.includes("NOT_HOST")) {
        wx.showToast({ title: "仅房主可结束", icon: "none" });
        return;
      }
      wx.showToast({ title: "结束失败", icon: "none" });
    }
  },
});
