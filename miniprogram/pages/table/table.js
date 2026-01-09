const { getTableById, updateTable, getProfile } = require("../../utils/storage");
const { formatRound } = require("../../utils/format");

const roundOrder = ["preflop", "flop", "turn", "river", "showdown"];
const DEFAULT_RAISE = 20;

function calcCurrentBet(players) {
  return players.reduce((max, player) => Math.max(max, player.bet || 0), 0);
}

function getNextActiveIndex(players, startIndex) {
  if (!players.length) return 0;
  const size = players.length;
  for (let offset = 1; offset <= size; offset += 1) {
    const index = (startIndex + offset) % size;
    const player = players[index];
    if (player.status === "active") {
      return index;
    }
  }
  return startIndex;
}

function getIndexByOffset(length, base, offset) {
  if (!length) return 0;
  const raw = (base + offset) % length;
  return raw < 0 ? raw + length : raw;
}

function statusLabel(status, isTurn) {
  if (status === "fold") return "弃牌";
  if (status === "allin") return "全下";
  if (status === "out") return "出局";
  return isTurn ? "行动中" : "等待";
}

function stageActionLabel(round) {
  if (round === "preflop") return "发三张";
  if (round === "flop") return "发四张";
  if (round === "turn") return "发五张";
  if (round === "river") return "摊牌";
  return "收积分";
}

