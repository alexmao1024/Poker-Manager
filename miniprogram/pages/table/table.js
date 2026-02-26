const { getProfile } = require("../../utils/storage");
const {
  getRoomById,
  watchRoom,
  applyAction: applyRoomAction,
  endRound,
  resetRound,
  leaveRoom,
  rebuy,
  adjustChips,
  setNextAnteSponsor,
  setZhjCompareRules,
} = require("../../utils/roomService");
const { getOpenId } = require("../../utils/cloud");
const { formatRound } = require("../../utils/format");
const { isCloudFile, fetchCloudAvatarUrls, normalizeCloudFileId } = require("../../utils/avatar");
const { createRoomStore } = require("../../stores/roomStore");

const DEFAULT_RAISE = 20;
// 填入云存储 fileID 后，牌力说明会优先使用云端图片；留空则回退本地 assets。
const TEXAS_RULES_IMAGE_FILE_ID =
  "cloud://cloud1-1gzq30qb675a8cf8.636c-cloud1-1gzq30qb675a8cf8-1394977863/avatars/hand-ranks.png";
const ZHJ_RULES_IMAGE_FILE_ID =
  "cloud://cloud1-1gzq30qb675a8cf8.636c-cloud1-1gzq30qb675a8cf8-1394977863/avatars/zjh-hand-ranks.png";
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

