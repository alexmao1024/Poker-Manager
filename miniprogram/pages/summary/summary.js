const { getTableById, updateTable } = require("../../utils/storage");
const { formatRound } = require("../../utils/format");

function buildSummary(players) {
  return players.map((player) => {
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
  },

  onLoad(query) {
    const table = getTableById(query.id);
    if (!table) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      return;
    }
    this.syncView(table);
  },

  syncView(table) {
    this.setData({
      table,
      summaryList: buildSummary(table.players || []),
      roundLabel: formatRound(table.round),
    });
  },

  backToTable() {
    const id = this.data.table?.id;
    if (!id) return;
    wx.navigateBack();
  },

  finishTable() {
    const table = { ...this.data.table, status: "finished" };
    updateTable(table);
    wx.showToast({ title: "已结束", icon: "success" });
    wx.navigateBack({ delta: 2 });
  },
});
