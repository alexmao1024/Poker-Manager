const { getProfile } = require("../../utils/storage");
const {
  getRoomById,
  watchRoom,
  applyAction,
  endRound,
  resetRound,
  leaveRoom,
  setAutoStage,
} = require("../../utils/roomService");
const { getOpenId } = require("../../utils/cloud");
const { formatRound } = require("../../utils/format");
const { isCloudFile, fetchCloudAvatarUrls, normalizeCloudFileId } = require("../../utils/avatar");

const DEFAULT_RAISE = 20;

function calcCurrentBet(players) {
  return players.reduce((max, player) => Math.max(max, player.bet || 0), 0);
}

function statusLabel(status, isTurn) {
  if (status === "fold") return "弃牌";
  if (status === "allin") return "全下";
  if (status === "out") return "出局";
  if (status === "waiting") return "等待下局";
  return isTurn ? "行动中" : "等待";
}

function stageActionLabel(round) {
  if (round === "preflop") return "发三张";
  if (round === "flop") return "发四张";
  if (round === "turn") return "发五张";
  if (round === "river") return "摊牌";
  return "收积分";
}

function buildSidePots(players, prevPots) {
  const contributions = (players || []).map((player) => ({
    id: player.id,
    name: player.name,
    total: (player.handBet || 0) + (player.bet || 0),
    status: player.status,
  }));
  const levels = Array.from(
    new Set(contributions.map((item) => item.total).filter((amount) => amount > 0))
  ).sort((a, b) => a - b);
  let prevLevel = 0;
  const result = [];
  const previous = Array.isArray(prevPots) ? prevPots : [];
  for (let potIndex = 0; potIndex < levels.length; potIndex += 1) {
    const level = levels[potIndex];
    const participants = contributions.filter((item) => item.total >= level);
    const potAmount = (level - prevLevel) * participants.length;
    if (potAmount <= 0) {
      prevLevel = level;
      continue;
    }
    const eligible = participants
      .filter((item) => item.status !== "fold" && item.status !== "out")
      .map((item) => ({ id: item.id, name: item.name, selected: false }));
    const prev = previous[potIndex];
    let winners = Array.isArray(prev?.winners)
      ? prev.winners.filter((id) => eligible.some((player) => player.id === id))
      : [];
    if (!winners.length && eligible.length === 1) {
      winners = [eligible[0].id];
    }
    const selectedSet = new Set(winners);
    const eligibleWithSelection = eligible.map((player) => ({
      ...player,
      selected: selectedSet.has(player.id),
    }));
    result.push({ amount: potAmount, eligible: eligibleWithSelection, winners });
    prevLevel = level;
  }
  return result;
}

function getErrorCode(err) {
  if (!err) return "";
  const msg = err.errMsg || err.message || "";
  const match = msg.match(/Error: ([A-Z_]+)/);
  return match ? match[1] : msg;
}

