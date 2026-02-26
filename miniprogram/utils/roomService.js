const {
  defaultConfig,
  buildPlayers,
  applyBlind,
  getIndexByOffset,
  getNextActiveIndex,
  generateCode,
} = require("./storage");
const { getDb } = require("./cloud");
const { createRoomService } = require("../services/roomService");
const { callFunction } = require("../adapters/cloud");

const ROOMS = "rooms";
const roomService = createRoomService(callFunction);

function buildRoom(payload, profile, openId) {
  const now = Date.now();
  const players = buildPlayers(payload.players || [], payload.stack || defaultConfig.stack);
  const dealerIndex = 0;
  const smallBlindIndex = getIndexByOffset(players.length, dealerIndex, 1);
  const bigBlindIndex = getIndexByOffset(players.length, dealerIndex, 2);
  const blinds = payload.blinds || defaultConfig.blinds;

  applyBlind(players, bigBlindIndex, blinds.bb);
  applyBlind(players, smallBlindIndex, blinds.sb);

  return {
    code: generateCode(),
    createdAt: now,
    updatedAt: now,
    status: "active",
    blinds,
    round: "preflop",
    dealerIndex,
    turnIndex: getNextActiveIndex(players, bigBlindIndex),
    pot: 0,
    players,
    log: [],
    lastAction: null,
    settled: false,
    hostName: profile?.name || "",
    hostOpenId: openId || "",
    members: [
      {
        openId: openId || "",
        name: profile?.name || "",
        avatar: profile?.avatar || "",
      },
    ],
  };
}

async function listRooms() {
  const db = getDb();
  const _ = db.command;
  const res = await db
    .collection(ROOMS)
    .where({ status: _.in(["active", "lobby"]) })
    .orderBy("updatedAt", "desc")
    .limit(20)
    .get();
  return res.data || [];
}

async function callRoomAction(action, payload) {
  const res = await wx.cloud.callFunction({
    name: "roomAction",
    data: { action, payload },
  });
  return res?.result || null;
}

async function createRoom(payload, profile) {
  return callRoomAction("create", { payload, profile });
}

async function joinRoomByCode(code) {
  const db = getDb();
  const res = await db.collection(ROOMS).where({ code }).limit(1).get();
  return res.data?.[0] || null;
}

async function getMyRoom(openId) {
  if (!openId) return null;
  const db = getDb();
  const _ = db.command;
  const res = await db
    .collection(ROOMS)
    .where({ "members.openId": openId, status: _.in(["active", "lobby"]) })
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();
  return res.data?.[0] || null;
}

async function getRoomById(id) {
  const db = getDb();
  const res = await db.collection(ROOMS).doc(id).get();
  return res.data;
}

async function joinRoom(id, profile) {
  return callRoomAction("joinRoom", { id, profile });
}

async function leaveRoom(id) {
  return callRoomAction("leaveRoom", { id });
}

async function startRoom(id) {
  return callRoomAction("startRoom", { id });
}

async function setAutoStage(id, enabled) {
  return callRoomAction("setAutoStage", { id, enabled });
}

async function addMockPlayers(id, count) {
  return callRoomAction("addMockPlayers", { id, count });
}

async function updateProfile(id, profile) {
  return callRoomAction("updateProfile", { id, profile });
}

function watchRoom(id, handlers) {
  const db = getDb();
  let isClosed = false;
  const isCancelledWatchError = (err) => {
    const text = `${err?.message || ""} ${err?.errMsg || ""}`.toLowerCase();
    if (!text) return false;
    return (
      text.includes("oncancellederror") ||
      (text.includes("initwatchfail") && text.includes("closed")) ||
      text.includes("current state (closed)")
    );
  };

  const watcher = db.collection(ROOMS).doc(id).watch({
    onChange: (snapshot) => {
      if (isClosed) return;
      const doc = snapshot.docs?.[0];
      if (handlers?.onChange) {
        handlers.onChange(doc || null);
      }
    },
    onError: (err) => {
      if (isClosed) return;
      if (isCancelledWatchError(err)) return;
      if (handlers?.onError) handlers.onError(err);
    },
  });
  if (watcher && typeof watcher.close === "function") {
    const rawClose = watcher.close.bind(watcher);
    watcher.close = (...args) => {
      isClosed = true;
      return rawClose(...args);
    };
  }
  return watcher;
}

async function applyAction(id, type, raiseTo, expected, targetId, result) {
  return callRoomAction("applyAction", { id, type, raiseTo, expected, targetId, result });
}

async function endRound(id, expected, winnersByPot) {
  return callRoomAction("endRound", { id, expected, winnersByPot });
}

async function resetRound(id, expected, profileName) {
  return callRoomAction("resetRound", { id, expected, profileName });
}

async function rebuy(id, amount) {
  return callRoomAction("rebuy", { id, amount });
}

async function finishRoom(id) {
  return callRoomAction("finishRoom", { id });
}

async function reorderPlayers(id, order) {
  return callRoomAction("reorderPlayers", { id, order });
}

module.exports = {
  listRooms,
  createRoom,
  joinRoomByCode,
  getMyRoom,
  getRoomById,
  joinRoom,
  leaveRoom,
  startRoom,
  setAutoStage,
  addMockPlayers,
  updateProfile,
  watchRoom,
  applyAction,
  endRound,
  resetRound,
  rebuy,
  finishRoom,
  reorderPlayers,
  createRoomService,
  roomService,
};
