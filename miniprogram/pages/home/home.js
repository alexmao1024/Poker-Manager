const {
  defaultConfig,
  loadTables,
  createTable,
  getProfile,
  saveProfile,
} = require("../../utils/storage");
const { formatRound, formatTime } = require("../../utils/format");

const defaultName = "玩家1";

Page({
  data: {
    tables: [],
    showCreate: false,
    showJoin: false,
    joinCode: "",
    profile: {
      name: defaultName,
      avatar: "",
    },
    profileInitial: "我",
    form: {
      playersText: "",
      stack: defaultConfig.stack,
      sb: defaultConfig.blinds.sb,
      bb: defaultConfig.blinds.bb,
      ante: defaultConfig.blinds.ante,
    },
  },

  onLoad() {
    const profile = getProfile() || { name: defaultName, avatar: "" };
    this.setProfile(profile);
    this.resetForm(profile);
  },

  onShow() {
    this.refreshTables();
  },

  refreshTables() {
    const tables = loadTables().map((table) => ({
      ...table,
      roundLabel: formatRound(table.round),
      updatedAtLabel: formatTime(table.updatedAt),
    }));
    this.setData({ tables });
  },

  resetForm(profile) {
    const name = profile?.name || defaultName;
    this.setData({
      form: {
        ...this.data.form,
        playersText: `${name},玩家2,玩家3,玩家4`,
      },
    });
  },

  setProfile(profile) {
    const initial = profile?.name ? profile.name.slice(0, 1) : "我";
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

  onInputPlayers(e) {
    this.setData({ "form.playersText": e.detail.value });
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
  onInputAnte(e) {
    this.setData({ "form.ante": Number(e.detail.value || 0) });
  },
  onInputJoin(e) {
    this.setData({ joinCode: e.detail.value });
  },

  createTable() {
    const form = this.data.form;
    const stack = Number(form.stack) || defaultConfig.stack;
    const names = form.playersText
      .split(/[,\n，]/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length < 2) {
      wx.showToast({ title: "至少两位玩家", icon: "none" });
      return;
    }

    const table = createTable({
      hostName: this.data.profile?.name || defaultName,
      players: names,
      stack,
      blinds: {
        sb: Number(form.sb) || defaultConfig.blinds.sb,
        bb: Number(form.bb) || defaultConfig.blinds.bb,
        ante: Number(form.ante) || defaultConfig.blinds.ante,
      },
    });

    this.setData({ showCreate: false });
    wx.navigateTo({ url: `/pages/table/table?id=${table.id}` });
  },

  joinTable() {
    const code = (this.data.joinCode || "").trim();
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: "请输入 6 位邀请码", icon: "none" });
      return;
    }
    const table = loadTables().find((item) => item.code === code);
    if (!table) {
      wx.showToast({ title: "未找到房间", icon: "none" });
      return;
    }
    this.setData({ showJoin: false });
    wx.navigateTo({ url: `/pages/table/table?id=${table.id}` });
  },

  openTable(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/table/table?id=${id}` });
  },

  onSyncProfile() {
    wx.getUserProfile({
      desc: "用于显示头像与昵称",
      success: (res) => {
        const profile = {
          name: res.userInfo?.nickName || defaultName,
          avatar: res.userInfo?.avatarUrl || "",
        };
        saveProfile(profile);
        this.setProfile(profile);
        this.resetForm(profile);
      },
      fail: () => {
        wx.showToast({ title: "未授权头像昵称", icon: "none" });
      },
    });
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
      },
    });
  },
});
