const { getProfile } = require("../../utils/storage");
const {
  getRoomById,
  watchRoom,
  applyAction: applyRoomAction,
  endRound,
  resetRound,
  leaveRoom,
  rebuy,
} = require("../../utils/roomService");
const { getOpenId } = require("../../utils/cloud");
const { formatRound } = require("../../utils/format");
const { isCloudFile, fetchCloudAvatarUrls, normalizeCloudFileId } = require("../../utils/avatar");
const { createRoomStore } = require("../../stores/roomStore");

const DEFAULT_RAISE = 20;
const roomStore = createRoomStore();

function calcCurrentBet(players) {
  return players.reduce((max, player) => Math.max(max, player.bet || 0), 0);
}

function calcZhjCurrentBet(players, baseBet) {
  return Math.max(Number(baseBet || 0), calcCurrentBet(players));
}

function getZhjRoundLabel(table) {
  if (table?.zjhStage === "showdown" || table?.round === "showdown") {
    return "开牌";
  }
  const roundCount = Number.isFinite(table?.zjhRoundCount) ? table.zjhRoundCount : 1;
  return `第${roundCount}轮`;
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

function updateRoomStore(room) {
  roomStore.setState({ room: room || null });
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
    displayCallNeed: 0,
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
    canSee: false,
    canCompare: false,
    showCompare: false,
    compareTargets: [],
    compareTargetId: "",
    compareResult: "win",
    canRebuy: false,
    showRebuy: false,
    rebuyAmount: 0,
    rebuyLimit: 0,
    showHostGuide: false,
    turnLeft: 0,
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

    const table = await getRoomById(this.roomId).catch(() => null);
    if (!table) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      wx.reLaunch({ url: "/pages/home/home" });
      return;
    }
    if (table.status === "lobby") {
      wx.redirectTo({ url: `/pages/lobby/lobby?id=${this.roomId}` });
      return;
    }
    updateRoomStore(table);
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
    this.clearTurnCountdown();
  },

  onHide() {
    if (this.roomWatcher) {
      this.roomWatcher.close();
      this.roomWatcher = null;
    }
    this.wasHidden = true;
    this.clearTurnCountdown();
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
    const table = await getRoomById(this.roomId).catch(() => null);
    if (!table) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      wx.reLaunch({ url: "/pages/home/home" });
      return;
    }
    if (table.status === "lobby") {
      wx.redirectTo({ url: `/pages/lobby/lobby?id=${this.roomId}` });
      return;
    }
    updateRoomStore(table);
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
    const gameType = table.gameType || "texas";
    const isZhj = gameType === "zhajinhua";
    const baseBet = Number(table.gameRules?.baseBet || 0);
    const currentBet = isZhj
      ? calcZhjCurrentBet(players, baseBet)
      : calcCurrentBet(players);
    const callNeed = Math.max(currentBet - (currentPlayer.bet || 0), 0);
    const displayCallNeed = isZhj && currentPlayer.seen ? callNeed * 2 : callNeed;
    const raiseTo = isZhj
      ? currentBet + baseBet
      : currentBet > 0
        ? currentBet + DEFAULT_RAISE
        : DEFAULT_RAISE;
    const dealerIndex = players.length ? (table.dealerIndex || 0) % players.length : 0;
    const smallBlindIndex = players.length ? (dealerIndex + 1) % players.length : 0;
    const bigBlindIndex = players.length ? (dealerIndex + 2) % players.length : 0;
    const roundBetSum = players.reduce((sum, player) => sum + (player.bet || 0), 0);
    const displayPot = isZhj ? Number(table.pot || 0) : (table.pot || 0) + roundBetSum;
    const activePlayers = players.filter((player) => player.status === "active");
    const selfPlayer = players.find((player) => player.openId === this.data.openId) || null;
    const roundId = isZhj
      ? Number.isFinite(table.zjhRoundCount)
        ? table.zjhRoundCount
        : 1
      : Number.isFinite(table.roundId)
        ? table.roundId
        : 1;

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
        displayBet: isZhj ? Number(player.handBet || 0) : Number(player.bet || 0),
        seenLabel: isZhj ? (player.seen ? "明牌" : "闷牌") : "",
        positionTag:
          index === dealerIndex
            ? "庄"
            : isZhj
              ? ""
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
    const autoStage = true;
    const isStarted = table.status === "active";
    const roomStatusLabel = isStarted
      ? isZhj
        ? getZhjRoundLabel(table)
        : formatRound(table.round)
      : "等待开局";
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
      !isZhj && !autoStage && isHost && isStarted && table.round !== "showdown" && allEqual && allActed;
    const canSettle =
      isHost && isStarted && table.round === "showdown" && !table.settled && displayPot > 0;
    const canFold = canAct && activePlayers.length > 1;
    const canAllIn = canAct && (currentPlayer.stack || 0) > 0;
    const minSeeRound = Number(table.gameRules?.minSeeRound || 0);
    const compareAllowedAfter = Number(table.gameRules?.compareAllowedAfter || 0);
    const compareTargets = isZhj
      ? players.filter(
          (player) =>
            player.id !== currentPlayer.id &&
            player.status !== "fold" &&
            player.status !== "out"
        )
      : [];
    const canSee = isZhj && canAct && !currentPlayer.seen && roundId >= minSeeRound;
    const canCompare =
      isZhj &&
      canAct &&
      currentPlayer.seen &&
      roundId >= compareAllowedAfter &&
      compareTargets.length > 0;
    const rebuyLimit = isZhj
      ? Number(table.gameRules?.rebuyLimit || table.gameRules?.buyIn || 0)
      : Number(table.stack || 0);
    const canRebuy = isStarted && table.settled && !!selfPlayer;
    const showCompare = this.data.showCompare && canCompare;
    const compareTargetId =
      compareTargets.some((player) => player.id === this.data.compareTargetId)
        ? this.data.compareTargetId
        : "";
    const compareResult = this.data.compareResult || "win";
    const showRebuy = this.data.showRebuy && canRebuy;
    const showSettle = this.data.showSettle && table.round === "showdown" && !table.settled;
    const settlePots = showSettle
      ? buildSidePots(players, this.data.settlePots)
      : [];
    const turnKey = `${table.round || ""}-${roundId}-${turnIndex}`;
    const stageLabel = isZhj ? roomStatusLabel : formatRound(table.round);
    this.setData({
      table: { ...table, turnIndex },
      playersView,
      currentBet,
      currentPlayer: currentPlayer || { name: "", stack: 0, bet: 0 },
      callNeed,
      displayCallNeed,
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
      canSee,
      canCompare,
      showCompare,
      compareTargets,
      compareTargetId,
      compareResult,
      canRebuy,
      showRebuy,
      rebuyLimit,
      autoStage,
    });
    this.setupTurnCountdown(table, turnKey);
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

  clearTurnCountdown() {
    if (this.turnCountdownTimer) {
      clearInterval(this.turnCountdownTimer);
      this.turnCountdownTimer = null;
    }
    this.turnCountdownKey = "";
  },

  setupTurnCountdown(table, turnKey) {
    const expiresAt = Number(table?.turnExpiresAt || 0);
    if (!expiresAt || table?.round === "showdown") {
      this.clearTurnCountdown();
      if (this.data.turnLeft !== 0) {
        this.setData({ turnLeft: 0 });
      }
      return;
    }
    const countdownKey = `${turnKey}_${expiresAt}`;
    if (this.turnCountdownKey === countdownKey) return;
    this.clearTurnCountdown();
    this.turnCountdownKey = countdownKey;

    const tick = () => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (left !== this.data.turnLeft) {
        this.setData({ turnLeft: left });
      }
      if (left <= 0) {
        this.clearTurnCountdown();
        this.handleTurnTimeout(turnKey);
      }
    };

    tick();
    this.turnCountdownTimer = setInterval(tick, 500);
  },

  async handleTurnTimeout(turnKey) {
    if (!this.data.isStarted) return;
    if (this.data.table?.round === "showdown") return;
    if (!(this.data.isHost || this.data.canAct)) return;
    if (this.timeoutHandlingKey === turnKey) return;
    this.timeoutHandlingKey = turnKey;
    try {
      this.isTimeoutRequest = true;
      await this.applyAction("timeout");
    } finally {
      this.isTimeoutRequest = false;
      setTimeout(() => {
        if (this.timeoutHandlingKey === turnKey) {
          this.timeoutHandlingKey = "";
        }
      }, 1200);
    }
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
    const isZhj = this.data.table?.gameType === "zhajinhua";
    const action = isZhj ? "call" : this.data.callNeed > 0 ? "call" : "check";
    this.applyAction(action);
  },

  onRaise() {
    if (!this.data.canAct) return;
    const currentBet = Number(this.data.currentBet || 0);
    const raiseTo = Number(this.data.raiseTo || 0);
    const isZhj = this.data.table?.gameType === "zhajinhua";
    const baseBet = Number(this.data.table?.gameRules?.baseBet || 0);
    const minRaise = isZhj ? currentBet + baseBet : currentBet;
    if (raiseTo < minRaise) {
      const title = isZhj ? "加注不能低于当前注 + 底注" : "出积分不能低于当前最高积分";
      wx.showToast({ title, icon: "none" });
      return;
    }
    const currentPlayerBet = Number(this.data.currentPlayer?.bet || 0);
    const delta = Math.max(raiseTo - currentPlayerBet, 0);
    const actualDelta = isZhj && this.data.currentPlayer?.seen ? delta * 2 : delta;
    const deltaLabel = isZhj ? actualDelta : delta;
    wx.showModal({
      title: isZhj ? "确认加注" : "确认出积分",
      content: `${isZhj ? "加注到" : "出积分到"} ${raiseTo}（追加 ${deltaLabel}）？`,
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

  onSee() {
    if (!this.data.canSee) return;
    this.applyAction("see");
  },

  openCompare() {
    if (!this.data.canCompare) return;
    this.setData({ showCompare: true, compareTargetId: "", compareResult: "win" });
  },

  closeCompare() {
    this.setData({ showCompare: false });
  },

  selectCompareTarget(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ compareTargetId: id });
  },

  selectCompareResult(e) {
    const result = e.currentTarget.dataset.result;
    if (!result) return;
    this.setData({ compareResult: result });
  },

  confirmCompare() {
    const targetId = this.data.compareTargetId;
    const result = this.data.compareResult || "win";
    if (!targetId) {
      wx.showToast({ title: "请选择对手", icon: "none" });
      return;
    }
    this.applyAction("compare", { targetId, result });
    this.setData({ showCompare: false });
  },


  async applyAction(type, options = {}) {
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
    const raiseTo = Number.isFinite(Number(options.raiseTo))
      ? Number(options.raiseTo)
      : Number(this.data.raiseTo || 0);
    const targetId = options.targetId || "";
    const result = options.result || "";
    try {
      await applyRoomAction(this.roomId, type, raiseTo, expected, targetId, result);
    } catch (err) {
      const code = getErrorCode(err);
      if (
        this.isTimeoutRequest &&
        (code === "TURN_CHANGED" || code === "ROUND_CHANGED" || code === "NOT_TIMEOUT")
      ) {
        return;
      }
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
        const isZhj = this.data.table?.gameType === "zhajinhua";
        wx.showToast({ title: isZhj ? "加注不足" : "出积分不能低于当前最高积分", icon: "none" });
        return;
      }
      if (code === "INVALID_RAISE") {
        wx.showToast({ title: "加注无效", icon: "none" });
        return;
      }
      if (code === "CANNOT_SEE") {
        wx.showToast({ title: "未到可看牌轮数", icon: "none" });
        return;
      }
      if (code === "CANNOT_COMPARE") {
        wx.showToast({ title: "未到可比牌轮数", icon: "none" });
        return;
      }
      if (code === "NO_TARGET") {
        wx.showToast({ title: "请选择对手", icon: "none" });
        return;
      }
      if (code === "INVALID_TARGET") {
        wx.showToast({ title: "对手不可比", icon: "none" });
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
      if (code === "NOT_TIMEOUT") {
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

  openRebuy() {
    if (!this.data.canRebuy) return;
    const limit = Number(this.data.rebuyLimit || 0);
    const base =
      this.data.table?.gameType === "zhajinhua"
        ? Number(this.data.table?.gameRules?.baseBet || 0)
        : Number(this.data.table?.blinds?.bb || 0);
    const defaultAmount = limit > 0 ? limit : base > 0 ? base : 0;
    this.setData({ showRebuy: true, rebuyAmount: defaultAmount });
  },

  closeRebuy() {
    this.setData({ showRebuy: false });
  },

  onRebuyInput(e) {
    this.setData({ rebuyAmount: Number(e.detail.value || 0) });
  },

  async confirmRebuy() {
    if (!this.roomId) return;
    const amount = Number(this.data.rebuyAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: "补码金额无效", icon: "none" });
      return;
    }
    const limit = Number(this.data.rebuyLimit || 0);
    if (limit > 0 && amount > limit) {
      wx.showToast({ title: "超过补码上限", icon: "none" });
      return;
    }
    try {
      await rebuy(this.roomId, amount);
      wx.showToast({ title: "已补码", icon: "success" });
      this.setData({ showRebuy: false });
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NOT_SETTLED") {
        wx.showToast({ title: "请先收积分", icon: "none" });
        return;
      }
      if (code === "INVALID_REBUY") {
        wx.showToast({ title: "补码金额无效", icon: "none" });
        return;
      }
      if (code === "REBUY_TOO_LARGE") {
        wx.showToast({ title: "超过补码上限", icon: "none" });
        return;
      }
      wx.showToast({ title: "补码失败", icon: "none" });
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