function buildQuickRaiseOptions({ isZhj, currentBet, callNeed, baseBet, seen }) {
  const presets = isZhj ? [5, 10, 20, 50, 100, 200] : [5, 10, 20, 50, 100, 500];
  if (!isZhj) {
    const actualCallNeed = Math.max(0, Math.ceil(Number(callNeed || 0)));
    let values = presets.filter((amount) => amount >= actualCallNeed);
    if (actualCallNeed > 0 && !values.includes(actualCallNeed)) {
      values.unshift(actualCallNeed);
    }
    return Array.from(new Set(values))
      .sort((a, b) => a - b)
      .slice(0, 6)
      .map((amount) => ({ amount, label: `出${amount}` }));
  }

  const factor = seen ? 2 : 1;
  const actualCallNeed = Math.max(0, Math.ceil(Number(callNeed || 0) * factor));
  let actualMinRaise = Math.max(0, Math.ceil((Number(callNeed || 0) + Number(baseBet || 0)) * factor));
  if (seen && actualMinRaise % 2 !== 0) {
    actualMinRaise += 1;
  }

  let values = presets.slice();
  if (seen) {
    values = values.filter((amount) => amount % 2 === 0);
  }
  values = values.filter((amount) => amount >= Math.max(1, actualMinRaise));

  if (actualCallNeed > 0 && (!seen || actualCallNeed % 2 === 0) && !values.includes(actualCallNeed)) {
    values.unshift(actualCallNeed);
  }
  if (actualMinRaise > 0 && !values.includes(actualMinRaise)) {
    values.unshift(actualMinRaise);
  }

  return Array.from(new Set(values))
    .sort((a, b) => a - b)
    .slice(0, 6)
    .map((amount) => ({ amount, label: `出${amount}` }));
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
  const mergedPots = [];
  for (let potIndex = 0; potIndex < levels.length; potIndex += 1) {
    const level = levels[potIndex];
    const participants = contributions.filter((item) => item.total >= level);
    const potAmount = (level - prevLevel) * participants.length;
    prevLevel = level;
    if (potAmount <= 0) {
      continue;
    }
    const eligible = participants
      .filter((item) => item.status !== "fold" && item.status !== "out")
      .map((item) => ({ id: item.id, name: item.name }));
    const lastPot = mergedPots[mergedPots.length - 1];
    if (!eligible.length) {
      if (lastPot) {
        lastPot.amount += potAmount;
      }
      continue;
    }
    const signature = eligible
      .map((item) => item.id)
      .sort()
      .join("|");
    if (lastPot && lastPot.signature === signature) {
      lastPot.amount += potAmount;
      continue;
    }
    mergedPots.push({ amount: potAmount, eligible, signature });
  }

  const result = [];
  const previous = Array.isArray(prevPots) ? prevPots : [];
  for (let potIndex = 0; potIndex < mergedPots.length; potIndex += 1) {
    const pot = mergedPots[potIndex];
    const prev = previous[potIndex];
    const eligibleIds = new Set(pot.eligible.map((player) => player.id));
    let winners = Array.isArray(prev?.winners)
      ? prev.winners.filter((id) => eligibleIds.has(id))
      : [];
    if (!winners.length && pot.eligible.length === 1) {
      winners = [pot.eligible[0].id];
    }
    const selectedSet = new Set(winners);
    const eligibleWithSelection = pot.eligible.map((player) => ({
      ...player,
      selected: selectedSet.has(player.id),
    }));
    result.push({ amount: pot.amount, eligible: eligibleWithSelection, winners });
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
    quickRaiseOptions: [],
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
    hostAdjustTargets: [],
    showAdjustChips: false,
    adjustChipTargetId: "",
    adjustChipMode: "add",
    adjustChipAmount: 0,
    showNextAnteSponsor: false,
    nextAnteSponsorTargets: [],
    nextAnteSponsorTargetId: "",
    zjhNextAnteSponsorName: "",
    showZhjCompareRules: false,
    zjhBanCompareWhenDark: false,
    waitActionText: "",
    texasRulesImageSrc: TEXAS_RULES_IMAGE_FILE_ID || "/assets/hand-ranks.png",
    zhjRulesImageSrc: ZHJ_RULES_IMAGE_FILE_ID || "/assets/zjh-hand-ranks.png",
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
      ? (currentPlayer.seen ? (callNeed + baseBet) * 2 : callNeed + baseBet)
      : currentBet > 0
        ? currentBet + DEFAULT_RAISE
        : DEFAULT_RAISE;
    const quickRaiseOptions = buildQuickRaiseOptions({
      isZhj,
      currentBet,
      callNeed,
      baseBet,
      seen: !!currentPlayer.seen,
    });
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
    const inHandPlayers = isZhj
      ? players.filter((player) => player.status !== "fold" && player.status !== "out")
      : [];
    const hasDarkInHand = isZhj && inHandPlayers.some((player) => !player.seen);
    const zjhBanCompareWhenDark = !!table.zjhBanCompareWhenDark;
    const headsUpMixedCompareAllowed =
      isZhj &&
      inHandPlayers.length === 2 &&
      inHandPlayers.some((player) => !!player.seen) &&
      inHandPlayers.some((player) => !player.seen);
    const compareBlockedByDarkRule =
      isZhj &&
      zjhBanCompareWhenDark &&
      hasDarkInHand &&
      !headsUpMixedCompareAllowed;
    const canSee = isZhj && canAct && !currentPlayer.seen && roundId >= minSeeRound;
    const canCompare =
      isZhj &&
      canAct &&
      currentPlayer.seen &&
      roundId >= compareAllowedAfter &&
      compareTargets.length > 0 &&
      !compareBlockedByDarkRule;
    const rebuyLimit = isZhj
      ? Number(table.gameRules?.rebuyLimit || table.gameRules?.buyIn || 0)
      : Number(table.stack || 0);
    const canRebuy = isStarted && table.settled && !!selfPlayer;
    const nextAnteSponsorTargets = isZhj
      ? players
          .filter((player) => !player.left)
          .map((player) => ({
            id: player.id,
            name: player.name || "玩家",
            stack: Number(player.stack || 0),
            status: player.status || "active",
          }))
      : [];
    const zjhNextAnteSponsorName =
      isZhj && table.zjhNextAnteSponsorId
        ? nextAnteSponsorTargets.find((item) => item.id === table.zjhNextAnteSponsorId)?.name || ""
        : "";
    const nextAnteSponsorTargetId = nextAnteSponsorTargets.some(
      (item) => item.id === this.data.nextAnteSponsorTargetId
    )
      ? this.data.nextAnteSponsorTargetId
      : table.zjhNextAnteSponsorId || "";
    const canSetNextAnteSponsor = isZhj && isHost && isStarted && table.round === "showdown" && table.settled;
    const showNextAnteSponsor = this.data.showNextAnteSponsor && canSetNextAnteSponsor;
    const canSetZhjCompareRules =
      isZhj && isHost && isStarted && table.round !== "showdown";
    const showZhjCompareRules = this.data.showZhjCompareRules && canSetZhjCompareRules;
    const hostAdjustTargets = players.map((player) => ({
      id: player.id,
      name: player.name || "玩家",
      stack: Number(player.stack || 0),
      status: player.status || "active",
    }));
    const adjustChipTargetId = hostAdjustTargets.some((item) => item.id === this.data.adjustChipTargetId)
      ? this.data.adjustChipTargetId
      : hostAdjustTargets[0]?.id || "";
    const showAdjustChips = this.data.showAdjustChips && isHost && isStarted;
    let waitActionText = "等待轮到你";
    if (table.round === "showdown") {
      if (table.settled) {
        if (canRebuy) {
          waitActionText = isHost
            ? "本手已结算，可补码。你可开始下一回合。"
            : "本手已结算，可补码。等待房主开始下一回合。";
        } else {
          waitActionText = isHost
            ? "本手已结算。你可开始下一回合。"
            : "本手已结算。等待房主开始下一回合。";
        }
      } else {
        waitActionText = "等待房主收积分。";
      }
    }
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
      quickRaiseOptions,
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
      hostAdjustTargets,
      showAdjustChips,
      adjustChipTargetId,
      nextAnteSponsorTargets,
      showNextAnteSponsor,
      nextAnteSponsorTargetId,
      zjhNextAnteSponsorName,
      showZhjCompareRules,
      zjhBanCompareWhenDark,
      waitActionText,
      autoStage,
    });
    this.loadAvatarUrls(pendingAvatarIds);
    this.maybeShowHostGuide(isHost);

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

  onInputRaise(e) {
    this.setData({ raiseTo: Number(e.detail.value || 0) });
  },

  onQuickRaise(e) {
    if (!this.data.canAct) return;
    const amount = Number(e.currentTarget.dataset.amount || 0);
    if (!amount) return;
    const isZhj = this.data.table?.gameType === "zhajinhua";
    const actualCallNeed = Number(isZhj ? this.data.displayCallNeed : this.data.callNeed || 0);
    if (actualCallNeed > 0 && amount === actualCallNeed) {
      wx.showModal({
        title: "确认快捷出分",
        content: [`本次出分（实际扣分）：${amount}。`, "", "动作：跟注。"].join("\n"),
        confirmText: "确认",
        success: (res) => {
          if (!res.confirm) return;
          this.applyAction("call");
        },
      });
      return;
    }
    this.setData({ raiseTo: amount });
    this.onRaise({ raiseInputOverride: amount, fromQuick: true, quickActualMode: !isZhj });
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

  onRaise(options = {}) {
    if (!this.data.canAct) return;
    const currentBet = Number(this.data.currentBet || 0);
    const raiseInput = Number.isFinite(Number(options.raiseInputOverride))
      ? Number(options.raiseInputOverride)
      : Number(this.data.raiseTo || 0);
    const isZhj = this.data.table?.gameType === "zhajinhua";
    const isTexasQuickActual = !isZhj && !!options.quickActualMode;
    const baseBet = Number(this.data.table?.gameRules?.baseBet || 0);
    const callNeed = Number(this.data.callNeed || 0);
    const currentPlayerBet = Number(this.data.currentPlayer?.bet || 0);
    const seen = !!this.data.currentPlayer?.seen;
    const minRaise = isZhj
      ? seen
        ? (callNeed + baseBet) * 2
        : callNeed + baseBet
      : isTexasQuickActual
        ? Math.max(callNeed + 1, 1)
        : currentBet;
    if (isZhj && seen && raiseInput % 2 !== 0) {
      wx.showToast({ title: "明牌追加请输偶数", icon: "none" });
      return;
    }
    if (raiseInput < minRaise) {
      let title = "出积分不能低于当前最高积分";
      if (isZhj) {
        title = "追加不能低于 跟注 + 底注";
      } else if (isTexasQuickActual) {
        title = "快捷出分超过跟注才算加注";
      }
      wx.showToast({ title, icon: "none" });
      return;
    }
    const requestRaiseTo = isZhj
      ? currentPlayerBet + (seen ? raiseInput / 2 : raiseInput)
      : isTexasQuickActual
        ? currentPlayerBet + raiseInput
        : raiseInput;
    const delta = Math.max(requestRaiseTo - currentPlayerBet, 0);
    const modalContent = isZhj
      ? [
          `本次出分（实际扣分）：${raiseInput}。`,
          `加后你的本轮注：${requestRaiseTo}。`,
          seen ? `明牌按规则折算为名义注：${delta}。` : "闷牌：实际扣分 = 名义注。",
        ].join("\n")
      : isTexasQuickActual
        ? [
            `本次出积分：${raiseInput}。`,
            `加后你的本轮注：${requestRaiseTo}。`,
            `动作：加注。`,
          ].join("\n")
        : `出积分到 ${requestRaiseTo}（追加 ${delta}）？`;
    const title = isZhj
      ? options.fromQuick
        ? "确认快捷加注"
        : "确认加注"
      : options.fromQuick
        ? "确认快捷出积分"
        : "确认出积分";
    wx.showModal({
      title,
      content: modalContent,
      confirmText: "确认",
      success: (res) => {
        if (!res.confirm) return;
        this.applyAction("raise", { raiseTo: requestRaiseTo });
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
      if (code === "CANNOT_COMPARE_DARK") {
        wx.showToast({ title: "场上有闷牌，当前规则禁止比牌", icon: "none" });
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

  openAdjustChips() {
    if (!this.data.isHost || !this.data.isStarted) return;
    const targets = this.data.hostAdjustTargets || [];
    this.setData({
      showAdjustChips: true,
      adjustChipTargetId: this.data.adjustChipTargetId || targets[0]?.id || "",
      adjustChipMode: "add",
      adjustChipAmount: 0,
    });
  },

  closeAdjustChips() {
    this.setData({ showAdjustChips: false });
  },

  selectAdjustChipTarget(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ adjustChipTargetId: id });
  },

  selectAdjustChipMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode !== "add" && mode !== "sub") return;
    this.setData({ adjustChipMode: mode });
  },

  onAdjustChipAmountInput(e) {
    this.setData({ adjustChipAmount: Number(e.detail.value || 0) });
  },

  async confirmAdjustChips() {
    if (!this.roomId) return;
    if (!this.data.isHost) return;
    const targetId = this.data.adjustChipTargetId;
    const mode = this.data.adjustChipMode;
    const amount = Number(this.data.adjustChipAmount || 0);
    if (!targetId) {
      wx.showToast({ title: "请选择玩家", icon: "none" });
      return;
    }
    if (mode !== "add" && mode !== "sub") {
      wx.showToast({ title: "修正方向无效", icon: "none" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      wx.showToast({ title: "请输入正整数", icon: "none" });
      return;
    }
    try {
      await adjustChips(this.roomId, targetId, mode, amount);
      wx.showToast({ title: "积分已修正", icon: "success" });
      this.setData({ showAdjustChips: false });
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可操作", icon: "none" });
        return;
      }
      if (code === "INVALID_TARGET") {
        wx.showToast({ title: "玩家不存在", icon: "none" });
        return;
      }
      if (code === "INVALID_MODE" || code === "INVALID_AMOUNT") {
        wx.showToast({ title: "修正参数无效", icon: "none" });
        return;
      }
      if (code === "STACK_NEGATIVE") {
        wx.showToast({ title: "扣分后积分不能小于0", icon: "none" });
        return;
      }
      if (code === "NOT_STARTED") {
        wx.showToast({ title: "房间未开始", icon: "none" });
        return;
      }
      wx.showToast({ title: "积分修正失败", icon: "none" });
    }
  },

  openZhjCompareRules() {
    if (this.data.table?.gameType !== "zhajinhua") return;
    if (!this.data.isHost || !this.data.isStarted) return;
    if (this.data.table?.round === "showdown") return;
    this.setData({ showZhjCompareRules: true });
  },

  closeZhjCompareRules() {
    this.setData({ showZhjCompareRules: false });
  },

  toggleZhjBanCompareWhenDark() {
    this.setData({ zjhBanCompareWhenDark: !this.data.zjhBanCompareWhenDark });
  },

  async confirmZhjCompareRules() {
    if (!this.roomId) return;
    if (this.data.table?.gameType !== "zhajinhua") return;
    if (!this.data.isHost) return;
    try {
      await setZhjCompareRules(this.roomId, !!this.data.zjhBanCompareWhenDark);
      wx.showToast({ title: "比牌限制已更新", icon: "success" });
      this.setData({ showZhjCompareRules: false });
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可操作", icon: "none" });
        return;
      }
      if (code === "ONLY_ZHJ") {
        wx.showToast({ title: "仅炸金花支持", icon: "none" });
        return;
      }
      wx.showToast({ title: "设置失败", icon: "none" });
    }
  },

  openNextAnteSponsor() {
    if (this.data.table?.gameType !== "zhajinhua") return;
    if (!this.data.isHost || !this.data.canStartNextRound) return;
    this.setData({
      showNextAnteSponsor: true,
      nextAnteSponsorTargetId: this.data.table?.zjhNextAnteSponsorId || "",
    });
  },

  closeNextAnteSponsor() {
    this.setData({ showNextAnteSponsor: false });
  },

  selectNextAnteSponsorTarget(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ nextAnteSponsorTargetId: typeof id === "string" ? id : "" });
  },

  async confirmNextAnteSponsor() {
    if (!this.roomId) return;
    if (this.data.table?.gameType !== "zhajinhua") return;
    if (!this.data.isHost) return;
    try {
      await setNextAnteSponsor(this.roomId, this.data.nextAnteSponsorTargetId || "");
      wx.showToast({
        title: this.data.nextAnteSponsorTargetId ? "已设置代下底" : "已清除代下底",
        icon: "success",
      });
      this.setData({ showNextAnteSponsor: false });
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NOT_HOST") {
        wx.showToast({ title: "仅房主可操作", icon: "none" });
        return;
      }
      if (code === "NOT_SETTLED") {
        wx.showToast({ title: "请在收积分后设置", icon: "none" });
        return;
      }
      if (code === "ONLY_ZHJ") {
        wx.showToast({ title: "仅炸金花支持", icon: "none" });
        return;
      }
      if (code === "INVALID_TARGET") {
        wx.showToast({ title: "目标玩家无效", icon: "none" });
        return;
      }
      wx.showToast({ title: "设置失败", icon: "none" });
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
