const cloud = require("wx-server-sdk");
const { createMapAction } = require("./router");
const { normalizeGameRules } = require("./domain/gameRules");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS = "rooms";
const roundOrder = ["preflop", "flop", "turn", "river", "showdown"];
const defaultConfig = {
  blinds: { sb: 10, bb: 20 },
  stack: 2000,
  actionTimeoutSec: 60,
};

function sanitizeAvatar(avatar) {
  if (!avatar) return "";
  if (typeof avatar !== "string") return "";
  if (avatar.startsWith("cloud://")) return avatar;
  const match = avatar.match(/^https?:\/\/([^/]+)\/(.+)$/i);
  if (!match) return "";
  const host = match[1] || "";
  if (!host.endsWith(".tcb.qcloud.la")) return "";
  const envMatch = host.match(/(cloud\d+-[a-z0-9]+)/i);
  if (!envMatch) return "";
  const envId = envMatch[1];
  const rawPath = match[2] || "";
  const path = rawPath.split("?")[0];
  if (!path) return "";
  return `cloud://${envId}/${path}`;
}

function generateId(prefix) {
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${seed}`;
}

function generateCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function buildPlayer(name, avatar, openId, stack, status) {
  return {
    id: generateId("p"),
    name: name || "座位",
    avatar: avatar || "",
    openId: openId || "",
    stack,
    initialStack: stack,
    bet: 0,
    handBet: 0,
    actedRound: 0,
    status: status || "active",
  };
}


function applyBlind(players, index, amount) {
  if (!players.length) return;
  const target = players[index];
  if (!target || target.stack <= 0) return;
  const pay = Math.min(amount, target.stack);
  target.stack -= pay;
  target.bet += pay;
  target.handBet = (target.handBet || 0) + pay;
  if (target.stack === 0) {
    target.status = "allin";
  }
}

function getIndexByOffset(length, base, offset) {
  if (!length) return 0;
  const raw = (base + offset) % length;
  return raw < 0 ? raw + length : raw;
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

function calcCurrentBet(players) {
  return players.reduce((max, player) => Math.max(max, player.bet || 0), 0);
}

function normalizeBlinds(input) {
  const sb = Number(input?.sb);
  const bb = Number(input?.bb);
  return {
    sb: Number.isFinite(sb) && sb >= 0 ? sb : defaultConfig.blinds.sb,
    bb: Number.isFinite(bb) && bb >= 0 ? bb : defaultConfig.blinds.bb,
  };
}

function normalizeTimeoutSec(input) {
  const value = Number(input);
  if (Number.isFinite(value) && value >= 0) return value;
  return defaultConfig.actionTimeoutSec;
}

function calcTurnExpiresAt(now, timeoutSec, round, hasTurn) {
  if (!timeoutSec || timeoutSec <= 0) return null;
  if (round === "showdown") return null;
  if (!hasTurn) return null;
  return now + timeoutSec * 1000;
}

function assertExpected(table, expected) {
  if (!expected) return;
  if (typeof expected.turnIndex === "number" && table.turnIndex !== expected.turnIndex) {
    throw new Error("TURN_CHANGED");
  }
  if (typeof expected.round === "string" && table.round !== expected.round) {
    throw new Error("ROUND_CHANGED");
  }
  if (typeof expected.settled === "boolean" && table.settled !== expected.settled) {
    throw new Error("SETTLED_CHANGED");
  }
}

function assertStarted(table) {
  if (table.status !== "active") {
    throw new Error("NOT_STARTED");
  }
}

async function generateUniqueCode() {
  const _ = db.command;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const res = await db
      .collection(ROOMS)
      .where({ code, status: _.in(["active", "lobby"]) })
      .limit(1)
      .get();
    if (!res.data || !res.data.length) {
      return code;
    }
  }
  throw new Error("CODE_CONFLICT");
}

async function createRoom(payload, profile, openId) {
  const now = Date.now();
  const _ = db.command;
  const safeAvatar = sanitizeAvatar(profile?.avatar);
  if (openId) {
    const existing = await db
      .collection(ROOMS)
      .where({ "members.openId": openId, status: _.in(["active", "lobby"]) })
      .limit(1)
      .get();
    if (existing.data && existing.data.length) {
      return { _id: existing.data[0]._id, ...existing.data[0], existing: true };
    }
  }
  const normalized = normalizeGameRules(payload?.gameType, payload?.gameRules || payload);
  const maxSeats = normalized.rules.maxSeats;
  if (maxSeats < 2) {
    throw new Error("INVALID_PLAYERS");
  }
  const stackRaw =
    normalized.gameType === "zhajinhua"
      ? Number(normalized.rules.buyIn)
      : Number(normalized.rules.stack);
  const stack = Number.isFinite(stackRaw) && stackRaw > 0 ? stackRaw : defaultConfig.stack;
  const blinds =
    normalized.gameType === "zhajinhua"
      ? { sb: normalized.rules.baseBet, bb: normalized.rules.baseBet }
      : normalizeBlinds(normalized.rules.blinds);
  const actionTimeoutSec =
    normalized.gameType === "zhajinhua"
      ? defaultConfig.actionTimeoutSec
      : normalizeTimeoutSec(normalized.rules.actionTimeoutSec);
  const players = [
    buildPlayer(profile?.name || "房主", safeAvatar, openId, stack, "active"),
  ];
  const dealerIndex = 0;
  const turnIndex = 0;

  const code = await generateUniqueCode();
  const room = {
      code,
      createdAt: now,
      updatedAt: now,
      status: "lobby",
    gameType: normalized.gameType,
    gameRules: normalized.rules,
    blinds,
    stack,
    maxSeats,
    actionTimeoutSec,
    round: "preflop",
    roundId: 1,
    dealerIndex,
    turnIndex,
    pot: 0,
    turnExpiresAt: null,
    players,
      log: [],
      notice: null,
    lastAction: {},
    lastActionPlayerId: null,
    lastActionPrevBet: null,
    lastActionPrevStack: null,
    lastActionPrevStatus: null,
    lastActionPrevHandBet: null,
    lastActionTurnIndexBefore: null,
    lastActionTurnIndexAfter: null,
    settled: false,
    autoStage: true,
    hostName: profile?.name || "",
    hostOpenId: openId || "",
    members: [
      {
        openId: openId || "",
        name: profile?.name || "",
        avatar: safeAvatar,
      },
    ],
  };

  const res = await db.collection(ROOMS).add({ data: room });
  return { _id: res._id, ...room };
}

async function applyRoomAction(id, type, raiseTo, expected, openId) {
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const doc = await tx.collection(ROOMS).doc(id).get();
    const table = doc.data;
    if (!table) {
      throw new Error("NOT_FOUND");
    }
    assertStarted(table);
    assertExpected(table, expected);
    if (table.round === "showdown") {
      throw new Error("ROUND_OVER");
    }

    const players = (table.players || []).map((player) => ({ ...player }));
    if (!players.length) return;

    const turnIndex = Math.min(table.turnIndex || 0, players.length - 1);
    const player = { ...players[turnIndex] };
    if (!player || player.status !== "active") {
      throw new Error("NOT_ACTIVE");
    }
    if (!player.openId) {
      throw new Error("SEAT_UNBOUND");
    }
    if (player.openId !== openId) {
      throw new Error("NOT_OWNER");
    }

    const activePlayers = players.filter((item) => item.status === "active");
    if (type === "fold" && activePlayers.length <= 1) {
      throw new Error("LAST_PLAYER");
    }

    const currentBet = calcCurrentBet(players);
    const callNeed = Math.max(currentBet - (player.bet || 0), 0);
    const roundId = Number.isFinite(table.roundId) ? table.roundId : 1;
    const lastAction = {
      playerId: player.id,
      prevBet: player.bet,
      prevStack: player.stack,
      prevStatus: player.status,
      prevHandBet: player.handBet || 0,
      turnIndexBefore: turnIndex,
      turnIndexAfter: turnIndex,
    };

    let paid = 0;
    let actionType = type;
    if (type === "timeout") {
      if (!table.turnExpiresAt || now < table.turnExpiresAt) {
        throw new Error("NOT_TIMEOUT");
      }
      actionType = callNeed > 0 ? "fold" : "check";
    }
    if (actionType === "fold") {
      player.status = "fold";
    } else if (actionType === "check") {
      if (callNeed > 0) {
        throw new Error("NEED_CALL");
      }
    } else if (actionType === "call") {
      paid = Math.min(callNeed, player.stack);
      player.stack -= paid;
      player.bet += paid;
      if (player.stack === 0) {
        player.status = "allin";
      }
    } else if (actionType === "raise") {
      if (raiseTo < currentBet) {
        throw new Error("RAISE_TOO_LOW");
      }
      if (raiseTo < (player.bet || 0)) {
        throw new Error("RAISE_TOO_LOW");
      }
      const delta = raiseTo - (player.bet || 0);
      paid = Math.min(delta, player.stack);
      player.stack -= paid;
      player.bet += paid;
      if (player.stack === 0) {
        player.status = "allin";
      }
    } else if (actionType === "allin") {
      if (player.stack <= 0) {
        throw new Error("NO_STACK");
      }
      paid = player.stack;
      player.stack = 0;
      player.bet += paid;
      player.status = "allin";
    } else {
      throw new Error("INVALID_ACTION");
    }
    if (paid > 0) {
      player.handBet = (player.handBet || 0) + paid;
    }
    player.actedRound = roundId;

    players[turnIndex] = player;
    const activeAfter = players.filter((item) => item.status === "active");
    const inHandAfter = players.filter(
      (item) => item.status !== "fold" && item.status !== "out"
    );
    const currentBetAfter = calcCurrentBet(players);
    let nextRound = table.round;
    let nextTurnIndex = getNextActiveIndex(players, turnIndex);
    let nextRoundId = roundId;
    let pot = table.pot || 0;
    let shouldClearLastAction = false;
    const timeoutSec = normalizeTimeoutSec(table.actionTimeoutSec);

    const autoStageEnabled = table.autoStage !== false;
    if (inHandAfter.length <= 1 || (inHandAfter.length > 1 && activeAfter.length === 0)) {
      nextRound = "showdown";
      const winnerIndex = players.findIndex(
        (item) => item.status !== "fold" && item.status !== "out"
      );
      nextTurnIndex = winnerIndex >= 0 ? winnerIndex : turnIndex;
      const potGain = players.reduce((sum, item) => sum + (item.bet || 0), 0);
      pot += potGain;
      players.forEach((item) => {
        item.bet = 0;
        if (item.status === "fold" || item.status === "out") return;
        if (item.stack <= 0) {
          item.status = "allin";
        } else {
          item.status = "active";
        }
        item.actedRound = 0;
      });
      nextRoundId = roundId + 1;
      shouldClearLastAction = true;
    } else if (autoStageEnabled) {
      const allMatched = activeAfter.every((item) => (item.bet || 0) === currentBetAfter);
      const allActed = activeAfter.every((item) => (item.actedRound || 0) === roundId);
      if (allMatched && allActed) {
        const roundIndex = Math.max(0, roundOrder.indexOf(table.round));
        nextRound = roundOrder[Math.min(roundIndex + 1, roundOrder.length - 1)];
        const potGain = players.reduce((sum, item) => sum + (item.bet || 0), 0);
        pot += potGain;
        players.forEach((item) => {
          item.bet = 0;
          if (item.status === "fold" || item.status === "out") return;
          if (item.stack <= 0) {
            item.status = "allin";
          } else {
            item.status = "active";
          }
          item.actedRound = 0;
        });
        if (players.length) {
          const dealerIndex = (table.dealerIndex || 0) % players.length;
          const smallBlindIndex = (dealerIndex + 1) % players.length;
          nextTurnIndex = getNextActiveIndex(
            players,
            getIndexByOffset(players.length, smallBlindIndex, -1)
          );
        } else {
          nextTurnIndex = 0;
        }
        nextRoundId = roundId + 1;
        shouldClearLastAction = true;
      }
    }
    lastAction.turnIndexAfter = nextTurnIndex;
    const turnExpiresAt = calcTurnExpiresAt(
      now,
      timeoutSec,
      nextRound,
      nextRound !== "showdown" && activeAfter.length > 0
    );

    const log = [...(table.log || [])];
    log.push({
      ts: now,
      playerId: player.id,
      action: actionType,
      bet: player.bet,
    });

    await tx.collection(ROOMS).doc(id).update({
      data: {
        players,
        round: nextRound,
        roundId: nextRoundId,
        turnIndex: nextTurnIndex,
        pot,
        turnExpiresAt,
        settled: nextRound === "showdown" ? false : table.settled,
        lastActionPlayerId: shouldClearLastAction ? null : lastAction.playerId,
        lastActionPrevBet: shouldClearLastAction ? null : lastAction.prevBet,
        lastActionPrevStack: shouldClearLastAction ? null : lastAction.prevStack,
        lastActionPrevStatus: shouldClearLastAction ? null : lastAction.prevStatus,
        lastActionPrevHandBet: shouldClearLastAction ? null : lastAction.prevHandBet,
        lastActionTurnIndexBefore: shouldClearLastAction ? null : lastAction.turnIndexBefore,
        lastActionTurnIndexAfter: shouldClearLastAction ? null : lastAction.turnIndexAfter,
        log,
        updatedAt: now,
      },
    });
  });
  return { ok: true };
}


async function joinRoom(id, profile, openId) {
  if (!openId) {
    throw new Error("NO_OPENID");
  }
  const now = Date.now();
  const safeAvatar = sanitizeAvatar(profile?.avatar);
  await db.runTransaction(async (tx) => {
    const doc = await tx.collection(ROOMS).doc(id).get();
    const table = doc.data;
    if (!table) {
      throw new Error("NOT_FOUND");
    }
    const players = (table.players || []).map((player) => ({ ...player }));
    const existingIndex = players.findIndex((player) => player.openId === openId);
    const stack = Number(table.stack || defaultConfig.stack);

    const members = Array.isArray(table.members) ? [...table.members] : [];
    const memberIndex = members.findIndex((member) => member.openId === openId);
    if (memberIndex >= 0) {
      members[memberIndex] = {
        ...members[memberIndex],
        name: profile?.name || members[memberIndex].name,
        avatar: safeAvatar || members[memberIndex].avatar,
      };
    } else {
      members.push({
        openId,
        name: profile?.name || "",
        avatar: safeAvatar,
      });
    }

    if (existingIndex >= 0) {
      const player = { ...players[existingIndex] };
      player.name = profile?.name || player.name;
      player.avatar = safeAvatar || player.avatar;
      players[existingIndex] = player;
      await tx.collection(ROOMS).doc(id).update({
        data: { players, members, updatedAt: now },
      });
      return;
    }

    if (table.status !== "lobby") {
      throw new Error("ROOM_STARTED");
    }

    const maxSeats = Number(table.maxSeats || 0);
    if (maxSeats && players.length >= maxSeats) {
      throw new Error("ROOM_FULL");
    }

    players.push(
      buildPlayer(
        profile?.name || `座位${players.length + 1}`,
        safeAvatar,
        openId,
        stack,
        "active"
      )
    );

    await tx.collection(ROOMS).doc(id).update({
      data: {
        players,
        members,
        updatedAt: now,
      },
    });
  });
  return { ok: true };
}

async function leaveRoom(id, openId) {
  if (!openId) {
    throw new Error("NO_OPENID");
  }
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const doc = await tx.collection(ROOMS).doc(id).get();
    const table = doc.data;
    if (!table) {
      throw new Error("NOT_FOUND");
    }
    if (table.hostOpenId && table.hostOpenId === openId) {
      throw new Error("HOST_CANNOT_LEAVE");
    }

    const members = Array.isArray(table.members)
      ? table.members.filter((member) => member.openId !== openId)
      : [];

    let players = (table.players || []).map((player) => ({ ...player }));
    const leavingIndex = players.findIndex((player) => player.openId === openId);
    if (leavingIndex === -1) {
      throw new Error("NOT_FOUND");
    }
    const leavingPlayer = { ...players[leavingIndex] };

    const notice = {
      id: generateId("notice"),
      type: "leave",
      message: `${leavingPlayer.name || "玩家"}退出了房间`,
      ts: now,
    };

    if (table.status === "lobby") {
      players = players.filter((player) => player.openId !== openId);
      const dealerIndex = players.length
        ? Math.min(table.dealerIndex || 0, players.length - 1)
        : 0;
      const turnIndex = players.length
        ? Math.min(table.turnIndex || 0, players.length - 1)
        : 0;

      await tx.collection(ROOMS).doc(id).update({
        data: {
          players,
          members,
          dealerIndex,
          turnIndex,
          notice,
          updatedAt: now,
        },
      });
      return;
    }

    if (table.status !== "active") {
      throw new Error("ROOM_STARTED");
    }

    leavingPlayer.status = "fold";
    leavingPlayer.left = true;
    players[leavingIndex] = leavingPlayer;

    const inHandAfter = players.filter(
      (player) => player.status !== "fold" && player.status !== "out"
    );
    let nextRound = table.round;
    let nextTurnIndex = table.turnIndex || 0;
    if (inHandAfter.length <= 1) {
      nextRound = "showdown";
      const winnerIndex = players.findIndex(
        (player) => player.status !== "fold" && player.status !== "out"
      );
      nextTurnIndex = winnerIndex >= 0 ? winnerIndex : nextTurnIndex;
    } else if (table.turnIndex === leavingIndex) {
      nextTurnIndex = getNextActiveIndex(players, leavingIndex);
    }
    const timeoutSec = normalizeTimeoutSec(table.actionTimeoutSec);
    const turnExpiresAt = calcTurnExpiresAt(
      now,
      timeoutSec,
      nextRound,
      nextRound !== "showdown" && inHandAfter.length > 1
    );

    await tx.collection(ROOMS).doc(id).update({
      data: {
        players,
        members,
        round: nextRound,
        turnIndex: nextTurnIndex,
        turnExpiresAt,
        notice,
        updatedAt: now,
      },
    });
  });
  return { ok: true };
}

async function reorderPlayers(id, order, openId) {
  if (!openId) {
    throw new Error("NO_OPENID");
  }
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const doc = await tx.collection(ROOMS).doc(id).get();
    const table = doc.data;
    if (!table) {
      throw new Error("NOT_FOUND");
    }
    if (table.status !== "lobby") {
      throw new Error("ROOM_STARTED");
    }
    if (table.hostOpenId && table.hostOpenId !== openId) {
      throw new Error("NOT_HOST");
    }

    const players = (table.players || []).map((player) => ({ ...player }));
    if (!Array.isArray(order) || order.length !== players.length) {
      throw new Error("INVALID_ORDER");
    }
    const playerMap = new Map(players.map((player) => [player.id, player]));
    const nextPlayers = [];
    for (const idValue of order) {
      const player = playerMap.get(idValue);
      if (!player) throw new Error("INVALID_ORDER");
      nextPlayers.push(player);
    }

    const dealerId = players[table.dealerIndex || 0]?.id;
    const turnId = players[table.turnIndex || 0]?.id;
    const nextDealerIndex = dealerId ? nextPlayers.findIndex((player) => player.id === dealerId) : 0;
    const nextTurnIndex = turnId ? nextPlayers.findIndex((player) => player.id === turnId) : 0;

    await tx.collection(ROOMS).doc(id).update({
      data: {
        players: nextPlayers,
        dealerIndex: Math.max(0, nextDealerIndex),
        turnIndex: Math.max(0, nextTurnIndex),
        updatedAt: now,
      },
    });
  });
  return { ok: true };
}

async function setAutoStage(id, enabled, openId) {
  if (!openId) {
    throw new Error("NO_OPENID");
  }
  const now = Date.now();
  const doc = await db.collection(ROOMS).doc(id).get();
  const table = doc.data;
  if (!table) {
    throw new Error("NOT_FOUND");
  }
  if (table.hostOpenId && table.hostOpenId !== openId) {
    throw new Error("NOT_HOST");
  }
  await db.collection(ROOMS).doc(id).update({
    data: {
      autoStage: !!enabled,
      updatedAt: now,
    },
  });
  return { ok: true };
}

async function updateProfile(id, profile, openId) {
  if (!openId) {
    throw new Error("NO_OPENID");
  }
  const now = Date.now();
  const doc = await db.collection(ROOMS).doc(id).get();
  const table = doc.data;
  if (!table) {
    throw new Error("NOT_FOUND");
  }
  const nextName = profile?.name || "";
  const nextAvatar = sanitizeAvatar(profile?.avatar);
  const members = Array.isArray(table.members) ? [...table.members] : [];
  const memberIndex = members.findIndex((member) => member.openId === openId);
  if (memberIndex >= 0) {
    members[memberIndex] = {
      ...members[memberIndex],
      name: nextName || members[memberIndex].name,
      avatar: nextAvatar || members[memberIndex].avatar,
    };
  } else {
    members.push({
      openId,
      name: nextName,
      avatar: nextAvatar,
    });
  }

  const players = (table.players || []).map((player) => {
    if (player.openId !== openId) return player;
    return {
      ...player,
      name: nextName || player.name,
      avatar: nextAvatar || player.avatar,
    };
  });

  const updates = {
    members,
    players,
    updatedAt: now,
  };
  if (table.hostOpenId && table.hostOpenId === openId && nextName) {
    updates.hostName = nextName;
  }
  await db.collection(ROOMS).doc(id).update({ data: updates });
  return { ok: true };
}

async function setActionTimeout(id, actionTimeoutSec, openId) {
  if (!openId) {
    throw new Error("NO_OPENID");
  }
  const now = Date.now();
  const doc = await db.collection(ROOMS).doc(id).get();
  const table = doc.data;
  if (!table) {
    throw new Error("NOT_FOUND");
  }
  if (table.hostOpenId && table.hostOpenId !== openId) {
    throw new Error("NOT_HOST");
  }
  if (table.status !== "lobby") {
    throw new Error("ROOM_STARTED");
  }
  await db.collection(ROOMS).doc(id).update({
    data: {
      actionTimeoutSec: normalizeTimeoutSec(actionTimeoutSec),
      updatedAt: now,
    },
  });
  return { ok: true };
}

async function startRoom(id, openId) {
  if (!openId) {
    throw new Error("NO_OPENID");
  }
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const doc = await tx.collection(ROOMS).doc(id).get();
    const table = doc.data;
    if (!table) {
      throw new Error("NOT_FOUND");
    }
    if (table.status !== "lobby") {
      throw new Error("ROOM_STARTED");
    }
    if (table.hostOpenId && table.hostOpenId !== openId) {
      throw new Error("NOT_HOST");
    }

    const players = (table.players || []).map((player) => ({ ...player }));
    if (players.length < 2) {
      throw new Error("NEED_PLAYERS");
    }

    const dealerIndex = 0;
    const smallBlindIndex = getIndexByOffset(players.length, dealerIndex, 1);
    const bigBlindIndex = getIndexByOffset(players.length, dealerIndex, 2);
    players.forEach((player) => {
      player.bet = 0;
      player.handBet = 0;
      player.actedRound = 0;
      player.status = player.stack > 0 ? "active" : "out";
    });
    applyBlind(players, bigBlindIndex, table.blinds?.bb || defaultConfig.blinds.bb);
    applyBlind(players, smallBlindIndex, table.blinds?.sb || defaultConfig.blinds.sb);

    const timeoutSec = normalizeTimeoutSec(table.actionTimeoutSec);
    const turnExpiresAt = calcTurnExpiresAt(
      now,
      timeoutSec,
      "preflop",
      players.length > 0
    );
    await tx.collection(ROOMS).doc(id).update({
      data: {
        status: "active",
        round: "preflop",
        roundId: 1,
        dealerIndex,
        turnIndex: getNextActiveIndex(players, bigBlindIndex),
        players,
        pot: 0,
        turnExpiresAt,
        lastActionPlayerId: null,
        lastActionPrevBet: null,
        lastActionPrevStack: null,
        lastActionPrevStatus: null,
        lastActionPrevHandBet: null,
        lastActionTurnIndexBefore: null,
        lastActionTurnIndexAfter: null,
        settled: false,
        log: [],
        updatedAt: now,
      },
    });
  });
  return { ok: true };
}

async function endRoomRound(id, expected, openId, winnersByPot) {
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const doc = await tx.collection(ROOMS).doc(id).get();
    const table = doc.data;
    if (!table) {
      throw new Error("NOT_FOUND");
    }
    assertStarted(table);
    assertExpected(table, expected);

    if (table.hostOpenId && table.hostOpenId !== openId) {
      throw new Error("NOT_HOST");
    }

    if (table.round === "showdown" && table.settled) {
      throw new Error("SETTLED");
    }

    const players = (table.players || []).map((player) => ({ ...player }));
    if (table.round !== "showdown") {
      const activePlayers = players.filter((player) => player.status === "active");
      if (activePlayers.length > 0) {
        const target = activePlayers[0]?.bet || 0;
        const allEqual = activePlayers.every((player) => (player.bet || 0) === target);
        if (!allEqual) {
          throw new Error("NOT_EQUAL");
        }
        const roundId = Number.isFinite(table.roundId) ? table.roundId : 1;
        const allActed = activePlayers.every((player) => (player.actedRound || 0) === roundId);
        if (!allActed) {
          throw new Error("NOT_ACTED");
        }
      }

      const potGain = players.reduce((sum, player) => sum + (player.bet || 0), 0);

      players.forEach((player) => {
        player.bet = 0;
        player.actedRound = 0;
        if (player.status === "fold") {
          return;
        }
        if (player.stack <= 0) {
          player.status = "allin";
        } else {
          player.status = "active";
        }
      });

      const roundId = Number.isFinite(table.roundId) ? table.roundId : 1;
      const nextRoundIndex = Math.max(0, roundOrder.indexOf(table.round));
      const nextRound = roundOrder[Math.min(nextRoundIndex + 1, roundOrder.length - 1)];
      const timeoutSec = normalizeTimeoutSec(table.actionTimeoutSec);
      const updates = {
        players,
        pot: (table.pot || 0) + potGain,
        roundId: roundId + 1,
        lastActionPlayerId: null,
        lastActionPrevBet: null,
        lastActionPrevStack: null,
        lastActionPrevStatus: null,
        lastActionPrevHandBet: null,
        lastActionTurnIndexBefore: null,
        lastActionTurnIndexAfter: null,
        updatedAt: now,
      };

      updates.round = nextRound;
      if (players.length) {
        const dealerIndex = (table.dealerIndex || 0) % players.length;
        const smallBlindIndex = (dealerIndex + 1) % players.length;
        updates.turnIndex = getNextActiveIndex(
          players,
          getIndexByOffset(players.length, smallBlindIndex, -1)
        );
      } else {
        updates.turnIndex = 0;
      }
      updates.turnExpiresAt = calcTurnExpiresAt(
        now,
        timeoutSec,
        updates.round,
        updates.round !== "showdown" && players.length > 0
      );

      await tx.collection(ROOMS).doc(id).update({ data: updates });
      return;
    }

    const potSelections = Array.isArray(winnersByPot) ? winnersByPot : [];
    if (!potSelections.length) {
      throw new Error("NO_WINNERS");
    }

    const contributions = players.map((player) => ({
      id: player.id,
      total: (player.handBet || 0) + (player.bet || 0),
      status: player.status,
    }));
    const levels = Array.from(
      new Set(contributions.map((item) => item.total).filter((amount) => amount > 0))
    ).sort((a, b) => a - b);
    if (!levels.length) {
      throw new Error("NO_POT");
    }

    const payouts = new Map();
    let prevLevel = 0;
    for (let potIndex = 0; potIndex < levels.length; potIndex += 1) {
      const level = levels[potIndex];
      const participants = contributions.filter((item) => item.total >= level);
      const potAmount = (level - prevLevel) * participants.length;
      if (potAmount <= 0) {
        prevLevel = level;
        continue;
      }
      const eligibleIds = new Set(
        participants
          .filter((item) => item.status !== "fold" && item.status !== "out")
          .map((item) => item.id)
      );
      const selection = Array.isArray(potSelections[potIndex]) ? potSelections[potIndex] : [];
      const potWinners = players
        .filter((player) => eligibleIds.has(player.id) && selection.includes(player.id))
        .map((player) => player.id);
      const uniqueWinners = Array.from(new Set(potWinners));
      if (!uniqueWinners.length) {
        throw new Error("NO_POT_WINNER");
      }
      const share = Math.floor(potAmount / uniqueWinners.length);
      let remainder = potAmount - share * uniqueWinners.length;
      for (const winnerId of uniqueWinners) {
        const bonus = remainder > 0 ? 1 : 0;
        const current = payouts.get(winnerId) || 0;
        payouts.set(winnerId, current + share + bonus);
        remainder -= bonus;
      }
      prevLevel = level;
    }
    players.forEach((player) => {
      const reward = payouts.get(player.id) || 0;
      player.stack += reward;
      player.bet = 0;
      player.handBet = 0;
      if (player.left) {
        player.status = "fold";
        return;
      }
      if (player.stack <= 0) {
        player.status = "out";
      } else {
        player.status = "active";
      }
    });

    const updates = {
      players,
      pot: 0,
      settled: true,
      turnExpiresAt: null,
      lastActionPlayerId: null,
      lastActionPrevBet: null,
      lastActionPrevStack: null,
      lastActionPrevStatus: null,
      lastActionPrevHandBet: null,
      lastActionTurnIndexBefore: null,
      lastActionTurnIndexAfter: null,
      updatedAt: now,
    };

    await tx.collection(ROOMS).doc(id).update({ data: updates });
  });
  return { ok: true };
}

async function resetRoomRound(id, expected, profileName, openId) {
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const doc = await tx.collection(ROOMS).doc(id).get();
    const table = doc.data;
    if (!table) {
      throw new Error("NOT_FOUND");
    }
    assertStarted(table);
    assertExpected(table, expected);

    if (table.round !== "showdown" || !table.settled) {
      throw new Error("NOT_SETTLED");
    }

    if (table.hostOpenId) {
      if (table.hostOpenId !== openId) {
        throw new Error("NOT_HOST");
      }
    } else if (table.hostName && table.hostName !== (profileName || "")) {
      throw new Error("NOT_HOST");
    }

    const originalPlayers = (table.players || []).map((player) => ({ ...player }));
    const startDealerIndex = Math.min(table.dealerIndex || 0, Math.max(0, originalPlayers.length - 1));
    let nextDealerId = null;
    if (originalPlayers.length) {
      for (let offset = 1; offset <= originalPlayers.length; offset += 1) {
        const index = (startDealerIndex + offset) % originalPlayers.length;
        const candidate = originalPlayers[index];
        if (candidate && !candidate.left) {
          nextDealerId = candidate.id;
          break;
        }
      }
    }
    const players = originalPlayers.filter((player) => !player.left);
    const rawDealerIndex = nextDealerId
      ? players.findIndex((player) => player.id === nextDealerId)
      : 0;
    const dealerIndex = rawDealerIndex >= 0 ? rawDealerIndex : 0;
    const smallBlindIndex = players.length ? (dealerIndex + 1) % players.length : 0;
    const bigBlindIndex = players.length ? (dealerIndex + 2) % players.length : 0;

    players.forEach((player) => {
      player.bet = 0;
      player.handBet = 0;
      player.actedRound = 0;
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
    const timeoutSec = normalizeTimeoutSec(table.actionTimeoutSec);
    const turnExpiresAt = calcTurnExpiresAt(
      now,
      timeoutSec,
      "preflop",
      players.length > 0
    );

    await tx.collection(ROOMS).doc(id).update({
      data: {
        pot: 0,
        round: "preflop",
        roundId: 1,
        dealerIndex,
        turnIndex: players.length ? getNextActiveIndex(players, bigBlindIndex) : 0,
        turnExpiresAt,
        players,
        lastActionPlayerId: null,
        lastActionPrevBet: null,
        lastActionPrevStack: null,
        lastActionPrevStatus: null,
        lastActionPrevHandBet: null,
        lastActionTurnIndexBefore: null,
        lastActionTurnIndexAfter: null,
        settled: false,
        updatedAt: now,
      },
    });
  });
  return { ok: true };
}

async function finishRoom(id, openId) {
  if (!id) {
    throw new Error("NOT_FOUND");
  }
  const doc = await db.collection(ROOMS).doc(id).get();
  const table = doc.data;
  if (!table) {
    throw new Error("NOT_FOUND");
  }
  if (table.hostOpenId && table.hostOpenId !== openId) {
    throw new Error("NOT_HOST");
  }
  await db.collection(ROOMS).doc(id).remove();
  return { ok: true };
}

const mapAction = createMapAction({
  createRoom,
  joinRoom,
  applyRoomAction,
  leaveRoom,
  reorderPlayers,
  setAutoStage,
  setActionTimeout,
  startRoom,
  updateProfile,
  endRoomRound,
  resetRoomRound,
  finishRoom,
});

exports.main = async (event) => {
  const action = event?.action;
  const payload = event?.payload;
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  const handler = mapAction(action);
  if (handler) {
    return handler(event, openId);
  }

  throw new Error("UNKNOWN_ACTION");
};