Page({
  data: {
    table: {
      name: "",
      code: "",
      blinds: { sb: 0, bb: 0 },
      pot: 0,
    },
    playersView: [],
    currentBet: 0,
    currentPlayer: { name: "", stack: 0, bet: 0 },
    callNeed: 0,
    roundLabel: "",
    raiseTo: 0,
    stageActionLabel: "发三张",
    displayPot: 0,
    dealerPlayer: { name: "-" },
    bigBlindPlayer: { name: "-" },
    smallBlindPlayer: { name: "-" },
    isHost: false,
    profileName: "",
    profile: null,
    canStartNextRound: false,
    openId: "",
    isStarted: false,
    roomStatusLabel: "",
    showRules: false,
    canAct: false,
    showSettle: false,
    settlePots: [],
    canAdvanceStage: false,
    canSettle: false,
    canFold: false,
    canAllIn: false,
    autoStage: true,
    showHostGuide: false,
  },

  async onLoad(query) {
    this.avatarErrorIds = new Set();
    this.avatarErrorSources = new Map();
    this.avatarUrlMap = new Map();
    this.avatarLoading = new Set();
    this.avatarLocalMap = new Map();
    this.avatarDownloadLoading = new Set();
    const profile = getProfile();
    this.setData({ profileName: profile?.name || "", profile: profile || null });
    this.roomId = query.id;
    const openId = await getOpenId().catch(() => "");
    if (openId) this.setData({ openId });

    const table = await getRoomById(this.roomId).catch(() => null);
    if (!table) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      return;
    }
    if (table.status === "lobby") {
      wx.redirectTo({ url: `/pages/lobby/lobby?id=${this.roomId}` });
      return;
    }
    this.syncView(table);
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

  syncView(table) {
    if (table.status === "lobby") {
      wx.redirectTo({ url: `/pages/lobby/lobby?id=${this.roomId}` });
      return;
    }
    const players = table.players || [];
    const turnIndex = players.length
      ? Math.min(table.turnIndex || 0, players.length - 1)
      : 0;
    const currentPlayer = players[turnIndex] || { name: "", stack: 0, bet: 0 };
    const currentBet = calcCurrentBet(players);
    const callNeed = Math.max(currentBet - (currentPlayer.bet || 0), 0);
    const raiseTo = currentBet > 0 ? currentBet + DEFAULT_RAISE : DEFAULT_RAISE;
    const dealerIndex = players.length ? (table.dealerIndex || 0) % players.length : 0;
    const smallBlindIndex = players.length ? (dealerIndex + 1) % players.length : 0;
    const bigBlindIndex = players.length ? (dealerIndex + 2) % players.length : 0;
    const roundBetSum = players.reduce((sum, player) => sum + (player.bet || 0), 0);
    const displayPot = (table.pot || 0) + roundBetSum;
    const activePlayers = players.filter((player) => player.status === "active");
    const roundId = Number.isFinite(table.roundId) ? table.roundId : 1;

    const avatarErrorIds = this.avatarErrorIds || new Set();
    const avatarErrorSources = this.avatarErrorSources || new Map();
    const pendingAvatarIds = [];
    const avatarUrlMap = this.avatarUrlMap || new Map();
    const avatarLocalMap = this.avatarLocalMap || new Map();
    const playersView = players.map((player, index) => {
      const isMine = player.openId && player.openId === this.data.openId;
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
        isTurn: index === turnIndex,
        isMine,
        avatarSource: sourceAvatar,
        avatar: resolvedAvatar,
        nameInitial: (player.name || "座").trim().slice(0, 1),
        statusLabel: statusLabel(player.status, index === turnIndex),
        statusClass: `status-${player.status || "active"}`,
        positionTag:
          index === dealerIndex
            ? "庄"
            : index === bigBlindIndex
              ? "大盲"
              : index === smallBlindIndex
                ? "小盲"
                : "",
      };
    });

    const hostByOpenId = table.hostOpenId && table.hostOpenId === this.data.openId;
    const hostByName = !table.hostOpenId && table.hostName === this.data.profileName;
    const isHost = !!hostByOpenId || !!hostByName;
    const autoStage = table.autoStage !== false;
    const isStarted = table.status === "active";
    const roomStatusLabel = isStarted ? formatRound(table.round) : "等待开局";
    const canAct =
      isStarted &&
      table.round !== "showdown" &&
      currentPlayer.openId &&
      currentPlayer.openId === this.data.openId;
    const allEqual =
      activePlayers.length <= 1 ||
      activePlayers.every((player) => (player.bet || 0) === (activePlayers[0]?.bet || 0));
    const allActed =
      activePlayers.length <= 0 ||
      activePlayers.every((player) => (player.actedRound || 0) === roundId);
    const canAdvanceStage =
      !autoStage && isHost && isStarted && table.round !== "showdown" && allEqual && allActed;
    const canSettle =
      isHost && isStarted && table.round === "showdown" && !table.settled && displayPot > 0;
    const canFold = canAct && activePlayers.length > 1;
    const canAllIn = canAct && (currentPlayer.stack || 0) > 0;
    const showSettle = this.data.showSettle && table.round === "showdown" && !table.settled;
    const settlePots = showSettle
      ? buildSidePots(players, this.data.settlePots)
      : [];
    const turnKey = `${table.round || ""}-${roundId}-${turnIndex}`;
    const stageLabel = formatRound(table.round);
    this.setData({
      table: { ...table, turnIndex },
      playersView,
      currentBet,
      currentPlayer: currentPlayer || { name: "", stack: 0, bet: 0 },
      callNeed,
      roundLabel: roomStatusLabel,
      raiseTo,
      stageActionLabel: stageActionLabel(table.round),
      displayPot,
      dealerPlayer: players[dealerIndex] || { name: "-" },
      bigBlindPlayer: players[bigBlindIndex] || { name: "-" },
      smallBlindPlayer: players[smallBlindIndex] || { name: "-" },
      isHost,
      canStartNextRound: isHost && isStarted && table.round === "showdown" && table.settled,
      isStarted,
      roomStatusLabel,
      canAct,
      showSettle,
      settlePots,
      canAdvanceStage,
      canSettle,
      canFold,
      canAllIn,
      autoStage,
    });
    this.loadAvatarUrls(pendingAvatarIds);
    this.maybeShowHostGuide(isHost);
    this.maybeAutoResetRound(isHost, table);

    if (!this.hasSynced) {
      this.hasSynced = true;
      this.lastRound = table.round;
      this.lastRoundId = roundId;
      this.lastTurnKey = turnKey;
      return;
    }

    const stageChanged =
      (this.lastRound && this.lastRound !== table.round) ||
      (this.lastRoundId && this.lastRoundId !== roundId);
    if (stageChanged) {
      const message =
        isHost && table.round !== "showdown"
          ? `进入${stageLabel}，请发牌`
          : `进入${stageLabel}`;
      wx.showToast({ title: message, icon: "none" });
    }

    if (canAct && this.lastTurnKey !== turnKey) {
      const delay = stageChanged ? 400 : 0;
      setTimeout(() => {
        wx.showToast({ title: "轮到你行动", icon: "none" });
        wx.vibrateShort?.();
      }, delay);
    }

    this.lastRound = table.round;
    this.lastRoundId = roundId;
    this.lastTurnKey = turnKey;
  },

  async maybeAutoResetRound(isHost, table) {
    if (!this.pendingAutoReset) return;
    if (!isHost) {
      this.pendingAutoReset = false;
      return;
    }
    if (table.round !== "showdown" || !table.settled) return;
    this.pendingAutoReset = false;
    const expected = {
      round: table.round,
      settled: table.settled,
    };
    try {
      await resetRound(this.roomId, expected, this.data.profileName);
    } catch (err) {
      // Ignore auto reset failures to avoid blocking.
    }
  },


  onInputRaise(e) {
    this.setData({ raiseTo: Number(e.detail.value || 0) });
  },

  onQuickRaise(e) {
    if (!this.data.canAct) return;
    const amount = Number(e.currentTarget.dataset.amount || 0);
    if (!amount) return;
    this.setData({ raiseTo: amount });
  },

  onFold() {
    if (!this.data.canFold) return;
    wx.showModal({
      title: "确认弃牌",
      content: "确定要弃牌吗？本局将无法再行动。",
      confirmText: "弃牌",
      confirmColor: "#d66b6b",
      success: (res) => {
        if (!res.confirm) return;
        this.applyAction("fold");
      },
    });
  },

  onCheckCall() {
    if (!this.data.canAct) return;
    const action = this.data.callNeed > 0 ? "call" : "check";
    this.applyAction(action);
  },

  onRaise() {
    if (!this.data.canAct) return;
    const currentBet = Number(this.data.currentBet || 0);
    const raiseTo = Number(this.data.raiseTo || 0);
    if (raiseTo < currentBet) {
      wx.showToast({ title: "出积分不能低于当前最高积分", icon: "none" });
      return;
    }
    const currentPlayerBet = Number(this.data.currentPlayer?.bet || 0);
    const delta = Math.max(raiseTo - currentPlayerBet, 0);
    wx.showModal({
      title: "确认出积分",
      content: `出积分到 ${raiseTo}（追加 ${delta}）？`,
      confirmText: "确认",
      success: (res) => {
        if (!res.confirm) return;
        this.applyAction("raise");
      },
    });
  },

  onAllIn() {
    if (!this.data.canAllIn) return;
    const stack = Number(this.data.currentPlayer?.stack || 0);
    wx.showModal({
      title: "确认全下",
      content: `确认全下 ${stack} 积分？`,
      confirmText: "全下",
      confirmColor: "#d66b6b",
      success: (res) => {
        if (!res.confirm) return;
        this.applyAction("allin");
      },
    });
  },


  async applyAction(type) {
    if (!this.roomId) return;
    if (!this.data.isStarted) {
      wx.showToast({ title: "房间未开始", icon: "none" });
      return;
    }
    const expected = {
      turnIndex: this.data.table?.turnIndex,
      round: this.data.table?.round,
      settled: this.data.table?.settled,
    };
    const raiseTo = Number(this.data.raiseTo || 0);
    try {
      await applyAction(this.roomId, type, raiseTo, expected);
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "TURN_CHANGED") {
        wx.showToast({ title: "轮到别人了", icon: "none" });
        return;
      }
      if (code === "ROUND_CHANGED") {
        wx.showToast({ title: "阶段已更新", icon: "none" });
        return;
      }
      if (code === "NOT_STARTED") {
        wx.showToast({ title: "房间未开始", icon: "none" });
        return;
      }
      if (code === "SETTLED_CHANGED") {
        wx.showToast({ title: "已收积分", icon: "none" });
        return;
      }
      if (code === "NOT_ACTIVE") {
        wx.showToast({ title: "当前玩家不可行动", icon: "none" });
        return;
      }
      if (code === "NEED_CALL") {
        wx.showToast({ title: "需要跟积分", icon: "none" });
        return;
      }
      if (code === "SEAT_UNBOUND") {
        wx.showToast({ title: "尚未加入房间", icon: "none" });
        return;
      }
      if (code === "NOT_OWNER") {
        wx.showToast({ title: "不是你的座位", icon: "none" });
        return;
      }
      if (code === "RAISE_TOO_LOW") {
        wx.showToast({ title: "出积分不能低于当前最高积分", icon: "none" });
        return;
      }
      if (code === "ROUND_OVER") {
        wx.showToast({ title: "已进入摊牌阶段", icon: "none" });
        return;
      }
      if (code === "LAST_PLAYER") {
        wx.showToast({ title: "仅剩一人，不能弃牌", icon: "none" });
        return;
      }
      if (code === "NO_STACK") {
        wx.showToast({ title: "积分不足", icon: "none" });
        return;
      }
      const fallback = err?.errMsg || err?.message || "操作失败";
      console.error("applyAction failed:", err);
      wx.showToast({ title: code ? `操作失败：${code}` : fallback, icon: "none" });
    }
  },

  async advanceStage() {
    if (!this.roomId) return;
    if (!this.data.isStarted) {
      wx.showToast({ title: "房间未开始", icon: "none" });
      return;
    }
    const expected = {
      round: this.data.table?.round,
      settled: this.data.table?.settled,
      turnIndex: this.data.table?.turnIndex,
    };
    try {
      await endRound(this.roomId, expected);
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "SETTLED") {
        wx.showToast({ title: "已收积分", icon: "none" });
        return;
      }
      if (code === "NOT_EQUAL") {
        wx.showToast({ title: "还有人未跟积分", icon: "none" });
        return;
      }
      if (code === "NOT_ACTED") {
        wx.showToast({ title: "还有人未行动", icon: "none" });
        return;
      }
      if (code === "NO_POT") {
        wx.showToast({ title: "暂无可收积分", icon: "none" });
        return;
      }
      if (code === "ROUND_CHANGED") {
        wx.showToast({ title: "阶段已更新", icon: "none" });
        return;
      }
      if (code === "SETTLED_CHANGED") {
        wx.showToast({ title: "已收积分", icon: "none" });
        return;
      }
      if (code === "TURN_CHANGED") {
        wx.showToast({ title: "状态已更新", icon: "none" });
        return;
      }
      if (code === "NOT_STARTED") {
        wx.showToast({ title: "房间未开始", icon: "none" });
        return;
      }
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可操作", icon: "none" });
        return;
      }
      wx.showToast({ title: "操作失败", icon: "none" });
    }
  },

  onStageAction() {
    if (!this.data.isStarted) return;
    if (this.data.table?.round === "showdown") {
      if (!this.data.isHost) {
        wx.showToast({ title: "仅房主可收积分", icon: "none" });
        return;
      }
      if (!this.data.canSettle) {
        wx.showToast({ title: "暂无可收积分", icon: "none" });
        return;
      }
      this.openSettle();
      return;
    }
    if (this.data.autoStage) {
      wx.showToast({ title: "自动推进中", icon: "none" });
      return;
    }
    if (!this.data.isHost) {
      wx.showToast({ title: "仅房主可操作", icon: "none" });
      return;
    }
    this.advanceStage();
  },

  async onAutoStageChange(e) {
    if (!this.roomId) return;
    if (!this.data.isHost) return;
    const enabled = !!e.detail.value;
    const prev = this.data.autoStage;
    try {
      await setAutoStage(this.roomId, enabled);
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可修改", icon: "none" });
      } else {
        wx.showToast({ title: "更新失败", icon: "none" });
      }
      this.setData({ autoStage: prev });
    }
  },

  openSettle() {
    const players = this.data.table?.players || [];
    const settlePots = buildSidePots(players, []);
    if (!settlePots.length) {
      wx.showToast({ title: "暂无可收积分", icon: "none" });
      return;
    }
    this.setData({ showSettle: true, settlePots });
  },

  closeSettle() {
    this.setData({ showSettle: false, settlePots: [] });
  },

  togglePotWinner(e) {
    const potIndex = Number(e.currentTarget.dataset.potindex);
    const id = e.currentTarget.dataset.id;
    if (!id || !Number.isFinite(potIndex)) return;
    const pots = (this.data.settlePots || []).map((pot, index) => {
      if (index !== potIndex) return pot;
      const current = new Set(pot.winners || []);
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
      const winners = Array.from(current);
      const selectedSet = new Set(winners);
      const eligible = (pot.eligible || []).map((player) => ({
        ...player,
        selected: selectedSet.has(player.id),
      }));
      return { ...pot, winners, eligible };
    });
    this.setData({ settlePots: pots });
  },

  async confirmSettle() {
    if (!this.roomId) return;
    if (!this.data.isStarted) return;
    const pots = this.data.settlePots || [];
    if (!pots.length) {
      wx.showToast({ title: "暂无可收积分", icon: "none" });
      return;
    }
    const missing = pots.find((pot) => !(pot.winners || []).length);
    if (missing) {
      wx.showToast({ title: "还有侧池未选赢家", icon: "none" });
      return;
    }
    const expected = {
      round: this.data.table?.round,
      settled: this.data.table?.settled,
      turnIndex: this.data.table?.turnIndex,
    };
    try {
      const winnersByPot = pots.map((pot) => pot.winners || []);
      await endRound(this.roomId, expected, winnersByPot);
      if (this.data.isHost) {
        this.pendingAutoReset = true;
      }
      this.setData({ showSettle: false, settlePots: [] });
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NO_WINNERS") {
        wx.showToast({ title: "请选择收积分的人", icon: "none" });
        return;
      }
      if (code === "NO_POT") {
        wx.showToast({ title: "暂无可收积分", icon: "none" });
        return;
      }
      if (code === "NO_WINNERS") {
        wx.showToast({ title: "请选择赢家", icon: "none" });
        return;
      }
      if (code === "NO_POT_WINNER") {
        wx.showToast({ title: "侧池未选赢家", icon: "none" });
        return;
      }
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可收积分", icon: "none" });
        return;
      }
      if (code === "ROUND_CHANGED" || code === "SETTLED_CHANGED") {
        wx.showToast({ title: "状态已更新", icon: "none" });
        return;
      }
      if (code === "TURN_CHANGED") {
        wx.showToast({ title: "状态已更新", icon: "none" });
        return;
      }
      wx.showToast({ title: "收积分失败", icon: "none" });
    }
  },

  async resetHand() {
    if (!this.roomId) return;
    if (!this.data.isStarted) {
      wx.showToast({ title: "房间未开始", icon: "none" });
      return;
    }
    const expected = {
      round: this.data.table?.round,
      settled: this.data.table?.settled,
    };
    try {
      await resetRound(this.roomId, expected, this.data.profileName);
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NOT_SETTLED") {
        wx.showToast({ title: "请先收积分", icon: "none" });
        return;
      }
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可进入下一回合", icon: "none" });
        return;
      }
      if (code === "ROUND_CHANGED" || code === "SETTLED_CHANGED") {
        wx.showToast({ title: "状态已更新", icon: "none" });
        return;
      }
      wx.showToast({ title: "操作失败", icon: "none" });
    }
  },

  goSummary() {
    if (!this.roomId) return;
    wx.navigateTo({ url: `/pages/summary/summary?id=${this.roomId}` });
  },

  async leaveRoom() {
    if (!this.roomId) return;
    if (this.data.isHost) {
      wx.showToast({ title: "房主请结束房间", icon: "none" });
      return;
    }
    wx.showModal({
      title: "退出房间",
      content: "退出后本回合视为弃牌，下回合移出座位。",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await leaveRoom(this.roomId);
          wx.showToast({ title: "已退出房间", icon: "none" });
          wx.reLaunch({ url: "/pages/home/home" });
        } catch (err) {
          const code = getErrorCode(err);
          if (code === "HOST_CANNOT_LEAVE") {
            wx.showToast({ title: "房主请结束房间", icon: "none" });
            return;
          }
          wx.showToast({ title: "退出失败", icon: "none" });
        }
      },
    });
  },

  openRules() {
    this.setData({ showRules: true });
  },

  closeRules() {
    this.setData({ showRules: false });
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

  onShareAppMessage() {
    const code = this.data.table?.code || "";
    const title = code ? `筹码计分 · 房间号 ${code}` : "筹码计分";
    const path = this.roomId ? `/pages/table/table?id=${this.roomId}` : "/pages/home/home";
    return { title, path };
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
      const playersView = (this.data.playersView || []).map((player) => {
        if (!player.avatarSource || !isCloudFile(player.avatarSource)) return player;
        const localCached = this.avatarLocalMap?.get(player.avatarSource);
        if (localCached) return { ...player, avatar: localCached };
        const nextUrl = this.avatarUrlMap.get(player.avatarSource);
        if (!nextUrl) return player;
        return { ...player, avatar: nextUrl };
      });
      this.setData({ playersView });
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
    const playersView = (this.data.playersView || []).map((player) => {
      if (!player.avatarSource || !isCloudFile(player.avatarSource)) return player;
      const localCached = this.avatarLocalMap.get(player.avatarSource);
      if (!localCached) return player;
      return { ...player, avatar: localCached };
    });
    this.setData({ playersView });
    unique.forEach((id) => loading.delete(id));
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
    this.setData({ playersView });
  },
});