function applyBlind(players, index, amount) {
  const target = players[index];
  if (!target || target.stack <= 0) return;
  const pay = Math.min(amount, target.stack);
  target.stack -= pay;
  target.bet += pay;
  if (target.stack === 0) {
    target.status = "allin";
  }
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
    canStartNextRound: false,
  },

  onLoad(query) {
    const profile = getProfile();
    this.setData({ profileName: profile?.name || "" });
    const table = getTableById(query.id);
    if (!table) {
      wx.showToast({ title: "房间不存在", icon: "none" });
      return;
    }
    this.syncView(table);
  },

  onShow() {
    if (!this.data.table?.id) return;
    const table = getTableById(this.data.table.id);
    if (table) this.syncView(table);
  },

  syncView(table) {
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

    const playersView = players.map((player, index) => ({
      ...player,
      isTurn: index === turnIndex,
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
    }));

    const isHost = !!table.hostName && table.hostName === this.data.profileName;
    this.setData({
      table: { ...table, turnIndex },
      playersView,
      currentBet,
      currentPlayer: currentPlayer || { name: "", stack: 0, bet: 0 },
      callNeed,
      roundLabel: formatRound(table.round),
      raiseTo,
      stageActionLabel: stageActionLabel(table.round),
      displayPot: table.pot + roundBetSum,
      dealerPlayer: players[dealerIndex] || { name: "-" },
      bigBlindPlayer: players[bigBlindIndex] || { name: "-" },
      smallBlindPlayer: players[smallBlindIndex] || { name: "-" },
      isHost,
      canStartNextRound: isHost && table.round === "showdown" && table.settled,
    });
  },

  persistTable(nextTable) {
    updateTable(nextTable);
    this.syncView(nextTable);
  },

  onInputRaise(e) {
    this.setData({ raiseTo: Number(e.detail.value || 0) });
  },

  onQuickRaise(e) {
    const amount = Number(e.currentTarget.dataset.amount || 0);
    if (!amount) return;
    const base = this.data.currentBet || 0;
    const target = base > 0 ? base + amount : amount;
    this.setData({ raiseTo: target });
  },

  onFold() {
    this.applyAction("fold");
  },

  onCheckCall() {
    const action = this.data.callNeed > 0 ? "call" : "check";
    this.applyAction(action);
  },

  onRaise() {
    this.applyAction("raise");
  },

  undoAction() {
    const table = { ...this.data.table };
    const lastAction = table.lastAction;
    if (!lastAction) {
      wx.showToast({ title: "暂无可撤回", icon: "none" });
      return;
    }
    if (table.turnIndex !== lastAction.turnIndexAfter) {
      wx.showToast({ title: "已有人行动，无法撤回", icon: "none" });
      return;
    }
    const players = [...(table.players || [])];
    const index = players.findIndex((player) => player.id === lastAction.playerId);
    if (index === -1) return;
    const player = { ...players[index] };
    player.bet = lastAction.prevBet;
    player.stack = lastAction.prevStack;
    player.status = lastAction.prevStatus;
    players[index] = player;
    table.players = players;
    table.turnIndex = lastAction.turnIndexBefore;
    table.lastAction = null;
    if (table.log && table.log.length) {
      table.log = table.log.slice(0, -1);
    }
    this.persistTable(table);
  },

  applyAction(type) {
    const table = { ...this.data.table };
    const players = [...(table.players || [])];
    if (!players.length) return;

    const turnIndex = table.turnIndex || 0;
    const player = { ...players[turnIndex] };
    if (!player || player.status !== "active") {
      return;
    }

    const currentBet = calcCurrentBet(players);
    const callNeed = Math.max(currentBet - (player.bet || 0), 0);
    const lastAction = {
      playerId: player.id,
      prevBet: player.bet,
      prevStack: player.stack,
      prevStatus: player.status,
      turnIndexBefore: turnIndex,
      turnIndexAfter: turnIndex,
    };

    if (type === "fold") {
      player.status = "fold";
    } else if (type === "check") {
      if (callNeed > 0) {
        wx.showToast({ title: "需要跟积分", icon: "none" });
        return;
      }
    } else if (type === "call") {
      const pay = Math.min(callNeed, player.stack);
      player.stack -= pay;
      player.bet += pay;
      if (player.stack === 0) {
        player.status = "allin";
      }
    } else if (type === "raise") {
      const raiseTo = Number(this.data.raiseTo || 0);
      if (raiseTo <= currentBet) {
        wx.showToast({ title: "出积分需高于当前最高积分", icon: "none" });
        return;
      }
      const delta = raiseTo - (player.bet || 0);
      if (delta >= player.stack) {
        player.bet += player.stack;
        player.stack = 0;
        player.status = "allin";
      } else {
        player.stack -= delta;
        player.bet += delta;
      }
    }

    players[turnIndex] = player;
    table.players = players;
    table.turnIndex = getNextActiveIndex(players, turnIndex);
    lastAction.turnIndexAfter = table.turnIndex;
    table.lastAction = lastAction;
    table.log = [
      ...(table.log || []),
      {
        ts: Date.now(),
        playerId: player.id,
        action: type,
        bet: player.bet,
      },
    ];

    this.persistTable(table);
  },

  endRound() {
    const table = { ...this.data.table };
    const players = table.players || [];
    if (table.round === "showdown") {
      if (table.settled) {
        wx.showToast({ title: "已收积分", icon: "none" });
        return;
      }
    }
    const activePlayers = players.filter((player) => player.status === "active");
    if (activePlayers.length > 1) {
      const target = activePlayers[0]?.bet || 0;
      const allEqual = activePlayers.every((player) => (player.bet || 0) === target);
      if (!allEqual) {
        wx.showToast({ title: "还有人未跟积分", icon: "none" });
        return;
      }
    }
    const potGain = players.reduce((sum, player) => sum + (player.bet || 0), 0);
    if (table.round === "showdown" && potGain === 0) {
      wx.showToast({ title: "暂无可收积分", icon: "none" });
      return;
    }
    players.forEach((player) => {
      player.bet = 0;
      if (player.stack <= 0) {
        player.status = "out";
      } else if (player.status !== "fold") {
        player.status = "active";
      }
    });

    table.pot += potGain;
    table.lastAction = null;
    if (table.round === "showdown") {
      table.settled = true;
      table.turnIndex = table.turnIndex || 0;
    } else {
      const roundIndex = Math.max(0, roundOrder.indexOf(table.round));
      table.round = roundOrder[Math.min(roundIndex + 1, roundOrder.length - 1)];
      if (players.length) {
        const dealerIndex = (table.dealerIndex || 0) % players.length;
        const smallBlindIndex = (dealerIndex + 1) % players.length;
        table.turnIndex = getNextActiveIndex(
          players,
          getIndexByOffset(players.length, smallBlindIndex, -1)
        );
      } else {
        table.turnIndex = 0;
      }
    }
    table.players = players;
    this.persistTable(table);
  },

  resetHand() {
    const table = { ...this.data.table };
    if (table.round !== "showdown" || !table.settled) {
      wx.showToast({ title: "请先收积分", icon: "none" });
      return;
    }
    if (!this.data.isHost) {
      wx.showToast({ title: "仅房主可进入下一回合", icon: "none" });
      return;
    }
    const players = table.players || [];
    const dealerIndex = players.length ? (table.dealerIndex + 1) % players.length : 0;
    const smallBlindIndex = players.length ? (dealerIndex + 1) % players.length : 0;
    const bigBlindIndex = players.length ? (dealerIndex + 2) % players.length : 0;
    players.forEach((player) => {
      player.bet = 0;
      if (player.stack > 0) {
        player.status = "active";
      } else {
        player.status = "out";
      }
    });
    if (players.length) {
      applyBlind(players, bigBlindIndex, table.blinds.bb);
      applyBlind(players, smallBlindIndex, table.blinds.sb);
    }
    table.pot = 0;
    table.round = "preflop";
    table.dealerIndex = dealerIndex;
    table.turnIndex = players.length ? getNextActiveIndex(players, bigBlindIndex) : 0;
    table.players = players;
    table.lastAction = null;
    table.settled = false;
    this.persistTable(table);
  },

  goSummary() {
    if (!this.data.table?.id) return;
    wx.navigateTo({ url: `/pages/summary/summary?id=${this.data.table.id}` });
  },
});
